import { BandoCampana, type IdTerritorio } from './tipos';

/**
 * La geografía de la campaña: dieciocho territorios, sus fronteras y lo que valen.
 *
 * Todo lo de este fichero es constante durante la partida. Lo que cambia —quién
 * manda en cada sitio— vive en `EstadoCampana`. La separación no es un capricho:
 * permite guardar y restaurar una partida entera con un puñado de enteros, sin
 * arrastrar la geometría.
 *
 * ── Sobre el dibujo ──────────────────────────────────────────────────────────
 * Los contornos no son losas sueltas: entre todos componen la silueta del país
 * —la costa oeste en diagonal, la frontera recta del norte, el golfo de México,
 * la península de Florida y la costa este subiendo hasta Nueva Inglaterra—. La
 * primera versión eran dieciocho cuadriláteros y el mapa no se reconocía; que se
 * vea de un vistazo dónde está uno es la mitad de lo que hace legible un mapa de
 * campaña.
 *
 * Y no se escriben vértice a vértice: se arman con los puntos del retículo `V`.
 * La razón es una errata que costó encontrar. Arkansas terminaba en `y = 34` y
 * Luisiana empezaba en `y = 33`: sobre el papel, una franja blanca de una unidad
 * de ancho cruzando el Sur de lado a lado. Con dieciocho polígonos escritos a
 * mano ese fallo es cuestión de tiempo. Compartiendo el vértice —literalmente el
 * mismo objeto— la costura no puede abrirse, y lo que antes era vigilancia pasa
 * a ser imposible por construcción.
 *
 * Todos los contornos van en sentido antihorario. No es decorativo: la prueba
 * que comprueba que el mapa no tiene huecos se apoya en ello para emparejar cada
 * frontera interior con su gemela recorrida al revés.
 *
 * ── Sobre las coordenadas ────────────────────────────────────────────────────
 * `x` va de 0 (Pacífico) a 100 (Atlántico) e `y` de 0 (golfo de México) a 100
 * (frontera canadiense). Son las que usa el render para colocar el mapa y las
 * fichas, y también las que usa la IA para saber qué es «avanzar hacia el enemigo».
 * No pretenden ser una proyección cartográfica: son un mapa de cómic, estilizado
 * para que se lea de un vistazo en una pantalla de móvil.
 *
 * La línea del frente inicial cae sobre y ≈ 55, la vieja línea Mason-Dixon. Los
 * siete pasos que la cruzan (California–Nuevo México, Nebraska–Nuevo México,
 * Nebraska–Arkansas, Illinois–Arkansas, Illinois–Tennessee, Pensilvania–Tennessee
 * y Pensilvania–Virginia) son, a propósito, los cuellos de botella de la partida:
 * pocos, repartidos y todos defendibles.
 */

export interface Territorio {
  readonly id: IdTerritorio;
  readonly nombre: string;
  /** Centro del territorio: dónde se planta la ficha del ejército. */
  readonly x: number;
  readonly y: number;
  /** Contorno para dibujarlo, en las mismas coordenadas que el centro. */
  readonly contorno: readonly (readonly [number, number])[];
  readonly vecinos: readonly IdTerritorio[];
  /** Monedas por turno mientras se controle. */
  readonly renta: number;
  /** Recibe refuerzos por mar: es donde desembarcan las tropas compradas. */
  readonly puerto: boolean;
  /** Tiene fortificación: se asalta en su propia escena y defiende mejor. */
  readonly fuerte: boolean;
  /** Sede del gobierno. Perderla es perder la guerra. */
  readonly capitalDe: BandoCampana;
  readonly duenoInicial: BandoCampana;
}

const U = BandoCampana.UNION;
const C = BandoCampana.CONFEDERACION;
const N = BandoCampana.NINGUNO;

type Punto = readonly [number, number];
const p = (x: number, y: number): Punto => [x, y];

/**
 * El retículo del que salen todos los contornos.
 *
 * Cada punto que dos o más territorios comparten está aquí una sola vez, con un
 * nombre que dice qué separa. Los grupos son las tres líneas horizontales que
 * organizan el país de norte a sur —la frontera canadiense, la línea de los
 * Grandes Lagos y el Misuri, y la Mason-Dixon— más el litoral.
 *
 * Que los nombres digan a quién separan («b» de la Mason-Dixon, `bArkansasTennessee`)
 * no es adorno: al retocar una frontera se ve de un vistazo a quién se le mueve
 * el suelo bajo los pies.
 */
