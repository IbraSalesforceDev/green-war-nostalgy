/**
 * Vocabulario compartido de la simulación.
 *
 * Todo lo que aquí se define es un contrato: el render, la interfaz, el audio y la
 * IA leen estos tipos pero no los amplían por su cuenta. Si un sistema necesita un
 * concepto nuevo, se añade aquí primero.
 */

/**
 * Identificador de entidad. Empaqueta índice y generación en un solo entero de 32 bits:
 * los 20 bits bajos son el índice en los arrays del mundo y los 12 altos, la generación.
 *
 * La generación es lo que evita el bug clásico del RTS: un arquero guarda como objetivo
 * a la entidad 57, esa entidad muere, el hueco se reutiliza para un campesino nuevo y el
 * arquero acaba disparando al campesino. Al comparar también la generación, la referencia
 * caduca sola.
 */
export type Entidad = number;

export const ENTIDAD_NULA = 0 as Entidad;
export const BITS_INDICE = 20;
export const MASCARA_INDICE = (1 << BITS_INDICE) - 1;
export const MAX_ENTIDADES = 4096;

export function indiceDe(entidad: Entidad): number {
  return entidad & MASCARA_INDICE;
}

export function generacionDe(entidad: Entidad): number {
  return entidad >>> BITS_INDICE;
}

export function componerEntidad(indice: number, generacion: number): Entidad {
  return ((generacion << BITS_INDICE) | (indice & MASCARA_INDICE)) >>> 0;
}

/** Bandos. El 0 es la naturaleza: árboles, minas de oro y fauna. */
export enum Bando {
  NEUTRAL = 0,
  HUMANOS = 1,
  ORCOS = 2,
}

export const BANDOS_JUGABLES = [Bando.HUMANOS, Bando.ORCOS] as const;
export const NUM_BANDOS = 3;

export enum TipoRecurso {
  ORO = 0,
  MADERA = 1,
}

export const NUM_RECURSOS = 2;

/** Familia de una entidad. Determina qué arrays del mundo son significativos. */
export enum Clase {
  NINGUNA = 0,
  UNIDAD = 1,
  EDIFICIO = 2,
  /** Vetas de oro, arboledas: no se mueven, no luchan, se agotan. */
  YACIMIENTO = 3,
  /** Decoración con presencia en la rejilla: rocas, tocones, ruinas. */
  ADORNO = 4,
}

export enum TipoUnidad {
  CAMPESINO = 0,
  SOLDADO = 1,
  ARQUERO = 2,
  JINETE = 3,
  CATAPULTA = 4,
}

export const NUM_TIPOS_UNIDAD = 5;

export enum TipoEdificio {
  AYUNTAMIENTO = 0,
  GRANJA = 1,
  BARRACON = 2,
  ASERRADERO = 3,
  TORRE = 4,
  HERRERIA = 5,
}

export const NUM_TIPOS_EDIFICIO = 6;

export enum TipoYacimiento {
  MINA_ORO = 0,
  ARBOL = 1,
}

/** Qué está intentando hacer la entidad. Es la intención, no el fotograma actual. */
export enum Orden {
  NINGUNA = 0,
  MOVER = 1,
  /** Avanza hacia un punto y ataca lo que encuentre por el camino. */
  ATACAR_MOVER = 2,
  ATACAR = 3,
  RECOLECTAR = 4,
  /** Volver al depósito más cercano con la carga. */
  DEVOLVER = 5,
  CONSTRUIR = 6,
  REPARAR = 7,
  PATRULLAR = 8,
  MANTENER_POSICION = 9,
}

/** Lo que la entidad está haciendo ahora mismo. El render lo traduce a animación. */
export enum EstadoUnidad {
  INACTIVO = 0,
  CAMINANDO = 1,
  ATACANDO = 2,
  RECOLECTANDO = 3,
  CONSTRUYENDO = 4,
  MURIENDO = 5,
  /** Andamio de edificio aún sin terminar. */
  EN_OBRAS = 6,
}

/**
 * Tipo de daño y tipo de armadura. El triángulo clásico del género: la penetrante
 * castiga a los desprotegidos, la contundente derriba muros y la cortante es el
 * término medio fiable.
 */
export enum TipoDanio {
  CORTANTE = 0,
  PENETRANTE = 1,
  CONTUNDENTE = 2,
  MAGICO = 3,
}

export enum TipoArmadura {
  NINGUNA = 0,
  LIGERA = 1,
  PESADA = 2,
  FORTIFICADA = 3,
}

/**
 * Multiplicadores de daño [TipoDanio][TipoArmadura].
 * Que estén en una tabla y no repartidos por el código es intencionado: el equilibrio
 * del juego se toca aquí, en un solo sitio.
 */
export const TABLA_DANIO: readonly (readonly number[])[] = [
  //          ninguna  ligera  pesada  fortificada
  /* cortante    */ [1.0, 1.0, 0.7, 0.35],
  /* penetrante  */ [1.35, 1.15, 0.55, 0.25],
  /* contundente */ [0.9, 0.75, 1.0, 1.5],
  /* magico      */ [1.15, 1.15, 1.0, 0.7],
];

export function multiplicadorDanio(danio: TipoDanio, armadura: TipoArmadura): number {
  return TABLA_DANIO[danio]?.[armadura] ?? 1;
}

/** Terreno. El índice se guarda en un Uint8Array por casilla. */
export enum TipoCasilla {
  HIERBA = 0,
  TIERRA = 1,
  CAMINO = 2,
  ROCA = 3,
  AGUA_BAJA = 4,
  AGUA_PROFUNDA = 5,
  BOSQUE = 6,
  /** Cara vertical de un acantilado: infranqueable y con material propio. */
  ACANTILADO = 7,
}

