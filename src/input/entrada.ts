import * as THREE from 'three';
import { sesion } from '../estado/sesion';
import { fichaEdificio } from '../sim/datos/edificios';
import { ordenContextual, ordenarConstruir } from '../sim/ordenes';
import { CamaraJuego } from '../render/camara';
import { Mundo } from '../sim/mundo';
import { ENTIDAD_NULA, Entidad } from '../sim/tipos';
import { ControlCamara, FACTOR_RUEDA } from './camaraControl';
import { CallbacksGestos, DetectorGestos, ResultadoPulsacionLarga } from './gestos';
import { aNdc, eventoEsDeInterfaz, normalizarPuntero } from './puntero';
import {
  entidadBajoPuntero,
  mismasEnMapa,
  mismasEnPantalla,
  seleccionEnCaja,
} from './seleccion';
import { ControlTeclado } from './teclado';

/**
 * Gestor unificado de entrada del jugador.
 *
 * Es el único punto de entrada de este frente: cablea Pointer Events y teclado
 * sobre el lienzo, traduce lo que decide `gestos.ts` (qué gesto es este) en llamadas
 * sobre `sesion` y `../sim/ordenes`, y delega el movimiento de cámara en
 * `camaraControl.ts` y las teclas en `teclado.ts`. No escribe directamente en el
 * mundo: todo lo que cambia la simulación pasa por `src/sim/ordenes.ts`, que es de
 * quien es (ya terminado, ya probado). Este módulo solo decide *cuándo* llamarlo.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESQUEMA DE CONTROL — ESCRITORIO
 * ═══════════════════════════════════════════════════════════════════════════════
 *   Clic izquierdo (toque corto, sin arrastre)
 *     · sobre una unidad/edificio → lo selecciona (prioriza unidades sobre
 *       edificios; el más cercano si hay varios candidatos).
 *     · sobre suelo vacío → limpia la selección.
 *     · Mayúsculas mantenida → añade a la selección en vez de reemplazarla.
 *   Arrastrar con el izquierdo (más de `UMBRAL_ARRASTRE` px) → caja de selección.
 *     Si atrapa unidades propias y enemigas, solo cuentan las propias; si atrapa
 *     unidades y edificios, solo cuentan las unidades (`seleccion.ts:filtrarPrioridad`).
 *   Doble clic sobre una entidad → selecciona todas las de su mismo tipo y bando
 *     visibles en pantalla. Ctrl + doble clic → las del mapa entero.
 *   Clic derecho → orden contextual (`ordenContextual`): ataca si hay un enemigo
 *     bajo el cursor, recolecta o repara/ayuda a construir si toca, si no, mueve.
 *     Es una acción instantánea al pulsar, no una que espere a soltar.
 *   Botón central, arrastrar → desplaza la cámara (mismo código que el arrastre
 *     de un dedo: ver la nota de `camaraControl.ts` sobre anclaje al terreno).
 *   Borde de la pantalla (con cualquier botón levantado) → desplaza la cámara.
 *   Rueda del ratón → zoom multiplicativo anclado al cursor.
 *   Teclado: ver la cabecera de `teclado.ts` para el detalle (incluye el conflicto
 *     WASD-vs-A resuelto ahí) — flechas siempre mueven la cámara, W/D también;
 *     A ataque-movimiento, S detener, H mantener posición, P patrullar, B cicla
 *     tipos de edificio en el fantasma de colocación (ver nota sobre `src/ui` en
 *     `teclado.ts`), 1-9/Ctrl+1-9/doble-1-9 grupos de control, Esc cancela en
 *     cascada (objetivo → colocación → selección), Espacio salta al último aviso,
 *     coma cicla obreros ociosos, Inicio centra en el ayuntamiento propio.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ESQUEMA DE CONTROL — MÓVIL
 * ═══════════════════════════════════════════════════════════════════════════════
 * Un solo dedo es el gesto más disputado: tiene que servir para desplazar la
 * cámara (el uso más frecuente, con mucha diferencia) y también, de algún modo,
 * para dibujar una caja de selección. La solución que ya dejó preparada
 * `gestos.ts` —y que este módulo solo tiene que aprovechar— es la siguiente:
 *
 *   · Un dedo, arrastre inmediato (sin quedarse quieto primero) → SIEMPRE cámara,
 *     con inercia y desaceleración natural al soltar.
 *   · Un dedo, toque corto sin arrastre → selecciona la unidad bajo el dedo, o
 *     limpia la selección si el suelo estaba vacío. Igual que el clic izquierdo.
 *   · Un dedo que se queda quieto `MS_PULSACION_LARGA` (pulsación larga):
 *       - Si ya hay una selección propia → dispara la orden contextual en ese
 *         punto de inmediato (`ordenContextual`), con el mismo aviso/marcador de
 *         destino que ya pinta la interfaz al escuchar el evento `ordenEmitida`
 *         del bus — esa es la «retroalimentación visual clara» que pide el
 *         encargo: no hace falta inventar un campo nuevo en `sesion`, el propio
 *         módulo de órdenes ya la emite. El dedo queda consumido: arrastrarlo
 *         después no hace nada más (evita disparar una segunda orden sin querer).
 *       - Si no hay selección propia → entra en modo caja de selección: el
 *         arrastre que venga después de la pulsación larga dibuja el rectángulo,
 *         igual que arrastrar con el ratón.
 *     Justificación de por qué esta es LA solución y no «dos dedos arrastran una
 *     caja»: los dos dedos ya están reservados para pellizco (zoom) y rotación,
 *     que son gestos que el jugador espera poder hacer en cualquier momento sin
 *     pensar en qué tiene seleccionado; convertirlos también en «modo caja»
 *     obligaría a diferenciar por tiempo o por si se mueven en la misma dirección,
 *     mucho más frágil que la regla que ya existe. Además, «mantener pulsado para
 *     entrar en modo selección» es un patrón táctil ya familiar (selección múltiple
 *     en galerías de fotos, gestores de archivos). Coste real: con una selección
 *     activa no se puede abrir una caja nueva con una pulsación larga (siempre
 *     lanza la orden); para reemplazar la selección hay que tocar primero el
 *     suelo vacío (la deselecciona) y luego mantener pulsado y arrastrar. Es una
 *     concesión consciente, no un descuido.
 *   · Pellizco (dos dedos, distancia) → zoom multiplicativo anclado al punto medio
 *     entre los dos dedos.
 *   · Rotación (dos dedos, ángulo) → gira la cámara. Lleva un umbral
 *     (`UMBRAL_ROTACION_DOS_DEDOS`, en `gestos.ts`) para que un pellizco con la
 *     mano ligeramente torcida no gire la cámara sin que el jugador lo pida.
 *   · Todo lo que en escritorio se descubre pasando el ratón (resaltado de la
 *     entidad bajo el cursor, fantasma de colocación de edificio) se actualiza en
 *     móvil con la posición del dedo mientras se arrastra o se pulsa, ya que no
 *     existe un «hover» sin contacto en una pantalla táctil.
 *
 * Cero eventos de ratón/toque por separado: todo entra por Pointer Events
 * (`puntero.ts` normaliza) y sale por la misma `DetectorGestos`, ratón y dedo
 * comparten máquina de estados salvo donde el propio `gestos.ts` distingue a
 * propósito (botón derecho, pulsación larga solo táctil).
 */