const V = {
  // ── La frontera del norte, recta como la trazaron los tratados ────────────
  esquinaNoroeste: p(11, 93),
  nOregonDakota: p(31, 93),
  nDakotaMinnesota: p(50, 93),
  nMinnesotaMichigan: p(67, 93),
  nMichiganLagos: p(80, 92),
  lagos: p(85, 84),
  neCaboNorte: p(91, 87),
  neMaine: p(97, 81),

  // ── Línea «a»: los Grandes Lagos y el alto Misuri ─────────────────────────
  aCostaPacifico: p(13, 72),
  aOregonCalifornia: p(30, 72),
  aDakotaMinnesota: p(48, 72),
  aNebraskaIllinois: p(54, 72),
  aMinnesotaMichigan: p(65, 72),
  aIllinoisPensilvania: p(71, 71),
  aMichiganNuevaInglaterra: p(82, 70),
  aCostaAtlantico: p(95, 70),

  // ── Línea «b»: la Mason-Dixon, el frente inicial de la guerra ─────────────
  bCostaPacifico: p(17, 54),
  bCaliforniaNebraska: p(27, 54),
  bNuevoMexicoArkansas: p(33, 54),
  bNebraskaIllinois: p(48, 54),
  bArkansasTennessee: p(62, 54),
  bIllinoisPensilvania: p(70, 54),
  bTennesseeVirginia: p(84, 55),
  bCostaAtlantico: p(93, 57),

  // ── Línea «c»: el umbral del Sur profundo ─────────────────────────────────
  cFronteraSur: p(24, 33),
  cNuevoMexicoArkansas: p(44, 34),
  cTexasLuisiana: p(51, 36),
  cLuisianaMisisipi: p(66, 37),
  cArkansasTennessee: p(71, 38),
  cMisisipiCarolinas: p(80, 40),
  cTennesseeVirginia: p(86, 41),
  cCostaAtlantico: p(96, 47),

  // ── El Pacífico ───────────────────────────────────────────────────────────
  wCaliforniaSur: p(19, 44),

  // ── El golfo de México, de oeste a este ───────────────────────────────────
  gTexasOeste: p(27, 22),
  gTexasPunta: p(35, 7),
  gTexasEste: p(46, 11),
  gTexasLuisiana: p(52, 20),
  gDelta: p(61, 15),
  gLuisianaMisisipi: p(68, 20),
  gMisisipiFlorida: p(79, 21),
  gFloridaCarolinas: p(85, 24),

  // ── La península de Florida, que es lo que hace reconocible el mapa ───────
  fOeste: p(83, 12),
  fPunta: p(87, 3),
  fEste: p(91, 12),
  fNordeste: p(89, 24),

  // ── El Atlántico sur ──────────────────────────────────────────────────────
  eCarolinas: p(92, 30),
} as const;

/**
 * Los territorios, de oeste a este y de norte a sur.
 *
 * Los contornos son polígonos deliberadamente toscos —cuatro a seis vértices— con
 * la silueta justa para reconocer el país. Un trazado fiel se convertiría en papilla
 * en cuanto el mapa se dibuja del tamaño de un pulgar.
 */
