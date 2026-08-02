import { BusEventos, bus as busGlobal } from '../../core/events';
import { distanciaCuadrada } from '../../core/math';
import {
  CARGA_MADERA,
  CARGA_ORO,
  TIEMPO_MINADO,
  TIEMPO_TALA,
  TOLERANCIA_DESTINO,
} from '../constantes';
import { fichaEdificio } from '../datos/edificios';
import { fichaUnidad } from '../datos/unidades';
import { liberarYacimientoMemorizado, recursoDeYacimiento, retirarEntidad } from '../fabrica';
import { Mundo } from '../mundo';
import {
  Bando,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoEdificio,
  TipoRecurso,
  TipoUnidad,
  TipoYacimiento,
  indiceDe,
} from '../tipos';
import { ALCANCE_TRABAJO, invalidarRutasEn } from './construccion';
import type { SistemaMovimiento } from './movimiento';

/**
 * Sistema de recolección.
 *
 * El bucle económico entero vive aquí: ir a la veta, picar, llenar la carga, buscar el
 * depósito propio más cercano, entregar y volver a la MISMA veta. Ese «volver a la
 * misma» es la parte que el jugador no ve pero sí nota: si el obrero eligiera destino
 * nuevo tras cada entrega, las cuadrillas se descolocarían solas cada minuto.
 *
 * El reparto se hace con `ocupacionYacimiento`: al elegir yacimiento se penaliza el que
 * ya tiene gente, de modo que ocho campesinos sobre un bosque se abren en abanico en vez
 * de pelearse por el mismo tronco.
 */

// --- Ajustes propios del sistema (no existían en constantes.ts) ---

/** Radio en casillas en el que un obrero busca otra veta cuando la suya se agota. */
export const RADIO_BUSQUEDA_YACIMIENTO = 14;

/** Radio en el que se busca un depósito antes de recorrer el mundo entero. */
export const RADIO_BUSQUEDA_DEPOSITO = 24;

/**
 * Casillas de penalización por cada obrero ya asignado a un yacimiento.
 * Es lo que reparte la cuadrilla: con 3 casillas, un obrero prefiere caminar tres más
 * antes que ser el segundo en el mismo árbol.
 */
export const PESO_OCUPACION = 3;

// --- Utilidades públicas ---

export function esDeposito(mundo: Mundo, i: number): boolean {
  if (mundo.clase[i] !== Clase.EDIFICIO) return false;
  if (mundo.progresoObra[i] < 1) return false;
  if (mundo.vida[i] <= 0) return false;
  return fichaEdificio(mundo.tipo[i] as TipoEdificio).esDeposito;
}

export function tiempoDeExtraccion(tipo: TipoYacimiento): number {
  return tipo === TipoYacimiento.MINA_ORO ? TIEMPO_MINADO : TIEMPO_TALA;
}

export function cargaPorViaje(tipo: TipoYacimiento): number {
  return tipo === TipoYacimiento.MINA_ORO ? CARGA_ORO : CARGA_MADERA;
}

/**
 * Depósito propio más cercano. Recorre todas las entidades en lugar de usar la rejilla
 * espacial a propósito: hay muy pocos depósitos y esto solo se llama cuando un obrero
 * llena la carga, no cada tick.
 */
export function depositoMasCercano(mundo: Mundo, i: number): Entidad {
  const bando = mundo.bando[i];
  let mejor = ENTIDAD_NULA;
  let mejorDistancia = Infinity;
  for (let j = 1; j <= mundo.indiceMaximo; j++) {
    if (mundo.activos[j] !== 1) continue;
    if (mundo.bando[j] !== bando) continue;
    if (!esDeposito(mundo, j)) continue;
    const d = distanciaCuadrada(mundo.x[i], mundo.z[i], mundo.x[j], mundo.z[j]);
    if (d < mejorDistancia) {
      mejorDistancia = d;
      mejor = mundo.entidadDeIndice(j);
    }
  }
  return mejor;
}

// --- Sistema ---

