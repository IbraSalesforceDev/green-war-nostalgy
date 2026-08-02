import { BusEventos, bus as busGlobal } from '../../core/events';
import { REEMBOLSO_CANCELACION } from '../constantes';
import { fichaEdificio } from '../datos/edificios';
import { fichaUnidad, nombreUnidad } from '../datos/unidades';
import { crearUnidad } from '../fabrica';
import { Mundo } from '../mundo';
import {
  Bando,
  Clase,
  ENTIDAD_NULA,
  ElementoCola,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoEdificio,
  TipoUnidad,
  indiceDe,
} from '../tipos';

/**
 * Sistema de producción de unidades.
 *
 * Cada edificio productor tiene su propia cola en `mundo.colas`. El coste se cobra al
 * encolar y se reembolsa (en parte) al cancelar: cobrar al terminar permitiría gastar
 * el mismo oro tres veces mientras la primera unidad está en el horno, que es el
 * agujero clásico de las economías mal hechas.
 *
 * La población, en cambio, se comprueba al salir y no al encolar. Es lo que permite
 * encolar tropa mientras la granja se está construyendo, con la unidad esperando en la
 * puerta hasta que haya sitio; el jugador solo necesita el aviso de que está bloqueado.
 */

// --- Ajustes propios del sistema (no existían en constantes.ts) ---

/** Tope de elementos en la cola de un edificio. */
export const MAX_COLA = 7;

/** Cada cuántos ticks se repite el aviso de población llena. */
const TICKS_ENTRE_AVISOS = 40;

/** Radio máximo, en casillas, en el que se busca hueco para la unidad recién salida. */
const RADIO_APARICION = 8;

// --- Consultas ---

export function esProductor(mundo: Mundo, i: number): boolean {
  if (mundo.clase[i] !== Clase.EDIFICIO) return false;
  if (mundo.progresoObra[i] < 1) return false;
  if (mundo.vida[i] <= 0) return false;
  return fichaEdificio(mundo.tipo[i] as TipoEdificio).entrena.length > 0;
}

export function colaDe(mundo: Mundo, edificio: Entidad): readonly ElementoCola[] | null {
  if (!mundo.esValida(edificio)) return null;
  return mundo.colas.get(indiceDe(edificio)) ?? null;
}

// --- Órdenes de producción ---

/**
 * Encola una unidad. Devuelve `false` y emite un aviso si no se puede, nunca falla en
 * silencio.
 */
export function encolarUnidad(
  mundo: Mundo,
  edificio: Entidad,
  tipo: TipoUnidad,
  bus: BusEventos = busGlobal,
): boolean {
  if (!mundo.esValida(edificio)) return false;
  const o = indiceDe(edificio);
  if (!esProductor(mundo, o)) return false;

  const bando = mundo.bando[o] as Bando;
  if (bando === Bando.NEUTRAL) return false;

  const fichaCasa = fichaEdificio(mundo.tipo[o] as TipoEdificio);
  if (!fichaCasa.entrena.includes(tipo)) return false;

  const ficha = fichaUnidad(tipo);
  const estado = mundo.estadoDe(bando);
  const x = mundo.x[o];
  const z = mundo.z[o];

  let cola = mundo.colas.get(o);
  if (cola && cola.length >= MAX_COLA) {
    bus.emitir('aviso', {
      texto: 'La cola de este edificio está llena.',
      severidad: 'info',
      x,
      z,
      clave: 'cola-llena',
    });
    return false;
  }

  if (estado.oro < ficha.coste.oro || estado.madera < ficha.coste.madera) {
    bus.emitir('aviso', {
      texto: estado.oro < ficha.coste.oro ? 'No hay oro suficiente.' : 'No hay madera suficiente.',
      severidad: 'alerta',
      x,
      z,
      clave: 'sin-recursos',
    });
    return false;
  }

  estado.oro -= ficha.coste.oro;
  estado.madera -= ficha.coste.madera;

  if (!cola) {
    cola = [];
    mundo.colas.set(o, cola);
  }
  cola.push({
    tipoUnidad: tipo,
    restante: ficha.tiempoEntrenamiento,
    total: ficha.tiempoEntrenamiento,
  });
  return true;
}

/** Cancela un elemento de la cola y devuelve `REEMBOLSO_CANCELACION` de su coste. */
export function cancelarProduccion(
  mundo: Mundo,
  edificio: Entidad,
  posicion: number,
  bus: BusEventos = busGlobal,
): boolean {
  if (!mundo.esValida(edificio)) return false;
  const o = indiceDe(edificio);
  const cola = mundo.colas.get(o);
  if (!cola || posicion < 0 || posicion >= cola.length) return false;

  const elemento = cola[posicion]!;
  const ficha = fichaUnidad(elemento.tipoUnidad);
  const bando = mundo.bando[o] as Bando;
  if (bando !== Bando.NEUTRAL) {
    const estado = mundo.estadoDe(bando);
    estado.oro += ficha.coste.oro * REEMBOLSO_CANCELACION;
    estado.madera += ficha.coste.madera * REEMBOLSO_CANCELACION;
  }

  cola.splice(posicion, 1);
  if (cola.length === 0) mundo.colas.delete(o);

  bus.emitir('aviso', {
    texto: `Producción cancelada: ${nombreUnidad(elemento.tipoUnidad, bando)}.`,
    severidad: 'info',
    x: mundo.x[o],
    z: mundo.z[o],
    clave: 'produccion-cancelada',
  });
  return true;
}

