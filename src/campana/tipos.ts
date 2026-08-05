/**
 * Vocabulario de la capa de campaña.
 *
 * La campaña es el juego por turnos sobre el mapa: quién controla cada territorio,
 * cuánto recauda, dónde están los ejércitos y quién choca con quién. Cuando dos
 * ejércitos se encuentran, la campaña cede el mando a una escena de acción y espera
 * su veredicto.
 *
 * ── Por qué tipos propios y no los de `sim/tipos.ts` ──────────────────────────
 * La simulación de batalla tiene su propio `Bando` (con NEUTRAL para árboles y
 * minas) y su propia noción de entidad, pensados para un campo de batalla de
 * decenas de unidades moviéndose a 20 Hz. La campaña no tiene nada de eso: son
 * dieciocho territorios y un puñado de ejércitos que se mueven una vez por turno.
 * Mezclar ambos vocabularios obligaría a que cada capa entendiera conceptos que no
 * le incumben. Al entrar en batalla se traduce de un bando al otro, y ya está.
 */

/** Los dos bandos de la contienda, más el vacío. */
export enum BandoCampana {
  /** Sin dueño: solo lo usan los huecos y los valores por defecto. */
  NINGUNO = 0,
  /** El Norte. Azules. */
  UNION = 1,
  /** El Sur. Grises. */
  CONFEDERACION = 2,
}

export const BANDOS_EN_GUERRA = [BandoCampana.UNION, BandoCampana.CONFEDERACION] as const;

/** El bando contrario. Se usa lo bastante como para no repetir el ternario. */
export function bandoRival(bando: BandoCampana): BandoCampana {
  if (bando === BandoCampana.UNION) return BandoCampana.CONFEDERACION;
  if (bando === BandoCampana.CONFEDERACION) return BandoCampana.UNION;
  return BandoCampana.NINGUNO;
}

export const NOMBRE_BANDO: Readonly<Record<BandoCampana, string>> = {
  [BandoCampana.NINGUNO]: 'Nadie',
  [BandoCampana.UNION]: 'la Unión',
  [BandoCampana.CONFEDERACION]: 'la Confederación',
};

/**
 * Las tres armas clásicas. El orden importa: es el mismo en que se listan en la
 * interfaz y en que entran en el campo de batalla.
 */
export enum Arma {
  INFANTERIA = 0,
  CABALLERIA = 1,
  ARTILLERIA = 2,
}

export const ARMAS = [Arma.INFANTERIA, Arma.CABALLERIA, Arma.ARTILLERIA] as const;
export const NUM_ARMAS = 3;

export const NOMBRE_ARMA: Readonly<Record<Arma, string>> = {
  [Arma.INFANTERIA]: 'Infantería',
  [Arma.CABALLERIA]: 'Caballería',
  [Arma.ARTILLERIA]: 'Artillería',
};

/**
 * Composición de un ejército: cuántas unidades de cada arma.
 *
 * Es un array de tres enteros y no tres campos con nombre porque casi todo lo que
 * se hace con ella —sumar, restar bajas, comparar dos ejércitos— es un bucle sobre
 * las tres armas.
 */
export type Composicion = [infanteria: number, caballeria: number, artilleria: number];

export function composicionVacia(): Composicion {
  return [0, 0, 0];
}

export function totalTropas(composicion: Composicion): number {
  return composicion[0] + composicion[1] + composicion[2];
}

export function copiarComposicion(composicion: Composicion): Composicion {
  return [composicion[0], composicion[1], composicion[2]];
}

/** Identificador de territorio. Es la clave textual de `TERRITORIOS`, no un índice. */
export type IdTerritorio = string;

/** Un ejército sobre el mapa. */
export interface Ejercito {
  /** Identificador estable; sobrevive a fusiones y movimientos. */
  readonly id: number;
  bando: BandoCampana;
  territorio: IdTerritorio;
  composicion: Composicion;
  /** Ya se ha movido este turno: no puede volver a hacerlo. */
  haMovido: boolean;
}

/** Estado de un territorio durante la partida (lo que cambia; la geografía no). */
export interface EstadoTerritorio {
  dueno: BandoCampana;
}

/** Lo que la campaña necesita saber de una batalla ya resuelta. */
export interface ResultadoBatalla {
  territorio: IdTerritorio;
  atacante: BandoCampana;
  vencedor: BandoCampana;
  /** Lo que le queda al atacante. Si es todo ceros, el ataque se deshizo. */
  supervivientesAtacante: Composicion;
  /** Lo que le queda al defensor. */
  supervivientesDefensor: Composicion;
}

/** Fases por las que pasa un turno, en orden. */
export enum FaseTurno {
  /** Se cobran las rentas y se reparten los refuerzos. Automática. */
  RECAUDACION = 0,
  /** El bando de turno mueve sus ejércitos. Aquí espera al jugador. */
  MANIOBRA = 1,
  /** Se dirimen los choques pendientes, uno a uno. */
  BATALLAS = 2,
  /** La partida ha terminado. */
  FIN = 3,
}
