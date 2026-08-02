import { bus as busGlobal } from '../core/events';
import { TAU } from '../core/math';
import { DISPERSION_FORMACION } from './constantes';
import { fichaEdificio } from './datos/edificios';
import { fichaUnidad } from './datos/unidades';
import { centroDeHuella, liberarYacimientoMemorizado } from './fabrica';
import { Mundo } from './mundo';
import { colocarAndamio } from './sistemas/construccion';
import {
  Bando,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoEdificio,
  indiceDe,
} from './tipos';

/**
 * Órdenes del jugador.
 *
 * Es la única puerta por la que la capa de entrada (ratón, teclado, IA) toca la
 * simulación. Aquí se valida todo lo que hay que validar —propiedad, capacidades,
 * recursos, tecnología— y se deja el mundo en un estado que los sistemas del tick
 * saben interpretar. Ningún sistema pregunta jamás «¿quién hizo clic?»: solo lee
 * `orden`, `ordenX/Z` y `ordenObjetivo`.
 *
 * Dos decisiones de diseño que conviene no deshacer:
 *
 *  - Una orden a un grupo NO manda a todo el mundo al mismo punto. Se reparte en
 *    anillos con `DISPERSION_FORMACION` de separación, porque doce unidades
 *    empujándose por ocupar la misma casilla es la primera cosa que delata a un RTS
 *    mal hecho.
 *  - Emitir una orden nunca mueve nada por sí sola: solo escribe la intención. Quien
 *    convierte «quiero recolectar» en pasos es el sistema correspondiente.
 */

// --- Ajustes propios del módulo (no existían en constantes.ts) ---

/** Cuántas plazas tiene el primer anillo de la formación. Los siguientes crecen igual. */
const PLAZAS_POR_ANILLO = 6;

/** Radio de búsqueda de casilla libre al colocar a alguien en formación. */
const RADIO_ENCAJE_FORMACION = 4;

// --- Enganche con el sistema de movimiento ---

/**
 * El módulo de órdenes necesita poder cortar un desplazamiento en curso (una orden
 * nueva invalida la anterior), pero no debe depender del sistema de movimiento ni
 * cargarlo. Se registra desde el orquestador, igual que la evitación en `movimiento.ts`.
 */
export interface FrenoMovimiento {
  detener(indice: number): void;
}

let frenoRegistrado: FrenoMovimiento | null = null;

export function registrarFrenoMovimiento(freno: FrenoMovimiento | null): void {
  frenoRegistrado = freno;
}

// --- Estructuras de trabajo reutilizadas ---

/** Índices del grupo que recibe la orden. Se vacía y se rellena en cada llamada. */
const grupo: number[] = [];
const punto = { x: 0, z: 0 };

// --- Utilidades públicas ---

/** ¿Puede esta entidad recibir órdenes de ese bando? */
export function esControlable(mundo: Mundo, entidad: Entidad, bando?: Bando): boolean {
  if (!mundo.esValida(entidad)) return false;
  const i = indiceDe(entidad);
  if (mundo.clase[i] !== Clase.UNIDAD) return false;
  if (mundo.vida[i] <= 0) return false;
  if (mundo.estado[i] === EstadoUnidad.MURIENDO) return false;
  if (mundo.bando[i] === Bando.NEUTRAL) return false;
  if (bando !== undefined && mundo.bando[i] !== bando) return false;
  return true;
}

export function esObrero(mundo: Mundo, i: number): boolean {
  if (mundo.clase[i] !== Clase.UNIDAD) return false;
  return fichaUnidad(mundo.tipo[i]).esObrero;
}

/**
 * Punto que le toca a la unidad número `k` de un grupo de `total`, alrededor de
 * (baseX, baseZ). Anillos concéntricos: uno en el centro, seis en el primer anillo,
 * doce en el segundo… El resultado se escribe en `salida` para no reservar memoria.
 */
