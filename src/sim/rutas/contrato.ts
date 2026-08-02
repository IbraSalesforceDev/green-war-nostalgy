import type { Ruta } from '../tipos';

/**
 * Contrato de la búsqueda de caminos.
 *
 * Existe para que el sistema de movimiento y el buscador de rutas se puedan escribir
 * a la vez sin esperarse. El movimiento solo necesita saber que puede *pedir* una ruta
 * y que en algún tick futuro la tendrá; cómo se calcule —A*, campos de flujo, en el
 * hilo principal o en un trabajador— es asunto exclusivo de la implementación.
 *
 * Todas las coordenadas son de mundo (no de casilla), en el plano XZ.
 */

export interface PeticionRuta {
  /** Entidad que pide la ruta. Se usa para deduplicar y para cancelar. */
  entidad: number;
  origenX: number;
  origenZ: number;
  destinoX: number;
  destinoZ: number;
  /** Radio de la unidad, para no meterla por huecos por los que no cabe. */
  radio: number;
  /**
   * Distancia a la que se da por buena la llegada. Un arquero con alcance 5 no
   * necesita pisar el objetivo: le basta con acercarse hasta poder disparar.
   */
  tolerancia: number;
  /** Prioridad: las órdenes directas del jugador van antes que las de la IA. */
  prioridad: number;
}

export type ResultadoRuta =
  | { estado: 'lista'; ruta: Ruta }
  /** No existe camino posible; quien la pidió debe abandonar la orden. */
  | { estado: 'imposible' }
  /** Aún calculándose. Volver a preguntar en un tick posterior. */
  | { estado: 'pendiente' };

export interface BuscadorRutas {
  /**
   * Encola una petición. Si ya había una para la misma entidad, la reemplaza:
   * una unidad solo persigue un destino a la vez.
   */
  pedir(peticion: PeticionRuta): void;

  /** Consulta el resultado. Devolver la ruta la retira de la bandeja de salida. */
  recoger(entidad: number): ResultadoRuta;

  /** Olvida cualquier petición pendiente de esa entidad (murió, cambió de orden). */
  cancelar(entidad: number): void;

  /**
   * Procesa el trabajo pendiente. Se llama una vez por tick, con el presupuesto
   * de nodos ya acotado por las constantes del juego.
   */
  actualizar(tick: number): void;

  /**
   * Avisa de que la transitabilidad ha cambiado en una región (edificio nuevo,
   * árbol talado). Invalida las cachés que cubran esa zona.
   */
  invalidarRegion(cx: number, cz: number, lado: number): void;

  /** Estadísticas para el panel de depuración. */
  estadisticas(): { pendientes: number; calculadasEsteTick: number; nodosExplorados: number };
}
