import { BusEventos, bus as busGlobal } from '../../core/events';
import {
  COSTE_REPARACION_POR_PUNTO,
  REPARACION_POR_SEGUNDO,
  TOLERANCIA_DESTINO,
  VIDA_INICIAL_OBRA,
} from '../constantes';
import { estaDesbloqueado, fichaEdificio, nombreEdificio } from '../datos/edificios';
import { centroDeHuella, crearEdificio, registrarEdificioTerminado } from '../fabrica';
import { Mundo } from '../mundo';
import type { BuscadorRutas } from '../rutas/contrato';
import {
  Bando,
  Bloqueo,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoEdificio,
  indiceDe,
} from '../tipos';
import type { SistemaMovimiento } from './movimiento';

/**
 * Sistema de construcción y reparación.
 *
 * Cubre el ciclo entero de un edificio antes de existir del todo: colocar el andamio
 * (que ya reserva las casillas y ya cuesta dinero), acercar a los obreros, subir el
 * progreso al ritmo de cuántos trabajen, y el momento en que el andamio se convierte
 * en edificio de verdad y desbloquea lo que tenga que desbloquear.
 *
 * El detalle que marca la diferencia: el bloqueo de la huella pasa de `OBRA` a
 * `EDIFICIO` al terminar, y ambas máscaras se limpian al retirar la entidad. Un andamio
 * cancelado o derribado no puede dejar la casilla marcada, o el mapa se va llenando de
 * agujeros invisibles por los que nadie puede pasar.
 */

// --- Ajustes propios del sistema (no existían en constantes.ts) ---

/** Distancia entre bordes a la que un obrero considera que ya puede trabajar. */
export const ALCANCE_TRABAJO = 0.65;

/**
 * Cuánto aporta cada obrero adicional respecto al primero.
 * Menos de 1 a propósito: cinco campesinos terminan antes, pero no cinco veces antes.
 */
export const RENDIMIENTO_OBRERO_ADICIONAL = 0.55;

/** Tope de obreros que caben trabajando en la misma obra. */
export const MAX_OBREROS_POR_OBRA = 5;

// --- Invalidación de rutas ---

/**
 * Poner o quitar un edificio cambia la transitabilidad y el buscador de rutas tiene
 * que enterarse. Como `colocarAndamio` es una función suelta (la llama el módulo de
 * órdenes, que no conoce el buscador), el enganche se registra desde el orquestador.
 */
export interface InvalidadorRutas {
  invalidarRegion(cx: number, cz: number, lado: number): void;
}

let invalidador: InvalidadorRutas | null = null;

export function registrarInvalidadorDeRutas(nuevo: InvalidadorRutas | null): void {
  invalidador = nuevo;
}

export function invalidarRutasEn(cx: number, cz: number, lado: number): void {
  if (invalidador) invalidador.invalidarRegion(cx, cz, lado);
}

// --- Colocación ---

/**
 * Coloca el andamio de un edificio y cobra su coste.
 *
 * Devuelve `ENTIDAD_NULA` si algo no cuadra, y en ese caso emite un aviso explicando
 * qué: quedarse sin respuesta ante un clic es el peor error de interfaz posible.
 */
export function colocarAndamio(
  mundo: Mundo,
  bando: Bando,
  tipo: TipoEdificio,
  cx: number,
  cz: number,
  bus: BusEventos = busGlobal,
): Entidad {
  if (bando === Bando.NEUTRAL) return ENTIDAD_NULA;

  const ficha = fichaEdificio(tipo);
  const estado = mundo.estadoDe(bando);
  const x = centroDeHuella(cx, ficha.huella);
  const z = centroDeHuella(cz, ficha.huella);

  if (!estaDesbloqueado(tipo, estado.edificiosDisponibles)) {
    bus.emitir('aviso', {
      texto: `Aún no puedes levantar ${nombreEdificio(tipo, bando)}.`,
      severidad: 'alerta',
      x,
      z,
      clave: 'sin-tecnologia',
    });
    return ENTIDAD_NULA;
  }

  if (!mundo.mapa.cabeEdificio(cx, cz, ficha.huella)) {
    bus.emitir('aviso', {
      texto: 'Aquí no cabe.',
      severidad: 'alerta',
      x,
      z,
      clave: 'sitio-ocupado',
    });
    return ENTIDAD_NULA;
  }

  if (estado.oro < ficha.coste.oro || estado.madera < ficha.coste.madera) {
    bus.emitir('aviso', {
      texto: estado.oro < ficha.coste.oro ? 'No hay oro suficiente.' : 'No hay madera suficiente.',
      severidad: 'alerta',
      x,
      z,
      clave: 'sin-recursos',
    });
    return ENTIDAD_NULA;
  }

  estado.oro -= ficha.coste.oro;
  estado.madera -= ficha.coste.madera;

  const andamio = crearEdificio(mundo, tipo, bando, cx, cz, false);
  if (andamio === ENTIDAD_NULA) {
    // Nunca debería pasar, pero si el mundo está lleno hay que devolver el dinero.
    estado.oro += ficha.coste.oro;
    estado.madera += ficha.coste.madera;
    return ENTIDAD_NULA;
  }

  invalidarRutasEn(cx, cz, ficha.huella);
  bus.emitir('construccionIniciada', { entidad: andamio, bando });
  return andamio;
}