export function puntoDeFormacion(
  mundo: Mundo,
  k: number,
  baseX: number,
  baseZ: number,
  salida: { x: number; z: number },
): void {
  if (k === 0) {
    salida.x = baseX;
    salida.z = baseZ;
  } else {
    let restante = k;
    let anillo = 1;
    while (restante > anillo * PLAZAS_POR_ANILLO) {
      restante -= anillo * PLAZAS_POR_ANILLO;
      anillo++;
    }
    const plazas = anillo * PLAZAS_POR_ANILLO;
    const angulo = ((restante - 1) / plazas) * TAU;
    salida.x = baseX + Math.sin(angulo) * anillo * DISPERSION_FORMACION;
    salida.z = baseZ + Math.cos(angulo) * anillo * DISPERSION_FORMACION;
  }

  // Encajar en suelo pisable: una plaza dentro de un edificio o de un lago condena
  // a la unidad a empujar una pared hasta que se rinda por atasco.
  const mapa = mundo.mapa;
  const cx = mapa.aCasilla(salida.x);
  const cz = mapa.aCasilla(salida.z);
  if (mapa.transitable(cx, cz)) return;
  const libre = mapa.casillaLibreMasCercana(cx, cz, RADIO_ENCAJE_FORMACION);
  if (!libre) return;
  salida.x = mapa.centroCasilla(libre[0]);
  salida.z = mapa.centroCasilla(libre[1]);
}

// --- Interior ---

/** Rellena `grupo` con los índices que de verdad pueden obedecer. */
function reunir(mundo: Mundo, entidades: readonly Entidad[], bando?: Bando): number {
  grupo.length = 0;
  for (let k = 0; k < entidades.length; k++) {
    const entidad = entidades[k]!;
    if (!esControlable(mundo, entidad, bando)) continue;
    grupo.push(indiceDe(entidad));
  }
  return grupo.length;
}

/** Bando del grupo ya reunido; NEUTRAL si está vacío. */
function bandoDelGrupo(mundo: Mundo): Bando {
  if (grupo.length === 0) return Bando.NEUTRAL;
  return mundo.bando[grupo[0]!] as Bando;
}

/**
 * Borra los restos de la orden anterior.
 *
 * Es donde se devuelve la plaza reservada en un yacimiento: si no se hiciera aquí,
 * un obrero al que se le manda hacer otra cosa dejaría su hueco ocupado para siempre
 * y a la larga nadie podría minar en esa veta.
 */
function limpiarOrdenPrevia(mundo: Mundo, i: number, conservaYacimiento: boolean): void {
  if (!conservaYacimiento) liberarYacimientoMemorizado(mundo, i);
  mundo.objetivoActual[i] = 0;
  mundo.ordenObjetivo[i] = 0;
  mundo.progresoTrabajo[i] = 0;
  if (frenoRegistrado) frenoRegistrado.detener(i);
  if (
    mundo.estado[i] === EstadoUnidad.RECOLECTANDO ||
    mundo.estado[i] === EstadoUnidad.CONSTRUYENDO ||
    mundo.estado[i] === EstadoUnidad.ATACANDO
  ) {
    mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
  }
}

/** Lista de entidades del grupo, para el evento. Las órdenes son raras: aquí sí se reserva. */
function entidadesDelGrupo(mundo: Mundo): Entidad[] {
  const lista: Entidad[] = [];
  for (let k = 0; k < grupo.length; k++) lista.push(mundo.entidadDeIndice(grupo[k]!));
  return lista;
}

function anunciar(
  mundo: Mundo,
  x: number,
  z: number,
  tipo: 'mover' | 'atacar' | 'recolectar' | 'construir' | 'patrullar' | 'mantener',
  objetivo: Entidad,
): void {
  busGlobal.emitir('ordenEmitida', {
    entidades: entidadesDelGrupo(mundo),
    x,
    z,
    tipo,
    objetivo,
  });
}

function avisar(texto: string, clave: string, x: number, z: number): void {
  busGlobal.emitir('aviso', { texto, severidad: 'alerta', x, z, clave });
}

