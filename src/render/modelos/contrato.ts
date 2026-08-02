import type * as THREE from 'three';
import type { Bando, EstadoUnidad, TipoEdificio, TipoUnidad } from '../../sim/tipos';

/**
 * Contrato de los modelos visuales.
 *
 * Decisión de fondo: nada de mallas con esqueleto. Un ejército de cien unidades con
 * animación por huesos hunde cualquier móvil de gama media. En su lugar, cada modelo
 * es una jerarquía de piezas rígidas —torso, brazos, piernas, arma— y la animación
 * consiste en rotar esas piezas por código. Es exactamente lo que hacían los clásicos
 * del género con sprites recortados, y a cambio da rotación libre, sombras correctas
 * y un coste por unidad ridículo.
 *
 * Toda la geometría se genera por código. No hay archivos de modelo que descargar,
 * el peso de la página no crece y cada bando puede recolorearse sin duplicar mallas.
 */

/** Contexto que el render entrega al modelo en cada fotograma. */
export interface PoseUnidad {
  /** Estado lógico actual; decide qué animación toca. */
  estado: EstadoUnidad;
  /** Segundos que lleva en ese estado. Es el reloj de la animación. */
  tiempoEstado: number;
  /** Rapidez real en casillas por segundo; modula la cadencia del paso. */
  rapidez: number;
  /** Vida restante en [0, 1]; permite mostrar daño acumulado. */
  saludNormalizada: number;
  /** Segundos totales transcurridos, para movimientos de reposo desincronizados. */
  tiempoGlobal: number;
  /** Desfase por unidad, para que un pelotón no respire al unísono. */
  desfase: number;
}

export interface ModeloUnidad {
  /** Nodo que el render coloca en el mundo. La escala ya viene aplicada. */
  readonly raiz: THREE.Object3D;
  /** Altura aproximada en unidades de mundo; sitúa la barra de vida y los avisos. */
  readonly altura: number;
  /** Aplica la pose de este fotograma. Debe ser barata: se llama por unidad visible. */
  aplicarPose(pose: PoseUnidad): void;
  /** Nivel de detalle: 0 = completo, 1 = simplificado, 2 = silueta. */
  fijarDetalle(nivel: 0 | 1 | 2): void;
  liberar(): void;
}

export interface ModeloEdificio {
  readonly raiz: THREE.Object3D;
  readonly altura: number;
  /**
   * Progreso de obra en [0, 1]. En 0 se ve el andamio y los cimientos; en 1, el
   * edificio terminado. Lo natural es que la estructura emerja del suelo conforme sube.
   */
  fijarProgresoObra(progreso: number): void;
  /** Daño visible en [0, 1]: humo, vigas partidas, tejado hundido. */
  fijarDanio(fraccion: number): void;
  fijarDetalle(nivel: 0 | 1 | 2): void;
  liberar(): void;
}

/**
 * Fábrica de modelos.
 *
 * Comparte geometrías y materiales entre todas las instancias del mismo tipo y bando:
 * cien soldados deben suponer una geometría en memoria, no cien.
 */
export interface FabricaModelos {
  crearUnidad(tipo: TipoUnidad, bando: Bando): ModeloUnidad;
  crearEdificio(tipo: TipoEdificio, bando: Bando): ModeloEdificio;
  /** Árboles, rocas, tocones y demás decoración con presencia en el mapa. */
  crearAdorno(clave: string, semilla: number): THREE.Object3D;
  /** Geometrías y materiales compartidos; se llama al cerrar la partida. */
  liberar(): void;
}
