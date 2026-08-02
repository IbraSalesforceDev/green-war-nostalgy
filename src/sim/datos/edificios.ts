import { POBLACION_POR_AYUNTAMIENTO, POBLACION_POR_GRANJA } from '../constantes';
import {
  Bando,
  FichaEdificio,
  TipoArmadura,
  TipoDanio,
  TipoEdificio,
  TipoUnidad,
} from '../tipos';

/**
 * Fichas de edificios y árbol tecnológico.
 *
 * El árbol es deliberadamente corto: ayuntamiento para obreros y economía, barracón
 * para tropa, aserradero y herrería para mejoras, torre para defender. Un jugador
 * nuevo lo entiende en una partida, y aun así deja decisiones reales sobre en qué
 * gastar los primeros 800 de oro.
 */

export const FICHAS_EDIFICIO: Readonly<Record<TipoEdificio, FichaEdificio>> = {
  [TipoEdificio.AYUNTAMIENTO]: {
    tipo: TipoEdificio.AYUNTAMIENTO,
    nombre: 'Ayuntamiento',
    descripcion: 'Corazón de la base. Entrena campesinos y recibe el oro y la madera.',
    coste: { oro: 1200, madera: 800, poblacion: 0 },
    tiempoConstruccion: 90,
    vida: 1200,
    armadura: 20,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 4,
    vision: 9,
    esDeposito: true,
    poblacionQueAporta: POBLACION_POR_AYUNTAMIENTO,
    entrena: [TipoUnidad.CAMPESINO],
    desbloquea: [
      TipoEdificio.GRANJA,
      TipoEdificio.BARRACON,
      TipoEdificio.ASERRADERO,
      TipoEdificio.TORRE,
    ],
    alcanceAtaque: 0,
    danioMin: 0,
    danioMax: 0,
    tipoDanio: TipoDanio.CORTANTE,
    cadencia: 0,
  },

  [TipoEdificio.GRANJA]: {
    tipo: TipoEdificio.GRANJA,
    nombre: 'Granja',
    descripcion: 'Alimenta a cinco soldados más. Sin granjas no hay ejército.',
    coste: { oro: 500, madera: 250, poblacion: 0 },
    tiempoConstruccion: 30,
    vida: 400,
    armadura: 5,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 2,
    vision: 5,
    esDeposito: false,
    poblacionQueAporta: POBLACION_POR_GRANJA,
    entrena: [],
    desbloquea: [],
    alcanceAtaque: 0,
    danioMin: 0,
    danioMax: 0,
    tipoDanio: TipoDanio.CORTANTE,
    cadencia: 0,
  },

  [TipoEdificio.BARRACON]: {
    tipo: TipoEdificio.BARRACON,
    nombre: 'Barracón',
    descripcion: 'Adiestra a la tropa. El primer paso hacia cualquier ofensiva.',
    coste: { oro: 700, madera: 450, poblacion: 0 },
    tiempoConstruccion: 60,
    vida: 800,
    armadura: 12,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 3,
    vision: 6,
    esDeposito: false,
    poblacionQueAporta: 0,
    entrena: [TipoUnidad.SOLDADO, TipoUnidad.ARQUERO],
    desbloquea: [TipoEdificio.HERRERIA],
    alcanceAtaque: 0,
    danioMin: 0,
    danioMax: 0,
    tipoDanio: TipoDanio.CORTANTE,
    cadencia: 0,
  },

  [TipoEdificio.ASERRADERO]: {
    tipo: TipoEdificio.ASERRADERO,
    nombre: 'Aserradero',
    descripcion: 'Depósito adelantado de madera. Acorta el viaje de los taladores.',
    coste: { oro: 600, madera: 450, poblacion: 0 },
    tiempoConstruccion: 45,
    vida: 600,
    armadura: 8,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 3,
    vision: 6,
    esDeposito: true,
    poblacionQueAporta: 0,
    entrena: [],
    desbloquea: [],
    alcanceAtaque: 0,
    danioMin: 0,
    danioMax: 0,
    tipoDanio: TipoDanio.CORTANTE,
    cadencia: 0,
  },

  [TipoEdificio.TORRE]: {
    tipo: TipoEdificio.TORRE,
    nombre: 'Torre de vigía',
    descripcion: 'Dispara sola y ve muy lejos. Barata de poner, cara de ignorar.',
    coste: { oro: 550, madera: 200, poblacion: 0 },
    tiempoConstruccion: 40,
    vida: 500,
    armadura: 20,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 2,
    vision: 11,
    esDeposito: false,
    poblacionQueAporta: 0,
    entrena: [],
    desbloquea: [],
    alcanceAtaque: 7,
    danioMin: 8,
    danioMax: 14,
    tipoDanio: TipoDanio.PENETRANTE,
    cadencia: 1.6,
  },

  [TipoEdificio.HERRERIA]: {
    tipo: TipoEdificio.HERRERIA,
    nombre: 'Herrería',
    descripcion: 'Afila las espadas y refuerza las corazas de todo el ejército.',
    coste: { oro: 800, madera: 450, poblacion: 0 },
    tiempoConstruccion: 65,
    vida: 775,
    armadura: 12,
    tipoArmadura: TipoArmadura.FORTIFICADA,
    huella: 3,
    vision: 6,
    esDeposito: false,
    poblacionQueAporta: 0,
    entrena: [],
    desbloquea: [],
    alcanceAtaque: 0,
    danioMin: 0,
    danioMax: 0,
    tipoDanio: TipoDanio.CORTANTE,
    cadencia: 0,
  },
};