// --- Órdenes ---

/** Desplazamiento simple. Devuelve cuántas unidades han aceptado la orden. */
export function ordenarMover(
  mundo: Mundo,
  entidades: readonly Entidad[],
  x: number,
  z: number,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;

  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    puntoDeFormacion(mundo, k, x, z, punto);
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.MOVER;
    mundo.ordenX[i] = punto.x;
    mundo.ordenZ[i] = punto.z;
    // El destino pasa a ser el puesto: es desde ahí desde donde se mide la correa
    // de persecución cuando la unidad entre en combate por su cuenta.
    mundo.anclaX[i] = punto.x;
    mundo.anclaZ[i] = punto.z;
  }

  anunciar(mundo, x, z, 'mover', ENTIDAD_NULA);
  return grupo.length;
}

/** Atacar a un blanco concreto. Persigue hasta matarlo, sin correa. */
export function ordenarAtacar(
  mundo: Mundo,
  entidades: readonly Entidad[],
  objetivo: Entidad,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;
  if (!mundo.esValida(objetivo)) return 0;

  const j = indiceDe(objetivo);
  if (!mundo.sonEnemigos(bandoDelGrupo(mundo), mundo.bando[j])) return 0;
  if (mundo.clase[j] !== Clase.UNIDAD && mundo.clase[j] !== Clase.EDIFICIO) return 0;

  let aceptadas = 0;
  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    // Un obrero puede pegar, pero con 1-5 de daño no es una orden que tenga sentido
    // dar a la ligera; se acepta igual, es decisión del jugador.
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.ATACAR;
    mundo.ordenObjetivo[i] = objetivo;
    mundo.objetivoActual[i] = objetivo;
    mundo.ordenX[i] = mundo.x[j];
    mundo.ordenZ[i] = mundo.z[j];
    mundo.anclaX[i] = mundo.x[i];
    mundo.anclaZ[i] = mundo.z[i];
    aceptadas++;
  }

  anunciar(mundo, mundo.x[j], mundo.z[j], 'atacar', objetivo);
  return aceptadas;
}

/** Avanzar hacia un punto barriendo lo que aparezca por el camino. */
export function ordenarAtacarMover(
  mundo: Mundo,
  entidades: readonly Entidad[],
  x: number,
  z: number,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;

  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    puntoDeFormacion(mundo, k, x, z, punto);
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.ATACAR_MOVER;
    mundo.ordenX[i] = punto.x;
    mundo.ordenZ[i] = punto.z;
    mundo.anclaX[i] = punto.x;
    mundo.anclaZ[i] = punto.z;
  }

  anunciar(mundo, x, z, 'atacar', ENTIDAD_NULA);
  return grupo.length;
}

/** Mandar obreros a una veta o a un árbol. Los que no son obreros se quedan fuera. */
export function ordenarRecolectar(
  mundo: Mundo,
  entidades: readonly Entidad[],
  yacimiento: Entidad,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;
  if (!mundo.esValida(yacimiento)) return 0;

  const y = indiceDe(yacimiento);
  if (mundo.clase[y] !== Clase.YACIMIENTO) return 0;
  if (mundo.reserva[y] <= 0) return 0;

  let aceptadas = 0;
  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    if (!esObrero(mundo, i)) continue;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.RECOLECTAR;
    mundo.ordenObjetivo[i] = yacimiento;
    mundo.ordenX[i] = mundo.x[y];
    mundo.ordenZ[i] = mundo.z[y];
    aceptadas++;
  }

  if (aceptadas === 0) {
    avisar('Solo los campesinos pueden recolectar.', 'sin-obreros', mundo.x[y], mundo.z[y]);
    return 0;
  }

  anunciar(mundo, mundo.x[y], mundo.z[y], 'recolectar', yacimiento);
  return aceptadas;
}

