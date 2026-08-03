/**
 * Normalización de Pointer Events.
 *
 * Todo el resto de la capa de entrada trabaja con un puñado de números simples
 * (id, x, y, si es ratón, qué botón) en vez de con el `PointerEvent` del navegador.
 * Este módulo es la única costura entre el DOM y esa representación: si mañana hay
 * que soportar lápiz óptico o un dispositivo raro, se toca aquí y en ningún otro
 * sitio.
 *
 * También vive aquí la comprobación de «¿esto vino de la interfaz?», porque es la
 * misma pregunta de normalización: antes de convertir un evento en algo que la
 * entrada entienda, hay que saber si es un evento que la entrada debe ignorar.
 */

/** Botón que no aplica (dedo, lápiz sin botones). */
export const SIN_BOTON = -1;

export interface PunteroNormalizado {
  id: number;
  clientX: number;
  clientY: number;
  /** `pointerType === 'mouse'`. Un lápiz o un dedo cuentan como no-ratón. */
  esRaton: boolean;
  /** `evento.button` si es ratón; `SIN_BOTON` en cualquier otro caso. */
  boton: number;
}

export function normalizarPuntero(evento: PointerEvent): PunteroNormalizado {
  const esRaton = evento.pointerType === 'mouse';
  return {
    id: evento.pointerId,
    clientX: evento.clientX,
    clientY: evento.clientY,
    esRaton,
    boton: esRaton ? evento.button : SIN_BOTON,
  };
}

/**
 * ¿El evento se originó sobre un elemento de la interfaz (`capa-ui`)?
 *
 * `capa-ui` tiene `pointer-events: none` en su raíz, así que casi todo lo que hay
 * sobre el lienzo ya deja pasar el evento sin que esta función tenga que hacer
 * nada. Pero un panel HUD concreto puede reactivar `pointer-events: auto` para sus
 * propios controles, y ahí es donde esta comprobación evita que un toque en un
 * botón de la interfaz también mueva una unidad por debajo.
 *
 * Se usa `composedPath()` cuando existe porque atraviesa límites de Shadow DOM;
 * si no está disponible, se recorre la cadena de `parentElement` a mano.
 */
export function eventoEsDeInterfaz(evento: Event, capaInterfaz: Element): boolean {
  const ruta = typeof evento.composedPath === 'function' ? evento.composedPath() : null;
  if (ruta && ruta.length > 0) {
    for (const nodo of ruta) {
      if (nodo === capaInterfaz) return true;
    }
    return false;
  }

  let nodo = evento.target as Element | null;
  while (nodo) {
    if (nodo === capaInterfaz) return true;
    nodo = nodo.parentElement;
  }
  return false;
}

/** Coordenadas de pantalla → NDC [-1, 1], con origen en la esquina del lienzo. */
export function aNdc(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  salida: { x: number; y: number },
): void {
  salida.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  salida.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
}