const NOMBRES_POR_BANDO: Record<number, Partial<Record<TipoEdificio, string>>> = {
  [Bando.HUMANOS]: {
    [TipoEdificio.AYUNTAMIENTO]: 'Ayuntamiento',
    [TipoEdificio.GRANJA]: 'Granja',
    [TipoEdificio.BARRACON]: 'Cuartel',
    [TipoEdificio.ASERRADERO]: 'Aserradero',
    [TipoEdificio.TORRE]: 'Torre de vigía',
    [TipoEdificio.HERRERIA]: 'Herrería',
  },
  [Bando.ORCOS]: {
    [TipoEdificio.AYUNTAMIENTO]: 'Gran Salón',
    [TipoEdificio.GRANJA]: 'Chabola',
    [TipoEdificio.BARRACON]: 'Fosa de combate',
    [TipoEdificio.ASERRADERO]: 'Molino de troncos',
    [TipoEdificio.TORRE]: 'Atalaya',
    [TipoEdificio.HERRERIA]: 'Fragua',
  },
};

export function nombreEdificio(tipo: TipoEdificio, bando: Bando): string {
  return NOMBRES_POR_BANDO[bando]?.[tipo] ?? FICHAS_EDIFICIO[tipo].nombre;
}

export function fichaEdificio(tipo: TipoEdificio): FichaEdificio {
  return FICHAS_EDIFICIO[tipo];
}

/** Orden en que aparecen en la carta de construcción. */
export const ORDEN_CARTA_EDIFICIOS: readonly TipoEdificio[] = [
  TipoEdificio.GRANJA,
  TipoEdificio.BARRACON,
  TipoEdificio.ASERRADERO,
  TipoEdificio.TORRE,
  TipoEdificio.HERRERIA,
  TipoEdificio.AYUNTAMIENTO,
];

/** El ayuntamiento es lo único que se puede levantar desde el primer segundo. */
export function estaDesbloqueado(
  tipo: TipoEdificio,
  disponibles: ReadonlySet<TipoEdificio>,
): boolean {
  if (tipo === TipoEdificio.AYUNTAMIENTO) return true;
  for (const construido of disponibles) {
    if (FICHAS_EDIFICIO[construido].desbloquea.includes(tipo)) return true;
  }
  return false;
}