export const TERRITORIOS: readonly Territorio[] = [
  // ── Unión (el Norte) ──────────────────────────────────────────────────────
  {
    id: 'oregon',
    nombre: 'Oregón',
    x: 21,
    y: 83,
    contorno: [V.aCostaPacifico, V.aOregonCalifornia, V.nOregonDakota, V.esquinaNoroeste],
    vecinos: ['california', 'dakota'],
    renta: 1,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'california',
    nombre: 'California',
    x: 22,
    y: 63,
    contorno: [
      V.bCostaPacifico, V.bCaliforniaNebraska, V.aOregonCalifornia, V.aCostaPacifico,
    ],
    vecinos: ['oregon', 'nebraska', 'nuevoMexico'],
    renta: 3,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'dakota',
    nombre: 'Dakota',
    x: 40,
    y: 82,
    contorno: [V.aOregonCalifornia, V.aDakotaMinnesota, V.nDakotaMinnesota, V.nOregonDakota],
    vecinos: ['oregon', 'nebraska', 'minnesota'],
    renta: 1,
    puerto: false,
    fuerte: true,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'nebraska',
    nombre: 'Nebraska',
    x: 40,
    y: 63,
    contorno: [
      V.bCaliforniaNebraska, V.bNuevoMexicoArkansas, V.bNebraskaIllinois, V.aNebraskaIllinois,
      V.aDakotaMinnesota, V.aOregonCalifornia,
    ],
    vecinos: ['california', 'dakota', 'minnesota', 'illinois', 'nuevoMexico', 'arkansas'],
    renta: 2,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'minnesota',
    nombre: 'Minnesota',
    x: 58,
    y: 81,
    contorno: [
      V.aDakotaMinnesota, V.aNebraskaIllinois, V.aMinnesotaMichigan, V.nMinnesotaMichigan,
      V.nDakotaMinnesota,
    ],
    vecinos: ['dakota', 'nebraska', 'illinois', 'michigan'],
    renta: 2,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'illinois',
    nombre: 'Illinois',
    x: 61,
    y: 63,
    contorno: [
      V.bNebraskaIllinois, V.bArkansasTennessee, V.bIllinoisPensilvania,
      V.aIllinoisPensilvania, V.aMinnesotaMichigan, V.aNebraskaIllinois,
    ],
    vecinos: ['nebraska', 'minnesota', 'michigan', 'pensilvania', 'arkansas', 'tennessee'],
    renta: 3,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'michigan',
    nombre: 'Michigan',
    x: 75,
    y: 80,
    contorno: [
      V.aMinnesotaMichigan, V.aIllinoisPensilvania, V.aMichiganNuevaInglaterra, V.lagos,
      V.nMichiganLagos, V.nMinnesotaMichigan,
    ],
    vecinos: ['minnesota', 'illinois', 'pensilvania'],
    renta: 2,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },
  {
    id: 'pensilvania',
    nombre: 'Pensilvania',
    x: 83,
    y: 63,
    contorno: [
      V.bIllinoisPensilvania, V.bTennesseeVirginia, V.bCostaAtlantico, V.aCostaAtlantico,
      V.aMichiganNuevaInglaterra, V.aIllinoisPensilvania,
    ],
    vecinos: ['michigan', 'illinois', 'nuevaInglaterra', 'virginia', 'tennessee'],
    renta: 3,
    puerto: false,
    fuerte: true,
    capitalDe: U,
    duenoInicial: U,
  },
  {
    id: 'nuevaInglaterra',
    nombre: 'Nueva Inglaterra',
    x: 90,
    y: 77,
    contorno: [
      V.aMichiganNuevaInglaterra, V.aCostaAtlantico, V.neMaine, V.neCaboNorte, V.lagos,
    ],
    vecinos: ['pensilvania'],
    renta: 3,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: U,
  },

  // ── Confederación (el Sur) ────────────────────────────────────────────────
  {
    id: 'nuevoMexico',
    nombre: 'Nuevo México',
    x: 28,
    y: 45,
    contorno: [
      V.cFronteraSur, V.cNuevoMexicoArkansas, V.bNuevoMexicoArkansas, V.bCaliforniaNebraska,
      V.bCostaPacifico, V.wCaliforniaSur,
    ],
    vecinos: ['california', 'nebraska', 'texas', 'arkansas'],
    renta: 1,
    puerto: false,
    fuerte: true,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'texas',
    nombre: 'Texas',
    x: 40,
    y: 22,
    contorno: [
      V.gTexasPunta, V.gTexasEste, V.gTexasLuisiana, V.cTexasLuisiana,
      V.cNuevoMexicoArkansas, V.cFronteraSur, V.gTexasOeste,
    ],
    vecinos: ['nuevoMexico', 'arkansas', 'luisiana'],
    renta: 2,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'arkansas',
    nombre: 'Arkansas',
    x: 54,
    y: 45,
    contorno: [
      V.cNuevoMexicoArkansas, V.cTexasLuisiana, V.cLuisianaMisisipi, V.cArkansasTennessee,
      V.bArkansasTennessee, V.bNebraskaIllinois, V.bNuevoMexicoArkansas,
    ],
    vecinos: ['nebraska', 'illinois', 'nuevoMexico', 'texas', 'luisiana', 'tennessee', 'misisipi'],
    renta: 2,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'luisiana',
    nombre: 'Luisiana',
    x: 60,
    y: 26,
    contorno: [
      V.gTexasLuisiana, V.gDelta, V.gLuisianaMisisipi, V.cLuisianaMisisipi, V.cTexasLuisiana,
    ],
    vecinos: ['texas', 'arkansas', 'misisipi'],
    renta: 3,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'tennessee',
    nombre: 'Tennessee',
    x: 76,
    y: 47,
    contorno: [
      V.cArkansasTennessee, V.cMisisipiCarolinas, V.cTennesseeVirginia, V.bTennesseeVirginia,
      V.bIllinoisPensilvania, V.bArkansasTennessee,
    ],
    vecinos: ['illinois', 'pensilvania', 'arkansas', 'misisipi', 'virginia', 'carolinas'],
    renta: 2,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'misisipi',
    nombre: 'Misisipi',
    x: 75,
    y: 30,
    contorno: [
      V.gLuisianaMisisipi, V.gMisisipiFlorida, V.gFloridaCarolinas, V.cMisisipiCarolinas,
      V.cArkansasTennessee, V.cLuisianaMisisipi,
    ],
    vecinos: ['luisiana', 'arkansas', 'tennessee', 'carolinas', 'florida'],
    // El algodón del delta: es el motor económico del Sur y, por estar en la
    // retaguardia profunda, lo último que se pierde. Le da al Sur algo que
    // defender lejos del frente, igual que Nueva Inglaterra al Norte.
    renta: 3,
    puerto: false,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'virginia',
    nombre: 'Virginia',
    x: 90,
    y: 50,
    contorno: [
      V.cTennesseeVirginia, V.cCostaAtlantico, V.bCostaAtlantico, V.bTennesseeVirginia,
    ],
    vecinos: ['pensilvania', 'tennessee', 'carolinas'],
    renta: 3,
    puerto: false,
    fuerte: true,
    capitalDe: C,
    duenoInicial: C,
  },
  {
    id: 'carolinas',
    nombre: 'las Carolinas',
    x: 88,
    y: 34,
    contorno: [
      V.gFloridaCarolinas, V.fNordeste, V.eCarolinas, V.cCostaAtlantico,
      V.cTennesseeVirginia, V.cMisisipiCarolinas,
    ],
    vecinos: ['virginia', 'tennessee', 'misisipi', 'florida'],
    renta: 2,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
  {
    id: 'florida',
    nombre: 'Florida',
    x: 86,
    y: 15,
    contorno: [
      V.gMisisipiFlorida, V.fOeste, V.fPunta, V.fEste, V.fNordeste, V.gFloridaCarolinas,
    ],
    vecinos: ['misisipi', 'carolinas'],
    renta: 2,
    puerto: true,
    fuerte: false,
    capitalDe: N,
    duenoInicial: C,
  },
];

/** Índice por id. Se consulta en cada tick de la IA: merece la pena tenerlo hecho. */
export const TERRITORIO_POR_ID: ReadonlyMap<IdTerritorio, Territorio> = new Map(
  TERRITORIOS.map((territorio) => [territorio.id, territorio]),
);

export function territorio(id: IdTerritorio): Territorio {
  const encontrado = TERRITORIO_POR_ID.get(id);
  if (!encontrado) throw new Error(`Territorio desconocido: ${id}`);
  return encontrado;
}

export function sonVecinos(a: IdTerritorio, b: IdTerritorio): boolean {
  return territorio(a).vecinos.includes(b);
}

/** La capital de un bando. Perderla termina la partida. */
export function capitalDe(bando: BandoCampana): Territorio {
  const encontrada = TERRITORIOS.find((t) => t.capitalDe === bando);
  if (!encontrada) throw new Error(`El bando ${bando} no tiene capital`);
  return encontrada;
}
