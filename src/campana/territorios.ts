import { BandoCampana, type IdTerritorio } from './tipos';

/**
 * La geografía de la campaña: dieciocho territorios, sus fronteras y lo que valen.
 *
 * Todo lo de este fichero es constante durante la partida. Lo que cambia —quién
 * manda en cada sitio— vive en `EstadoCampana`. La separación no es un capricho:
 * permite guardar y restaurar una partida entera con un puñado de enteros, sin
 * arrastrar la geometría.
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
    x: 11,
    y: 85,
    contorno: [[2, 74], [22, 76], [23, 96], [3, 97]],
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
    x: 10,
    y: 62,
    contorno: [[3, 50], [21, 52], [22, 74], [2, 74]],
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
    x: 35,
    y: 85,
    contorno: [[23, 76], [47, 78], [48, 97], [23, 96]],
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
    x: 36,
    y: 65,
    contorno: [[21, 52], [48, 55], [47, 78], [22, 76]],
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
    x: 55,
    y: 86,
    contorno: [[48, 78], [66, 79], [67, 97], [48, 97]],
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
    x: 58,
    y: 67,
    contorno: [[48, 55], [68, 57], [66, 79], [47, 78]],
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
    x: 72,
    y: 84,
    contorno: [[66, 79], [82, 76], [84, 94], [67, 97]],
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
    x: 80,
    y: 68,
    contorno: [[68, 57], [88, 58], [89, 76], [82, 76], [66, 79]],
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
    x: 92,
    y: 83,
    contorno: [[89, 76], [98, 74], [97, 93], [84, 94]],
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
    x: 22,
    y: 40,
    contorno: [[6, 28], [34, 30], [33, 52], [3, 50]],
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
    x: 33,
    y: 20,
    contorno: [[6, 28], [34, 30], [40, 12], [16, 6]],
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
    x: 52,
    y: 43,
    contorno: [[33, 30], [63, 33], [62, 55], [33, 52]],
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
    x: 55,
    y: 22,
    contorno: [[40, 12], [63, 16], [63, 33], [34, 30]],
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
    x: 71,
    y: 46,
    contorno: [[62, 33], [82, 36], [81, 57], [62, 55]],
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
    x: 70,
    y: 25,
    contorno: [[63, 16], [80, 18], [82, 36], [63, 33]],
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
    x: 88,
    y: 50,
    contorno: [[81, 43], [96, 45], [95, 60], [88, 58], [81, 57]],
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
    y: 33,
    contorno: [[82, 22], [97, 26], [96, 45], [81, 43]],
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
    x: 84,
    y: 12,
    contorno: [[80, 18], [82, 22], [97, 26], [92, 3], [80, 4]],
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