/**
 * Colocar un edificio nuevo y mandar a los obreros del grupo a levantarlo.
 * El coste se cobra al colocar el andamio, no al terminarlo: así el jugador no puede
 * gastarse dos veces el mismo oro mientras la obra avanza.
 */
export function ordenarConstruir(
  mundo: Mundo,
  entidades: readonly Entidad[],
  tipo: TipoEdificio,
  cx: number,
  cz: number,
  bando?: Bando,
): Entidad {
  if (reunir(mundo, entidades, bando) === 0) return ENTIDAD_NULA;

  // Sin obreros no hay obra: mejor no cobrar y avisar.
  let hayObreros = false;
  for (let k = 0; k < grupo.length; k++) {
    if (esObrero(mundo, grupo[k]!)) {
      hayObreros = true;
      break;
    }
  }
  const lado = fichaEdificio(tipo).huella;
  const centroX = centroDeHuella(cx, lado);
  const centroZ = centroDeHuella(cz, lado);
  if (!hayObreros) {
    avisar('Hace falta un campesino para construir.', 'sin-obreros', centroX, centroZ);
    return ENTIDAD_NULA;
  }

  const andamio = colocarAndamio(mundo, bandoDelGrupo(mundo), tipo, cx, cz);
  if (andamio === ENTIDAD_NULA) return ENTIDAD_NULA;

  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    if (!esObrero(mundo, i)) continue;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.CONSTRUIR;
    mundo.ordenObjetivo[i] = andamio;
    mundo.ordenX[i] = centroX;
    mundo.ordenZ[i] = centroZ;
  }

  anunciar(mundo, centroX, centroZ, 'construir', andamio);
  return andamio;
}

/** Sumar obreros a un andamio que ya está en pie. */
export function ordenarAyudarConstruir(
  mundo: Mundo,
  entidades: readonly Entidad[],
  andamio: Entidad,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;
  if (!mundo.esValida(andamio)) return 0;

  const o = indiceDe(andamio);
  if (mundo.clase[o] !== Clase.EDIFICIO) return 0;
  if (mundo.progresoObra[o] >= 1) return 0;
  if (mundo.bando[o] !== bandoDelGrupo(mundo)) return 0;

  let aceptadas = 0;
  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    if (!esObrero(mundo, i)) continue;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.CONSTRUIR;
    mundo.ordenObjetivo[i] = andamio;
    mundo.ordenX[i] = mundo.x[o];
    mundo.ordenZ[i] = mundo.z[o];
    aceptadas++;
  }

  if (aceptadas > 0) anunciar(mundo, mundo.x[o], mundo.z[o], 'construir', andamio);
  return aceptadas;
}

/** Reparar un edificio propio dañado. Cuesta recursos mientras dura. */
export function ordenarReparar(
  mundo: Mundo,
  entidades: readonly Entidad[],
  objetivo: Entidad,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;
  if (!mundo.esValida(objetivo)) return 0;

  const o = indiceDe(objetivo);
  if (mundo.clase[o] !== Clase.EDIFICIO) return 0;
  if (mundo.bando[o] !== bandoDelGrupo(mundo)) return 0;
  if (mundo.progresoObra[o] < 1) return ordenarAyudarConstruir(mundo, entidades, objetivo, bando);
  if (mundo.vida[o] >= mundo.vidaMaxima[o]) return 0;

  let aceptadas = 0;
  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    if (!esObrero(mundo, i)) continue;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.REPARAR;
    mundo.ordenObjetivo[i] = objetivo;
    mundo.ordenX[i] = mundo.x[o];
    mundo.ordenZ[i] = mundo.z[o];
    aceptadas++;
  }

  if (aceptadas > 0) anunciar(mundo, mundo.x[o], mundo.z[o], 'construir', objetivo);
  return aceptadas;
}