/** Punto al que van las unidades recién salidas de este edificio. */
export function fijarPuntoReunion(mundo: Mundo, edificio: Entidad, x: number, z: number): boolean {
  if (!mundo.esValida(edificio)) return false;
  const o = indiceDe(edificio);
  if (mundo.clase[o] !== Clase.EDIFICIO) return false;
  mundo.puntoReunion.set(o, { x, z });
  return true;
}

export function borrarPuntoReunion(mundo: Mundo, edificio: Entidad): void {
  if (!mundo.esValida(edificio)) return;
  mundo.puntoReunion.delete(indiceDe(edificio));
}

// --- Sistema ---

export class SistemaProduccion {
  readonly mundo: Mundo;
  readonly bus: BusEventos;

  constructor(mundo: Mundo, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.bus = bus;
  }

  paso(dt: number): void {
    const mundo = this.mundo;
    // Se recorre por índice y no iterando el Map: el orden de un Map depende del orden
    // de inserción, y eso es una fuente de divergencia entre dos partidas iguales.
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.EDIFICIO) continue;
      const cola = mundo.colas.get(i);
      if (!cola || cola.length === 0) continue;

      if (mundo.vida[i] <= 0 || mundo.progresoObra[i] < 1) continue;

      const elemento = cola[0]!;
      if (elemento.restante > 0) {
        elemento.restante -= dt;
        if (elemento.restante > 0) continue;
        elemento.restante = 0;
      }

      if (!this.haySitioEnPoblacion(i, elemento.tipoUnidad)) continue;
      if (this.sacarUnidad(i, elemento.tipoUnidad)) {
        cola.shift();
        if (cola.length === 0) mundo.colas.delete(i);
      }
    }
  }

  private haySitioEnPoblacion(i: number, tipo: TipoUnidad): boolean {
    const mundo = this.mundo;
    const bando = mundo.bando[i] as Bando;
    const estado = mundo.estadoDe(bando);
    const coste = fichaUnidad(tipo).coste.poblacion;
    if (estado.poblacion + coste <= estado.poblacionMaxima) return true;

    if (mundo.tick % TICKS_ENTRE_AVISOS === 0) {
      this.bus.emitir('aviso', {
        texto: 'Población al límite: hacen falta más granjas.',
        severidad: 'alerta',
        x: mundo.x[i],
        z: mundo.z[i],
        clave: 'poblacion-llena',
      });
    }
    return false;
  }

  private sacarUnidad(i: number, tipo: TipoUnidad): boolean {
    const mundo = this.mundo;
    const casilla = this.casillaDeSalida(i);
    if (!casilla) {
      if (mundo.tick % TICKS_ENTRE_AVISOS === 0) {
        this.bus.emitir('aviso', {
          texto: 'No hay sitio para que salga la unidad.',
          severidad: 'alerta',
          x: mundo.x[i],
          z: mundo.z[i],
          clave: 'salida-bloqueada',
        });
      }
      return false;
    }

    const bando = mundo.bando[i] as Bando;
    const entidad = crearUnidad(
      mundo,
      tipo,
      bando,
      mundo.mapa.centroCasilla(casilla[0]),
      mundo.mapa.centroCasilla(casilla[1]),
    );
    if (entidad === ENTIDAD_NULA) return false;

    const u = indiceDe(entidad);
    mundo.estadoDe(bando).unidadesEntrenadas++;
    mundo.cambiarEstado(u, EstadoUnidad.INACTIVO);

    const reunion = mundo.puntoReunion.get(i);
    if (reunion) {
      mundo.orden[u] = Orden.MOVER;
      mundo.ordenX[u] = reunion.x;
      mundo.ordenZ[u] = reunion.z;
      mundo.anclaX[u] = reunion.x;
      mundo.anclaZ[u] = reunion.z;
    }

    this.bus.emitir('producidoTerminado', {
      entidad,
      productor: mundo.entidadDeIndice(i),
      bando,
    });
    return true;
  }

  /**
   * Casilla libre pegada al edificio. Se recorre el perímetro en un orden fijo (sur,
   * este, norte, oeste) para que la salida sea siempre la misma con la misma semilla.
   */
  private casillaDeSalida(i: number): [number, number] | null {
    const mundo = this.mundo;
    const mapa = mundo.mapa;
    const cx = mundo.casillaX[i];
    const cz = mundo.casillaZ[i];
    const lado = mundo.huella[i];

    for (let d = 0; d < lado; d++) {
      if (mapa.transitable(cx + d, cz + lado)) return [cx + d, cz + lado];
    }
    for (let d = 0; d < lado; d++) {
      if (mapa.transitable(cx + lado, cz + d)) return [cx + lado, cz + d];
    }
    for (let d = 0; d < lado; d++) {
      if (mapa.transitable(cx + d, cz - 1)) return [cx + d, cz - 1];
    }
    for (let d = 0; d < lado; d++) {
      if (mapa.transitable(cx - 1, cz + d)) return [cx - 1, cz + d];
    }

    return mapa.casillaLibreMasCercana(cx + (lado >> 1), cz + lado, RADIO_APARICION);
  }
}
