import {
  Bando,
  FichaUnidad,
  TipoArmadura,
  TipoDanio,
  TipoEdificio,
  TipoUnidad,
} from '../tipos';

/**
 * Fichas de unidades.
 *
 * Los dos bandos comparten estadísticas y se diferencian en nombre, silueta y voz.
 * Es la decisión de equilibrio de los clásicos del género y sigue siendo la correcta:
 * el jugador aprende una sola tabla de valores y todo lo que decide la partida es la
 * habilidad, no la facción que le tocó.
 */

export const FICHAS_UNIDAD: Readonly<Record<TipoUnidad, FichaUnidad>> = {
  [TipoUnidad.CAMPESINO]: {
    tipo: TipoUnidad.CAMPESINO,
    nombre: 'Campesino',
    descripcion: 'Extrae oro, tala madera y levanta edificios. La espalda del reino.',
    coste: { oro: 400, madera: 0, poblacion: 1 },
    tiempoEntrenamiento: 12,
    vida: 30,
    armadura: 0,
    tipoArmadura: TipoArmadura.NINGUNA,
    danioMin: 1,
    danioMax: 5,
    tipoDanio: TipoDanio.CORTANTE,
    alcance: 0.9,
    cadencia: 1.4,
    velocidad: 3.4,
    velocidadGiro: 9,
    radio: 0.3,
    vision: 6,
    esObrero: true,
    capacidadCarga: 10,
    entrenadoEn: TipoEdificio.AYUNTAMIENTO,
    proyectil: null,
  },

  [TipoUnidad.SOLDADO]: {
    tipo: TipoUnidad.SOLDADO,
    nombre: 'Soldado',
    descripcion: 'Infantería pesada. Aguanta la línea mientras los arqueros trabajan.',
    coste: { oro: 600, madera: 0, poblacion: 1 },
    tiempoEntrenamiento: 15,
    vida: 60,
    armadura: 2,
    tipoArmadura: TipoArmadura.PESADA,
    danioMin: 4,
    danioMax: 10,
    tipoDanio: TipoDanio.CORTANTE,
    alcance: 1,
    cadencia: 1.2,
    velocidad: 3.2,
    velocidadGiro: 8,
    radio: 0.32,
    vision: 7,
    esObrero: false,
    capacidadCarga: 0,
    entrenadoEn: TipoEdificio.BARRACON,
    proyectil: null,
  },

  [TipoUnidad.ARQUERO]: {
    tipo: TipoUnidad.ARQUERO,
    nombre: 'Arquero',
    descripcion: 'Castiga desde lejos. Frágil si le dejan llegar al cuerpo a cuerpo.',
    coste: { oro: 500, madera: 50, poblacion: 1 },
    tiempoEntrenamiento: 18,
    vida: 40,
    armadura: 0,
    tipoArmadura: TipoArmadura.LIGERA,
    danioMin: 3,
    danioMax: 9,
    tipoDanio: TipoDanio.PENETRANTE,
    alcance: 5.5,
    cadencia: 1.5,
    velocidad: 3.2,
    velocidadGiro: 9,
    radio: 0.3,
    vision: 9,
    esObrero: false,
    capacidadCarga: 0,
    entrenadoEn: TipoEdificio.BARRACON,
    proyectil: 'flecha',
  },

  [TipoUnidad.JINETE]: {
    tipo: TipoUnidad.JINETE,
    nombre: 'Jinete',
    descripcion: 'Rápido y contundente. Nació para cazar obreros y arqueros.',
    coste: { oro: 800, madera: 100, poblacion: 2 },
    tiempoEntrenamiento: 24,
    vida: 90,
    armadura: 3,
    tipoArmadura: TipoArmadura.PESADA,
    danioMin: 6,
    danioMax: 14,
    tipoDanio: TipoDanio.CORTANTE,
    alcance: 1.1,
    cadencia: 1.1,
    velocidad: 5.4,
    velocidadGiro: 5.5,
    radio: 0.4,
    vision: 8,
    esObrero: false,
    capacidadCarga: 0,
    entrenadoEn: TipoEdificio.BARRACON,
    proyectil: null,
  },

  [TipoUnidad.CATAPULTA]: {
    tipo: TipoUnidad.CATAPULTA,
    nombre: 'Catapulta',
    descripcion: 'Demuele fortificaciones. Lenta, cara e indefensa si la flanquean.',
    coste: { oro: 900, madera: 200, poblacion: 2 },
    tiempoEntrenamiento: 32,
    vida: 110,
    armadura: 1,
    tipoArmadura: TipoArmadura.LIGERA,
    danioMin: 20,
    danioMax: 45,
    tipoDanio: TipoDanio.CONTUNDENTE,
    alcance: 8,
    cadencia: 4,
    velocidad: 1.8,
    velocidadGiro: 3,
    radio: 0.5,
    vision: 9,
    esObrero: false,
    capacidadCarga: 0,
    entrenadoEn: TipoEdificio.BARRACON,
    proyectil: 'roca',
  },
};

/** Nombres propios de cada bando. Mismas estadísticas, distinta cultura. */
const NOMBRES_POR_BANDO: Record<number, Partial<Record<TipoUnidad, string>>> = {
  [Bando.HUMANOS]: {
    [TipoUnidad.CAMPESINO]: 'Campesino',
    [TipoUnidad.SOLDADO]: 'Soldado',
    [TipoUnidad.ARQUERO]: 'Arquero',
    [TipoUnidad.JINETE]: 'Caballero',
    [TipoUnidad.CATAPULTA]: 'Catapulta',
  },
  [Bando.ORCOS]: {
    [TipoUnidad.CAMPESINO]: 'Peón',
    [TipoUnidad.SOLDADO]: 'Bruto',
    [TipoUnidad.ARQUERO]: 'Lanzador de hachas',
    [TipoUnidad.JINETE]: 'Jinete de lobo',
    [TipoUnidad.CATAPULTA]: 'Trabuquete',
  },
};

export function nombreUnidad(tipo: TipoUnidad, bando: Bando): string {
  return NOMBRES_POR_BANDO[bando]?.[tipo] ?? FICHAS_UNIDAD[tipo].nombre;
}

export function fichaUnidad(tipo: TipoUnidad): FichaUnidad {
  return FICHAS_UNIDAD[tipo];
}

/** Orden en que aparecen en la carta de comandos. */
export const ORDEN_CARTA_UNIDADES: readonly TipoUnidad[] = [
  TipoUnidad.CAMPESINO,
  TipoUnidad.SOLDADO,
  TipoUnidad.ARQUERO,
  TipoUnidad.JINETE,
  TipoUnidad.CATAPULTA,
];