/** Ir y volver entre el punto actual y el indicado hasta nueva orden. */
export function ordenarPatrullar(
  mundo: Mundo,
  entidades: readonly Entidad[],
  x: number,
  z: number,
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;

  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    puntoDeFormacion(mundo, k, x, z, punto);
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.PATRULLAR;
    mundo.ordenX[i] = punto.x;
    mundo.ordenZ[i] = punto.z;
    // El ancla es la otra mitad del recorrido: al llegar, el movimiento las intercambia.
    mundo.anclaX[i] = mundo.x[i];
    mundo.anclaZ[i] = mundo.z[i];
  }

  anunciar(mundo, x, z, 'patrullar', ENTIDAD_NULA);
  return grupo.length;
}

/** Quedarse clavado: dispara a lo que se acerque pero no da un paso. */
export function ordenarMantenerPosicion(
  mundo: Mundo,
  entidades: readonly Entidad[],
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;

  let centroX = 0;
  let centroZ = 0;
  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.MANTENER_POSICION;
    mundo.ordenX[i] = mundo.x[i];
    mundo.ordenZ[i] = mundo.z[i];
    mundo.anclaX[i] = mundo.x[i];
    mundo.anclaZ[i] = mundo.z[i];
    centroX += mundo.x[i];
    centroZ += mundo.z[i];
  }

  anunciar(mundo, centroX / grupo.length, centroZ / grupo.length, 'mantener', ENTIDAD_NULA);
  return grupo.length;
}

/** Detenerse y olvidar lo que estuviera haciendo. */
export function cancelarOrden(
  mundo: Mundo,
  entidades: readonly Entidad[],
  bando?: Bando,
): number {
  if (reunir(mundo, entidades, bando) === 0) return 0;

  for (let k = 0; k < grupo.length; k++) {
    const i = grupo[k]!;
    limpiarOrdenPrevia(mundo, i, false);
    mundo.orden[i] = Orden.NINGUNA;
    mundo.ordenX[i] = mundo.x[i];
    mundo.ordenZ[i] = mundo.z[i];
    mundo.anclaX[i] = mundo.x[i];
    mundo.anclaZ[i] = mundo.z[i];
    mundo.cambiarEstado(i, EstadoUnidad.INACTIVO);
  }

  return grupo.length;
}

/**
 * La orden del botón derecho: una sola acción que hace lo que el jugador espera
 * según lo que haya bajo el cursor. Es, con diferencia, el 90 % de las órdenes de
 * una partida, así que su tabla de decisiones merece estar en un solo sitio y clara.
 */
export function ordenContextual(
  mundo: Mundo,
  entidades: readonly Entidad[],
  x: number,
  z: number,
  objetivo: Entidad,
): number {
  if (reunir(mundo, entidades) === 0) return 0;
  const bando = bandoDelGrupo(mundo);

  if (mundo.esValida(objetivo)) {
    const o = indiceDe(objetivo);
    const clase = mundo.clase[o];

    if (
      (clase === Clase.UNIDAD || clase === Clase.EDIFICIO) &&
      mundo.sonEnemigos(bando, mundo.bando[o])
    ) {
      return ordenarAtacar(mundo, entidades, objetivo, bando);
    }

    if (clase === Clase.YACIMIENTO && mundo.reserva[o] > 0) {
      const recolectando = ordenarRecolectar(mundo, entidades, objetivo, bando);
      if (recolectando > 0) return recolectando;
      return ordenarMover(mundo, entidades, x, z, bando);
    }

    if (clase === Clase.EDIFICIO && mundo.bando[o] === bando) {
      if (mundo.progresoObra[o] < 1) {
        const ayudando = ordenarAyudarConstruir(mundo, entidades, objetivo, bando);
        if (ayudando > 0) return ayudando;
      } else if (mundo.vida[o] < mundo.vidaMaxima[o]) {
        const reparando = ordenarReparar(mundo, entidades, objetivo, bando);
        if (reparando > 0) return reparando;
      }
      return ordenarMover(mundo, entidades, x, z, bando);
    }
  }

  return ordenarMover(mundo, entidades, x, z, bando);
}