export class SistemaRecoleccion {
  readonly mundo: Mundo;
  readonly movimiento: SistemaMovimiento;
  readonly bus: BusEventos;

  /** Estado del visitante de búsqueda; evita crear un cierre por consulta. */
  private buscadorDesdeX = 0;
  private buscadorDesdeZ = 0;
  private buscadorTipo = 0;
  private mejorYacimiento = 0;
  private mejorPuntuacion = Infinity;
  private readonly visitanteYacimiento: (indice: number) => void;

  constructor(mundo: Mundo, movimiento: SistemaMovimiento, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.movimiento = movimiento;
    this.bus = bus;
    this.visitanteYacimiento = (indice: number): void => this.evaluarYacimiento(indice);
  }

  paso(dt: number): void {
    const mundo = this.mundo;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.UNIDAD) continue;
      if (mundo.vida[i] <= 0) continue;
      if (!fichaUnidad(mundo.tipo[i] as TipoUnidad).esObrero) continue;

      const orden = mundo.orden[i];
      if (orden === Orden.RECOLECTAR) this.recolectar(i, dt);
      else if (orden === Orden.DEVOLVER) this.devolver(i);
    }
  }

  // --- Ida: picar y talar ---

  private recolectar(i: number, dt: number): void {
    const mundo = this.mundo;
    const capacidad = fichaUnidad(mundo.tipo[i] as TipoUnidad).capacidadCarga;

    // Con la carga llena no hay nada que hacer aquí: toca volver.
    if (mundo.cargaCantidad[i] >= capacidad) {
      this.pasarADevolver(i);
      return;
    }

    let yacimiento = mundo.ordenObjetivo[i];
    if (!this.esYacimientoUtil(yacimiento)) yacimiento = mundo.yacimientoMemorizado[i];
    if (!this.esYacimientoUtil(yacimiento)) {
      yacimiento = this.buscarYacimiento(i, this.tipoDeseado(i));
      if (yacimiento === ENTIDAD_NULA) {
        this.abandonar(i);
        return;
      }
    }

    // Reservar la plaza en cuanto se elige, no al llegar: si no, cinco obreros salen a
    // la vez hacia el mismo árbol porque ninguno lo ve ocupado todavía.
    if (mundo.yacimientoMemorizado[i] !== yacimiento) this.asignarYacimiento(i, yacimiento);
    mundo.ordenObjetivo[i] = yacimiento;

    const y = indiceDe(yacimiento);
    if (mundo.distanciaEntreBordes(i, y) > ALCANCE_TRABAJO) {
      const tolerancia = Math.max(
        TOLERANCIA_DESTINO,
        mundo.radio[i] + mundo.radio[y] + ALCANCE_TRABAJO * 0.75,
      );
      this.movimiento.solicitarMovimiento(i, mundo.x[y], mundo.z[y], tolerancia);
      if (this.movimiento.haFallado(i)) this.abandonar(i);
      return;
    }

    this.movimiento.detener(i);
    mundo.angulo[i] = Math.atan2(mundo.x[y] - mundo.x[i], mundo.z[y] - mundo.z[i]);
    mundo.cambiarEstado(i, EstadoUnidad.RECOLECTANDO);

    const tipoYacimiento = mundo.tipo[y] as TipoYacimiento;
    const duracion = tiempoDeExtraccion(tipoYacimiento);
    mundo.progresoTrabajo[i] += dt;
    if (mundo.progresoTrabajo[i] < duracion) return;

    mundo.progresoTrabajo[i] -= duracion;
    const hueco = capacidad - mundo.cargaCantidad[i];
    const extraido = Math.min(hueco, cargaPorViaje(tipoYacimiento), mundo.reserva[y]);
    mundo.reserva[y] -= extraido;
    mundo.cargaTipo[i] = recursoDeYacimiento(tipoYacimiento);
    mundo.cargaCantidad[i] += extraido;

    if (mundo.reserva[y] <= 0) this.agotar(y);

    if (mundo.cargaCantidad[i] >= capacidad || extraido <= 0) this.pasarADevolver(i);
  }

  /** La veta o el árbol se acaban: desaparecen del mapa y liberan su casilla. */
  private agotar(y: number): void {
    const mundo = this.mundo;
    const entidad = mundo.entidadDeIndice(y);
    const tipo = mundo.tipo[y] as TipoYacimiento;
    const cx = mundo.casillaX[y];
    const cz = mundo.casillaZ[y];

    this.bus.emitir('recursoAgotado', {
      entidad,
      tipo: recursoDeYacimiento(tipo),
      x: mundo.x[y],
      z: mundo.z[y],
    });

    // Retirar limpia el bloqueo; avisar al buscador es lo que permite que las rutas
    // vuelvan a cruzar por donde antes había un árbol.
    retirarEntidad(mundo, y);
    invalidarRutasEn(cx, cz, 1);
  }

  // --- Vuelta: entregar ---

  private pasarADevolver(i: number): void {
    const mundo = this.mundo;
    mundo.orden[i] = Orden.DEVOLVER;
    mundo.ordenObjetivo[i] = ENTIDAD_NULA;
    mundo.progresoTrabajo[i] = 0;
    if (mundo.estado[i] === EstadoUnidad.RECOLECTANDO) {
      mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
    }
  }

  private devolver(i: number): void {
    const mundo = this.mundo;

    if (mundo.cargaCantidad[i] <= 0) {
      this.volverAlYacimiento(i);
      return;
    }

    let deposito = mundo.ordenObjetivo[i];
    if (!this.esDepositoUtil(i, deposito)) {
      deposito = depositoMasCercano(mundo, i);
      if (deposito === ENTIDAD_NULA) {
        this.bus.emitir('aviso', {
          texto: 'No queda ningún sitio donde dejar los recursos.',
          severidad: 'alerta',
          x: mundo.x[i],
          z: mundo.z[i],
          clave: 'sin-deposito',
        });
        this.abandonar(i);
        return;
      }
      mundo.ordenObjetivo[i] = deposito;
    }

    const d = indiceDe(deposito);
    if (mundo.distanciaEntreBordes(i, d) > ALCANCE_TRABAJO) {
      const tolerancia = Math.max(
        TOLERANCIA_DESTINO,
        mundo.radio[i] + mundo.radio[d] + ALCANCE_TRABAJO * 0.75,
      );
      this.movimiento.solicitarMovimiento(i, mundo.x[d], mundo.z[d], tolerancia);
      if (this.movimiento.haFallado(i)) {
        // Depósito inalcanzable: se prueba con otro en el siguiente tick.
        mundo.ordenObjetivo[i] = ENTIDAD_NULA;
        this.movimiento.detener(i);
      }
      return;
    }

    this.movimiento.detener(i);
    this.entregar(i, d);
    this.volverAlYacimiento(i);
  }

  private entregar(i: number, d: number): void {
    const mundo = this.mundo;
    const bando = mundo.bando[i] as Bando;
    const estado = mundo.estadoDe(bando);
    const cantidad = mundo.cargaCantidad[i];
    const tipo = mundo.cargaTipo[i] as TipoRecurso;

    if (tipo === TipoRecurso.ORO) {
      estado.oro += cantidad;
      estado.oroRecogido += cantidad;
    } else {
      estado.madera += cantidad;
      estado.maderaRecogida += cantidad;
    }

    mundo.cargaCantidad[i] = 0;

    this.bus.emitir('recursoEntregado', {
      obrero: mundo.entidadDeIndice(i),
      deposito: mundo.entidadDeIndice(d),
      tipo,
      cantidad,
      bando,
    });
  }

  /** Tras entregar, el obrero vuelve a la veta que memorizó; si ya no está, busca otra. */
  private volverAlYacimiento(i: number): void {
    const mundo = this.mundo;
    let destino = mundo.yacimientoMemorizado[i];
    if (!this.esYacimientoUtil(destino)) {
      liberarYacimientoMemorizado(mundo, i);
      destino = this.buscarYacimiento(i, this.tipoDeseado(i));
      if (destino === ENTIDAD_NULA) {
        this.abandonar(i);
        return;
      }
      this.asignarYacimiento(i, destino);
    }
    mundo.orden[i] = Orden.RECOLECTAR;
    mundo.ordenObjetivo[i] = destino;
    mundo.progresoTrabajo[i] = 0;
  }

  // --- Elección de yacimiento ---

  private tipoDeseado(i: number): TipoYacimiento {
    return this.mundo.cargaTipo[i] === TipoRecurso.MADERA
      ? TipoYacimiento.ARBOL
      : TipoYacimiento.MINA_ORO;
  }

  private esYacimientoUtil(entidad: Entidad): boolean {
    const mundo = this.mundo;
    if (!mundo.esValida(entidad)) return false;
    const y = indiceDe(entidad);
    if (mundo.clase[y] !== Clase.YACIMIENTO) return false;
    return mundo.reserva[y] > 0;
  }

  private esDepositoUtil(i: number, entidad: Entidad): boolean {
    const mundo = this.mundo;
    if (!mundo.esValida(entidad)) return false;
    const d = indiceDe(entidad);
    if (mundo.bando[d] !== mundo.bando[i]) return false;
    return esDeposito(mundo, d);
  }

  private asignarYacimiento(i: number, yacimiento: Entidad): void {
    const mundo = this.mundo;
    liberarYacimientoMemorizado(mundo, i);
    mundo.yacimientoMemorizado[i] = yacimiento;
    const y = indiceDe(yacimiento);
    if (mundo.ocupacionYacimiento[y] < 255) mundo.ocupacionYacimiento[y]++;
    // El tipo de recurso solo se fija con las manos vacías: si no, un obrero cargado
    // de oro que pasa junto a un bosque entregaría madera.
    if (mundo.cargaCantidad[i] <= 0) {
      mundo.cargaTipo[i] = recursoDeYacimiento(mundo.tipo[y] as TipoYacimiento);
    }
  }

  private buscarYacimiento(i: number, tipo: TipoYacimiento): Entidad {
    const mundo = this.mundo;
    this.buscadorDesdeX = mundo.x[i];
    this.buscadorDesdeZ = mundo.z[i];
    this.buscadorTipo = tipo;
    this.mejorYacimiento = 0;
    this.mejorPuntuacion = Infinity;

    mundo.consultarRadio(
      mundo.x[i],
      mundo.z[i],
      RADIO_BUSQUEDA_YACIMIENTO,
      this.visitanteYacimiento,
    );

    if (this.mejorYacimiento === 0) return ENTIDAD_NULA;
    return mundo.entidadDeIndice(this.mejorYacimiento);
  }

  private evaluarYacimiento(j: number): void {
    const mundo = this.mundo;
    if (mundo.clase[j] !== Clase.YACIMIENTO) return;
    if (mundo.tipo[j] !== this.buscadorTipo) return;
    if (mundo.reserva[j] <= 0) return;

    const distancia = Math.sqrt(
      distanciaCuadrada(this.buscadorDesdeX, this.buscadorDesdeZ, mundo.x[j], mundo.z[j]),
    );
    const puntuacion = distancia + mundo.ocupacionYacimiento[j] * PESO_OCUPACION;
    // Desempate por índice: sin él, dos yacimientos idénticos podrían elegirse en
    // distinto orden según el recorrido de la rejilla y la partida dejaría de repetirse.
    if (
      puntuacion < this.mejorPuntuacion ||
      (puntuacion === this.mejorPuntuacion && j < this.mejorYacimiento)
    ) {
      this.mejorPuntuacion = puntuacion;
      this.mejorYacimiento = j;
    }
  }

  private abandonar(i: number): void {
    const mundo = this.mundo;
    liberarYacimientoMemorizado(mundo, i);
    mundo.orden[i] = Orden.NINGUNA;
    mundo.ordenObjetivo[i] = ENTIDAD_NULA;
    mundo.progresoTrabajo[i] = 0;
    this.movimiento.detener(i);
    if (mundo.estado[i] === EstadoUnidad.RECOLECTANDO) {
      mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
    }
  }
}