export const NUM_TIPOS_CASILLA = 8;

/** Máscara de ocupación de la rejilla de navegación. */
export enum Bloqueo {
  LIBRE = 0,
  /** Terreno intransitable por naturaleza: agua profunda, roca viva, acantilado. */
  TERRENO = 1 << 0,
  /** Ocupado por un edificio. */
  EDIFICIO = 1 << 1,
  /** Ocupado por un árbol o una veta. */
  YACIMIENTO = 1 << 2,
  /** Reservado por un andamio ya colocado. */
  OBRA = 1 << 3,
}

export const BLOQUEO_TOTAL =
  Bloqueo.TERRENO | Bloqueo.EDIFICIO | Bloqueo.YACIMIENTO | Bloqueo.OBRA;

/** Niveles de visión de la niebla de guerra, por casilla y por bando. */
export enum Vision {
  /** Nunca explorado: negro absoluto. */
  OCULTO = 0,
  /** Explorado pero sin unidades cerca: se ve el terreno, no lo que se mueve. */
  RECORDADO = 1,
  /** Bajo vigilancia activa. */
  VISIBLE = 2,
}

/** Coste de una unidad o edificio. */
export interface Coste {
  readonly oro: number;
  readonly madera: number;
  /** Población que consume (las granjas la aportan en negativo). */
  readonly poblacion: number;
}

/** Ficha de una unidad. Todo el equilibrio de unidades vive en tablas de este tipo. */
export interface FichaUnidad {
  readonly tipo: TipoUnidad;
  readonly nombre: string;
  readonly descripcion: string;
  readonly coste: Coste;
  /** Segundos de entrenamiento. */
  readonly tiempoEntrenamiento: number;
  readonly vida: number;
  readonly armadura: number;
  readonly tipoArmadura: TipoArmadura;
  readonly danioMin: number;
  readonly danioMax: number;
  readonly tipoDanio: TipoDanio;
  /** Distancia de ataque en casillas. Cuerpo a cuerpo ronda 1. */
  readonly alcance: number;
  /** Segundos entre golpes. */
  readonly cadencia: number;
  /** Casillas por segundo. */
  readonly velocidad: number;
  /** Radianes por segundo al girar. */
  readonly velocidadGiro: number;
  /** Radio de colisión en casillas. */
  readonly radio: number;
  /** Radio de visión en casillas. */
  readonly vision: number;
  /** Puede recolectar oro y madera. */
  readonly esObrero: boolean;
  /** Cuánto carga antes de tener que volver al depósito. */
  readonly capacidadCarga: number;
  /** Edificio que lo entrena. */
  readonly entrenadoEn: TipoEdificio;
  /** Dispara proyectil en vez de golpear. */
  readonly proyectil: 'flecha' | 'lanza' | 'roca' | null;
}

/** Ficha de un edificio. */
export interface FichaEdificio {
  readonly tipo: TipoEdificio;
  readonly nombre: string;
  readonly descripcion: string;
  readonly coste: Coste;
  /** Segundos de construcción. */
  readonly tiempoConstruccion: number;
  readonly vida: number;
  readonly armadura: number;
  readonly tipoArmadura: TipoArmadura;
  /** Lado de la huella cuadrada, en casillas. */
  readonly huella: number;
  readonly vision: number;
  /** Acepta entregas de recursos de los obreros. */
  readonly esDeposito: boolean;
  /** Población que aporta. */
  readonly poblacionQueAporta: number;
  /** Unidades que puede entrenar. */
  readonly entrena: readonly TipoUnidad[];
  /** Edificios que su existencia desbloquea. */
  readonly desbloquea: readonly TipoEdificio[];
  /** Si dispara: alcance en casillas, 0 si es inofensivo. */
  readonly alcanceAtaque: number;
  readonly danioMin: number;
  readonly danioMax: number;
  readonly tipoDanio: TipoDanio;
  readonly cadencia: number;
}

/** Estado económico y de progreso de un bando. */
export interface EstadoBando {
  bando: Bando;
  oro: number;
  madera: number;
  /** Población ocupada por las unidades vivas. */
  poblacion: number;
  /** Techo actual, dado por ayuntamientos y granjas. */
  poblacionMaxima: number;
  /** Techo absoluto del juego, por encima del cual las granjas no aportan. */
  readonly limitePoblacion: number;
  /** Marcadores para la pantalla de fin de partida. */
  unidadesEntrenadas: number;
  unidadesPerdidas: number;
  bajasCausadas: number;
  oroRecogido: number;
  maderaRecogida: number;
  edificiosConstruidos: number;
  /** Tipos de edificio terminados al menos una vez: gobierna el árbol tecnológico. */
  edificiosDisponibles: Set<TipoEdificio>;
  derrotado: boolean;
  /** Controlado por la IA en vez de por un humano. */
  esIA: boolean;
}

/** Un elemento en la cola de producción de un edificio. */
export interface ElementoCola {
  tipoUnidad: TipoUnidad;
  /** Segundos restantes. */
  restante: number;
  /** Segundos totales, para dibujar la barra de progreso. */
  total: number;
}

/** Una ruta calculada por el buscador de caminos. */
export interface Ruta {
  /** Puntos en coordenadas de mundo, ya suavizados. */
  puntos: Float32Array;
  /** Índice del siguiente punto a alcanzar. */
  indice: number;
  /** Tick en que se calculó, para poder recalcular rutas rancias. */
  tickCalculo: number;
}