/** Retira un andamio a medio hacer devolviendo la parte proporcional del coste. */
export function cancelarObra(mundo: Mundo, andamio: Entidad, reembolso: number): boolean {
  if (!mundo.esValida(andamio)) return false;
  const o = indiceDe(andamio);
  if (mundo.clase[o] !== Clase.EDIFICIO) return false;
  if (mundo.progresoObra[o] >= 1) return false;

  const ficha = fichaEdificio(mundo.tipo[o] as TipoEdificio);
  const bando = mundo.bando[o] as Bando;
  if (bando !== Bando.NEUTRAL) {
    const estado = mundo.estadoDe(bando);
    estado.oro += ficha.coste.oro * reembolso;
    estado.madera += ficha.coste.madera * reembolso;
  }

  const cx = mundo.casillaX[o];
  const cz = mundo.casillaZ[o];
  mundo.mapa.limpiarHuella(cx, cz, ficha.huella, Bloqueo.EDIFICIO | Bloqueo.OBRA);
  mundo.destruir(andamio);
  invalidarRutasEn(cx, cz, ficha.huella);
  return true;
}

// --- Sistema ---

export class SistemaConstruccion {
  readonly mundo: Mundo;
  readonly movimiento: SistemaMovimiento;
  readonly buscador: BuscadorRutas;
  readonly bus: BusEventos;

  constructor(
    mundo: Mundo,
    movimiento: SistemaMovimiento,
    buscador: BuscadorRutas,
    bus: BusEventos = busGlobal,
  ) {
    this.mundo = mundo;
    this.movimiento = movimiento;
    this.buscador = buscador;
    this.bus = bus;
  }

  paso(dt: number): void {
    this.reiniciarCuadrillas();
    this.atenderObreros(dt);
    this.avanzarObras(dt);
  }

