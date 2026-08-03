/// <reference types="vite/client" />
import { sesion } from '../estado/sesion';
import type { CamaraJuego } from '../render/camara';
import type { Mundo } from '../sim/mundo';
import { TipoEdificio, TipoUnidad } from '../sim/tipos';
import { crearAvisos } from './avisos';
import { crearBarraRecursos } from './barraRecursos';
import { crearCartaComandos } from './cartaComandos';
import { crearMenus } from './menus';
import { crearMinimapa } from './minimapa';
import { crearPanelSeleccion } from './panelSeleccion';
import './estilos.css';

/**
 * HUD: el orquestador que monta los seis paneles sobre `#capa-ui` y les da de
 * comer el `Mundo` y la `sesion` en cada fotograma.
 *
 * Este es el único fichero que otro módulo (la integración futura en `main.ts`,
 * que no se hace aquí) necesita importar. Todo lo demás en `src/ui/` es detalle
 * de implementación: `Hud` es la fachada.
 *
 * Responsabilidades que SÍ tiene este módulo, más allá de repartir llamadas:
 *  - Guardar la `CamaraJuego` que le pasa `fijarCamara` y usarla tanto para
 *    dibujar el rectángulo de vista en el minimapa como para recentrar la cámara
 *    cuando el jugador pulsa el minimapa o un aviso — eso es interacción de
 *    cámara pura, no una orden de simulación, así que no hace falta esperar a
 *    que nadie más la cablee.
 *  - Fusionar en un único canal (`alPulsarComando`) los comandos que nacen tanto
 *    en la carta de comandos como en la cancelación de la cola de producción del
 *    panel de selección: para quien conecte el HUD con el resto del juego son
 *    exactamente la misma cosa, un `ComandoInterfaz`.
 */

// --- Contrato público de comandos -----------------------------------------

/**
 * Acciones de unidad sin parámetros propios.
 *
 * Las que llevan objetivo ('atacar', 'patrullar', 'recolectar', 'reparar') no lo
 * incluyen aquí: la interfaz no sabe todavía sobre qué punto o qué entidad va a
 * recaer la orden. Es quien reciba el comando (la entrada, o quien cablee este
 * módulo) el que debe entrar en un modo "esperando el siguiente clic en el
 * mundo" y, con ese punto, construir la orden real de `sim/ordenes.ts`.
 */
export type AccionUnidad = 'detener' | 'atacar' | 'mantenerPosicion' | 'patrullar' | 'recolectar' | 'reparar';

/**
 * Comando emitido por la interfaz. Es una descripción de intención, no una
 * orden ejecutada: ni `hud.ts` ni ninguno de sus paneles tocan `sesion` ni
 * `mundo` para llevarla a cabo, solo la anuncian por `alPulsarComando`.
 *
 *   - `entrenar`: el jugador quiere encolar `tipoUnidad` en el edificio
 *     seleccionado (se asume que hay exactamente uno y que es suyo; la carta de
 *     comandos no ofrece este botón en ningún otro caso).
 *   - `construir`: el jugador ha elegido `tipoEdificio` en el submenú de
 *     construcción. Lo natural es que quien reciba esto entre en modo de
 *     colocación (`sesion.iniciarColocacion`).
 *   - `accion`: una de las `AccionUnidad` sin parámetros o pendiente de un
 *     objetivo que pondrá el jugador a continuación.
 *   - `cancelarCola`: cancela el elemento en la posición `indice` de la cola de
 *     producción del edificio seleccionado.
 */
export type ComandoInterfaz =
  | { clase: 'entrenar'; tipoUnidad: TipoUnidad }
  | { clase: 'construir'; tipoEdificio: TipoEdificio }
  | { clase: 'accion'; accion: AccionUnidad }
  | { clase: 'cancelarCola'; indice: number };

// --- Fachada ----------------------------------------------------------------

export interface Hud {
  /** Llamar una vez por fotograma de render, con el `Mundo` vivo y el `dt` real. */
  actualizar(mundo: Mundo, dt: number): void;
  /** La cámara cuya vista dibuja el minimapo y que mueven sus propios clics. */
  fijarCamara(camara: CamaraJuego): void;
  alPulsarMinimapa(cb: (x: number, z: number) => void): void;
  alPulsarComando(cb: (comando: ComandoInterfaz) => void): void;
  liberar(): void;
}

export function crearHud(contenedor: HTMLElement, mundo: Mundo): Hud {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-hud';
  contenedor.appendChild(raiz);

  const barraRecursos = crearBarraRecursos();
  const cartaComandos = crearCartaComandos();
  const panelSeleccion = crearPanelSeleccion();
  const minimapa = crearMinimapa(sesion.bandoJugador);
  const avisos = crearAvisos();
  const menus = crearMenus();

  raiz.append(barraRecursos.raiz, minimapa.raiz, panelSeleccion.raiz, cartaComandos.raiz, avisos.raiz, menus.raiz);

  let camara: CamaraJuego | null = null;
  let externoMinimapa: (x: number, z: number) => void = () => {};
  let externoComando: (comando: ComandoInterfaz) => void = () => {};

  // Pulsar el minimapa o un aviso recentra la cámara: es un gesto de navegación
  // de la propia interfaz, no una orden que la simulación necesite conocer.
  minimapa.alPulsar((x, z) => {
    camara?.irA(x, z);
    externoMinimapa(x, z);
  });
  avisos.alPulsar((x, z) => camara?.irA(x, z));

  cartaComandos.alPulsarComando((comando) => externoComando(comando));
  panelSeleccion.alPulsarComando((comando) => externoComando(comando));

  // Referencia usada solo para que `crearHud(contenedor, mundo)` tenga un primer
  // `Mundo` con el que pintar algo antes del primer `actualizar()` real (por
  // ejemplo, si quien integra este módulo tarda un fotograma en llamarlo).
  barraRecursos.actualizar(mundo, sesion.bandoJugador, sesion.tiempoPartida, 0);
  cartaComandos.actualizar(mundo);
  panelSeleccion.actualizar(mundo);

  return {
    actualizar(mundoActual: Mundo, dt: number): void {
      barraRecursos.actualizar(mundoActual, sesion.bandoJugador, sesion.tiempoPartida, dt);
      cartaComandos.actualizar(mundoActual);
      panelSeleccion.actualizar(mundoActual);
      minimapa.actualizar(mundoActual, camara, dt);
      avisos.actualizar(sesion.avisos, sesion.tiempoPartida);
      menus.actualizar(mundoActual, dt);
    },

    fijarCamara(nuevaCamara: CamaraJuego): void {
      camara = nuevaCamara;
    },

    alPulsarMinimapa(cb: (x: number, z: number) => void): void {
      externoMinimapa = cb;
    },

    alPulsarComando(cb: (comando: ComandoInterfaz) => void): void {
      externoComando = cb;
    },

    liberar(): void {
      barraRecursos.liberar();
      cartaComandos.liberar();
      panelSeleccion.liberar();
      minimapa.liberar();
      avisos.liberar();
      menus.liberar();
      raiz.remove();
    },
  };
}