export interface GestorEntrada {
  /** Se llama una vez por fotograma; aplica inercia, borde de pantalla y teclado. */
  actualizar(dt: number): void;
  /** Sustituye el mundo sobre el que opera (nueva partida, cambio de mapa). */
  fijarMundo(mundo: Mundo): void;
  /** El HUD ha recibido un clic/toque sobre el minimapa en esta coordenada de mundo. */
  alPulsarMinimapa(x: number, z: number): void;
  /**
   * La interfaz ha pulsado un botón de acción que necesita un objetivo (atacar,
   * patrullar, reparar, recolectar): el siguiente clic o toque sobre el lienzo lo
   * consume, exactamente igual que si el jugador hubiera pulsado la tecla A o P.
   */
  activarModoObjetivo(modo: 'atacar' | 'patrullar' | 'reparar' | 'recolectar'): void;
  /** Desengancha todos los listeners del DOM. */
  liberar(): void;
}

export interface OpcionesEntrada {
  lienzo: HTMLCanvasElement;
  camara: CamaraJuego;
  mundo: Mundo;
  capaInterfaz: HTMLElement;
}

// --- Escritorio auxiliar reutilizado, sin reservas por evento ---
const ndcTmp = { x: 0, y: 0 };
const puntoMundoTmp = new THREE.Vector3();