  /** El recuento de obreros se rehace cada tick: quien no se presenta, no cuenta. */
  private reiniciarCuadrillas(): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.EDIFICIO) continue;
      mundo.obrerosEnObra[i] = 0;
    }
  }

  private atenderObreros(dt: number): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (mundo.vida[i] <= 0) continue;
      const orden = mundo.orden[i];
      if (orden === Orden.CONSTRUIR) this.trabajarEnObra(i);
      else if (orden === Orden.REPARAR) this.reparar(i, dt);
    }
  }

  private trabajarEnObra(i: number): void {
    const mundo = this.mundo;
    const objetivo = mundo.ordenObjetivo[i];
    if (!mundo.esValida(objetivo)) {
      this.soltarOrden(i);
      return;
    }

    const o = indiceDe(objetivo);
    if (mundo.clase[o] !== Clase.EDIFICIO || mundo.vida[o] <= 0) {
      this.soltarOrden(i);
      return;
    }
    if (mundo.progresoObra[o] >= 1) {
      // La obra terminó mientras venía de camino: el obrero queda libre.
      this.soltarOrden(i);
      return;
    }

    if (mundo.distanciaEntreBordes(i, o) > ALCANCE_TRABAJO) {
      this.acercarse(i, o);
      return;
    }

    this.movimiento.detener(i);
    mundo.angulo[i] = Math.atan2(mundo.x[o] - mundo.x[i], mundo.z[o] - mundo.z[i]);
    mundo.cambiarEstado(i, EstadoUnidad.CONSTRUYENDO);
    if (mundo.obrerosEnObra[o] < MAX_OBREROS_POR_OBRA) mundo.obrerosEnObra[o]++;
  }

  private reparar(i: number, dt: number): void {
    const mundo = this.mundo;
    const objetivo = mundo.ordenObjetivo[i];
    if (!mundo.esValida(objetivo)) {
      this.soltarOrden(i);
      return;
    }

    const o = indiceDe(objetivo);
    if (mundo.clase[o] !== Clase.EDIFICIO || mundo.vida[o] <= 0) {
      this.soltarOrden(i);
      return;
    }
    if (mundo.bando[o] !== mundo.bando[i]) {
      this.soltarOrden(i);
      return;
    }
    if (mundo.progresoObra[o] < 1) {
      // Sigue siendo un andamio: reparar y construir son lo mismo aquí.
      mundo.orden[i] = Orden.CONSTRUIR;
      return;
    }
    if (mundo.vida[o] >= mundo.vidaMaxima[o]) {
      this.soltarOrden(i);
      return;
    }

    if (mundo.distanciaEntreBordes(i, o) > ALCANCE_TRABAJO) {
      this.acercarse(i, o);
      return;
    }

    this.movimiento.detener(i);
    mundo.angulo[i] = Math.atan2(mundo.x[o] - mundo.x[i], mundo.z[o] - mundo.z[i]);
    mundo.cambiarEstado(i, EstadoUnidad.CONSTRUYENDO);

    const puntos = Math.min(REPARACION_POR_SEGUNDO * dt, mundo.vidaMaxima[o] - mundo.vida[o]);
    if (puntos <= 0) return;

    const ficha = fichaEdificio(mundo.tipo[o] as TipoEdificio);
    const total = ficha.coste.oro + ficha.coste.madera;
    const fraccionOro = total > 0 ? ficha.coste.oro / total : 1;
    const coste = puntos * COSTE_REPARACION_POR_PUNTO;
    const costeOro = coste * fraccionOro;
    const costeMadera = coste - costeOro;

    const estado = mundo.estadoDe(mundo.bando[i] as Bando);
    if (estado.oro < costeOro || estado.madera < costeMadera) {
      this.bus.emitir('aviso', {
        texto: 'No hay recursos para seguir reparando.',
        severidad: 'alerta',
        x: mundo.x[o],
        z: mundo.z[o],
        clave: 'sin-recursos',
      });
      this.soltarOrden(i);
      return;
    }

    estado.oro -= costeOro;
    estado.madera -= costeMadera;
    mundo.vida[o] += puntos;
  }

  /** Camina hasta el borde del edificio; la tolerancia evita entrar en su huella. */
  private acercarse(i: number, o: number): void {
    const mundo = this.mundo;
    const tolerancia = Math.max(
      TOLERANCIA_DESTINO,
      mundo.radio[i] + mundo.radio[o] + ALCANCE_TRABAJO * 0.75,
    );
    this.movimiento.solicitarMovimiento(i, mundo.x[o], mundo.z[o], tolerancia);
    if (this.movimiento.haFallado(i)) this.soltarOrden(i);
  }

  private soltarOrden(i: number): void {
    const mundo = this.mundo;
    mundo.orden[i] = Orden.NINGUNA;
    mundo.ordenObjetivo[i] = 0;
    this.movimiento.detener(i);
    if (mundo.estado[i] === EstadoUnidad.CONSTRUYENDO) {
      mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
    }
  }

  private avanzarObras(dt: number): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.EDIFICIO) continue;
      if (mundo.progresoObra[i] >= 1) continue;
      if (mundo.vida[i] <= 0) continue;

      const obreros = mundo.obrerosEnObra[i];
      if (obreros === 0) continue;

      const ficha = fichaEdificio(mundo.tipo[i] as TipoEdificio);
      const rendimiento = 1 + (obreros - 1) * RENDIMIENTO_OBRERO_ADICIONAL;
      mundo.progresoObra[i] += (rendimiento / ficha.tiempoConstruccion) * dt;

      if (mundo.progresoObra[i] >= 1) {
        this.terminarObra(i);
      } else {
        // La vida acompaña al progreso: un andamio recién puesto se derriba de un soplo.
        mundo.vida[i] =
          mundo.vidaMaxima[i] * (VIDA_INICIAL_OBRA + (1 - VIDA_INICIAL_OBRA) * mundo.progresoObra[i]);
      }
    }
  }

  private terminarObra(i: number): void {
    const mundo = this.mundo;
    const lado = mundo.huella[i];
    const cx = mundo.casillaX[i];
    const cz = mundo.casillaZ[i];
    const entidad = mundo.entidadDeIndice(i);

    mundo.progresoObra[i] = 1;
    mundo.vida[i] = mundo.vidaMaxima[i];
    mundo.obrerosEnObra[i] = 0;
    mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);

    mundo.mapa.limpiarHuella(cx, cz, lado, Bloqueo.OBRA);
    mundo.mapa.marcarHuella(cx, cz, lado, Bloqueo.EDIFICIO, entidad);

    registrarEdificioTerminado(mundo, i);
    this.buscador.invalidarRegion(cx, cz, lado);

    this.bus.emitir('producidoTerminado', {
      entidad,
      productor: entidad,
      bando: mundo.bando[i] as Bando,
    });
  }
}