export function crearEntrada(opciones: OpcionesEntrada): GestorEntrada {
  const { lienzo, camara, capaInterfaz } = opciones;
  let mundo = opciones.mundo;

  const controlCamara = new ControlCamara(camara);
  const teclado = new ControlTeclado(camara, controlCamara);

  let shiftActivo = false;
  let ctrlActivo = false;
  let ultimoTiempoArrastre = performance.now();

  // --- Utilidades internas ---

  function puntoMundoDesdeCliente(clientX: number, clientY: number): boolean {
    const rect = lienzo.getBoundingClientRect();
    aNdc(clientX, clientY, rect, ndcTmp);
    return camara.puntoEnSuelo(ndcTmp.x, ndcTmp.y, puntoMundoTmp);
  }

  /** Fantasma de colocación de edificio: sigue al dedo/ratón mientras está activo. */
  function actualizarColocacion(clientX: number, clientY: number): void {
    if (!sesion.colocacion.activo) return;
    if (!puntoMundoDesdeCliente(clientX, clientY)) return;
    const ficha = fichaEdificio(sesion.colocacion.tipo);
    const cxCursor = mundo.mapa.aCasilla(puntoMundoTmp.x);
    const czCursor = mundo.mapa.aCasilla(puntoMundoTmp.z);
    const cx = cxCursor - Math.floor(ficha.huella / 2);
    const cz = czCursor - Math.floor(ficha.huella / 2);
    sesion.colocacion.cx = cx;
    sesion.colocacion.cz = cz;
    sesion.colocacion.valida = mundo.mapa.cabeEdificio(cx, cz, ficha.huella);
  }

  /** Si hay un fantasma de colocación activo, intenta confirmarlo. Devuelve si lo consumió. */
  function confirmarColocacionSiActiva(): boolean {
    if (!sesion.colocacion.activo) return false;
    if (sesion.colocacion.valida) {
      ordenarConstruir(
        mundo,
        sesion.seleccion,
        sesion.colocacion.tipo,
        sesion.colocacion.cx,
        sesion.colocacion.cz,
        sesion.bandoJugador,
      );
      sesion.cancelarColocacion();
    }
    // Consumido igual si no era válida: un toque durante la colocación nunca
    // debe interpretarse además como una selección normal.
    return true;
  }

  function seleccionarEnPunto(x: number, z: number, sumar: boolean): void {
    const entidad = entidadBajoPuntero(mundo, x, z);
    if (entidad === ENTIDAD_NULA) {
      if (!sumar) sesion.limpiarSeleccion();
      return;
    }
    if (sumar) sesion.anadirASeleccion(mundo, [entidad]);
    else sesion.seleccionar(mundo, [entidad]);
  }

  // --- Callbacks del detector de gestos ---

  const callbacks: CallbacksGestos = {
    alTocar(xPantalla, yPantalla, esRaton, boton) {
      if (boton === 2) {
        if (sesion.terminada) return;
        if (!puntoMundoDesdeCliente(xPantalla, yPantalla)) return;
        if (sesion.colocacion.activo) {
          sesion.cancelarColocacion();
          return;
        }
        const objetivo = entidadBajoPuntero(mundo, puntoMundoTmp.x, puntoMundoTmp.z);
        ordenContextual(mundo, sesion.seleccion, puntoMundoTmp.x, puntoMundoTmp.z, objetivo);
        return;
      }
      if (boton === 1) return; // botón central: solo mueve cámara, ya gestionado aparte.
      if (sesion.terminada) return;

      if (!puntoMundoDesdeCliente(xPantalla, yPantalla)) return;
      if (confirmarColocacionSiActiva()) return;
      if (teclado.modoObjetivoActivo !== null) {
        const objetivo = entidadBajoPuntero(mundo, puntoMundoTmp.x, puntoMundoTmp.z);
        if (teclado.consumirClicObjetivo(mundo, puntoMundoTmp.x, puntoMundoTmp.z, objetivo)) return;
      }

      seleccionarEnPunto(puntoMundoTmp.x, puntoMundoTmp.z, esRaton && shiftActivo);
    },

    alTocarDoble(xPantalla, yPantalla, boton) {
      if (boton !== 0 || sesion.terminada) return;
      if (!puntoMundoDesdeCliente(xPantalla, yPantalla)) return;
      const modelo = entidadBajoPuntero(mundo, puntoMundoTmp.x, puntoMundoTmp.z);
      if (modelo === ENTIDAD_NULA) return;

      const rect = lienzo.getBoundingClientRect();
      const grupo: Entidad[] = ctrlActivo
        ? mismasEnMapa(mundo, modelo)
        : mismasEnPantalla(mundo, camara, modelo, rect.width, rect.height);
      if (grupo.length > 0) sesion.seleccionar(mundo, grupo);
    },

    alPulsarLargo(xPantalla, yPantalla): ResultadoPulsacionLarga {
      if (sesion.terminada) return 'ninguno';
      if (!puntoMundoDesdeCliente(xPantalla, yPantalla)) return 'ninguno';

      if (sesion.colocacion.activo) {
        confirmarColocacionSiActiva();
        return 'ninguno';
      }

      // Con selección propia, la pulsación larga es la orden contextual táctil;
      // sin ella, entra en modo caja (ver la nota de cabecera del módulo).
      if (sesion.seleccionEsPropia(mundo)) {
        const objetivo = entidadBajoPuntero(mundo, puntoMundoTmp.x, puntoMundoTmp.z);
        ordenContextual(mundo, sesion.seleccion, puntoMundoTmp.x, puntoMundoTmp.z, objetivo);
        return 'ninguno';
      }
      return 'caja';
    },

    alIniciarArrastreCamara() {
      controlCamara.iniciarArrastre();
      ultimoTiempoArrastre = performance.now();
    },
    alArrastrarCamara(dx, dy, x, y) {
      const ahora = performance.now();
      const dt = Math.min(0.1, Math.max(0, (ahora - ultimoTiempoArrastre) / 1000));
      ultimoTiempoArrastre = ahora;
      const rect = lienzo.getBoundingClientRect();
      controlCamara.arrastrar(dx, dy, x, y, rect, dt);
    },
    alSoltarArrastreCamara() {
      controlCamara.soltarArrastre();
    },

    alIniciarCaja(x, y) {
      sesion.cajaSeleccion = { x0: x, y0: y, x1: x, y1: y };
    },
    alArrastrarCaja(x, y) {
      if (sesion.cajaSeleccion) {
        sesion.cajaSeleccion.x1 = x;
        sesion.cajaSeleccion.y1 = y;
      }
    },
    alSoltarCaja(x, y) {
      const caja = sesion.cajaSeleccion;
      sesion.cajaSeleccion = null;
      if (!caja || sesion.terminada) return;
      const rect = lienzo.getBoundingClientRect();
      const grupo = seleccionEnCaja(
        mundo,
        camara,
        caja.x0,
        caja.y0,
        x,
        y,
        sesion.bandoJugador,
        rect.width,
        rect.height,
      );
      if (shiftActivo) sesion.anadirASeleccion(mundo, grupo);
      else sesion.seleccionar(mundo, grupo);
    },

    alPellizco(factor, xMedio, yMedio) {
      const rect = lienzo.getBoundingClientRect();
      aNdc(xMedio, yMedio, rect, ndcTmp);
      controlCamara.acercarHaciaPunto(factor, ndcTmp.x, ndcTmp.y);
    },
    alRotarDosDedos(deltaRadianes) {
      controlCamara.girar(deltaRadianes);
    },
    alIniciarDosDedos() {
      controlCamara.detenerInercia();
    },
    alSoltarDosDedos() {
      // Nada que limpiar: el dedo que queda retoma su propio ciclo de vida en `gestos.ts`.
    },
  };

  const detector = new DetectorGestos(callbacks);

  // --- DOM: Pointer Events ---

  function capturar(id: number): void {
    try {
      lienzo.setPointerCapture(id);
    } catch {
      // Algunos entornos de prueba no soportan la captura; degradar en silencio
      // es preferible a tumbar la entrada por un detalle de compatibilidad.
    }
  }

  function alPointerDown(evento: PointerEvent): void {
    if (eventoEsDeInterfaz(evento, capaInterfaz)) return;
    evento.preventDefault();
    shiftActivo = evento.shiftKey;
    ctrlActivo = evento.ctrlKey || evento.metaKey;
    capturar(evento.pointerId);
    const n = normalizarPuntero(evento);
    detector.alPresionar(n.id, n.clientX, n.clientY, n.esRaton, n.boton, performance.now());
  }

  function alPointerMove(evento: PointerEvent): void {
    if (eventoEsDeInterfaz(evento, capaInterfaz)) return;

    // El resaltado bajo el cursor y el desplazamiento por borde son pasivos: no
    // dependen de que `gestos.ts` esté rastreando un arrastre.
    if (evento.pointerType === 'mouse') {
      const rect = lienzo.getBoundingClientRect();
      controlCamara.actualizarBorde(
        evento.clientX - rect.left,
        evento.clientY - rect.top,
        rect.width,
        rect.height,
      );
      if (!sesion.terminada) {
        actualizarColocacion(evento.clientX, evento.clientY);
        sesion.entidadResaltada = puntoMundoDesdeCliente(evento.clientX, evento.clientY)
          ? entidadBajoPuntero(mundo, puntoMundoTmp.x, puntoMundoTmp.z)
          : ENTIDAD_NULA;
      }
    } else if (!sesion.terminada) {
      // Sin hover táctil: el fantasma de colocación sigue al dedo mientras se
      // arrastra o se mantiene pulsado.
      actualizarColocacion(evento.clientX, evento.clientY);
    }

    shiftActivo = evento.shiftKey;
    ctrlActivo = evento.ctrlKey || evento.metaKey;
    detector.alMover(evento.pointerId, evento.clientX, evento.clientY, performance.now());
  }

  function alPointerUp(evento: PointerEvent): void {
    shiftActivo = evento.shiftKey;
    ctrlActivo = evento.ctrlKey || evento.metaKey;
    detector.alSoltar(evento.pointerId, evento.clientX, evento.clientY, performance.now());
  }

  function alPointerCancel(evento: PointerEvent): void {
    detector.alCancelar(evento.pointerId);
  }

  function alPointerLeave(): void {
    controlCamara.limpiarBorde();
  }

  function alContextMenu(evento: MouseEvent): void {
    // El menú del navegador taparía justo la orden contextual del botón derecho.
    evento.preventDefault();
  }

  function alWheel(evento: WheelEvent): void {
    if (eventoEsDeInterfaz(evento, capaInterfaz)) return;
    evento.preventDefault();
    const rect = lienzo.getBoundingClientRect();
    aNdc(evento.clientX, evento.clientY, rect, ndcTmp);
    const factor = evento.deltaY > 0 ? FACTOR_RUEDA : 1 / FACTOR_RUEDA;
    controlCamara.acercarHaciaPunto(factor, ndcTmp.x, ndcTmp.y);
  }

  function alKeyDown(evento: KeyboardEvent): void {
    if (eventoEsDeInterfaz(evento, capaInterfaz)) return;
    if (evento.repeat) return; // el mantenimiento de tecla ya lo cubre `presionadas`.
    teclado.alPulsarTecla(mundo, evento.code, performance.now(), evento.ctrlKey || evento.metaKey);
  }

  function alKeyUp(evento: KeyboardEvent): void {
    teclado.alSoltarTecla(evento.code);
  }

  lienzo.addEventListener('pointerdown', alPointerDown);
  lienzo.addEventListener('pointermove', alPointerMove);
  lienzo.addEventListener('pointerup', alPointerUp);
  lienzo.addEventListener('pointercancel', alPointerCancel);
  lienzo.addEventListener('pointerleave', alPointerLeave);
  lienzo.addEventListener('contextmenu', alContextMenu);
  lienzo.addEventListener('wheel', alWheel, { passive: false });
  window.addEventListener('keydown', alKeyDown);
  window.addEventListener('keyup', alKeyUp);

  return {
    actualizar(dt: number): void {
      detector.actualizar(performance.now());
      teclado.actualizar();
      controlCamara.actualizar(dt);
    },
    fijarMundo(nuevoMundo: Mundo): void {
      mundo = nuevoMundo;
    },
    alPulsarMinimapa(x: number, z: number): void {
      camara.saltarA(x, z);
    },
    activarModoObjetivo(modo: 'atacar' | 'patrullar' | 'reparar' | 'recolectar'): void {
      teclado.activarModoObjetivo(modo);
    },
    liberar(): void {
      lienzo.removeEventListener('pointerdown', alPointerDown);
      lienzo.removeEventListener('pointermove', alPointerMove);
      lienzo.removeEventListener('pointerup', alPointerUp);
      lienzo.removeEventListener('pointercancel', alPointerCancel);
      lienzo.removeEventListener('pointerleave', alPointerLeave);
      lienzo.removeEventListener('contextmenu', alContextMenu);
      lienzo.removeEventListener('wheel', alWheel);
      window.removeEventListener('keydown', alKeyDown);
      window.removeEventListener('keyup', alKeyUp);
      detector.reiniciar();
      teclado.liberar();
    },
  };
}
