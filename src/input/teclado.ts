import { sesion } from '../estado/sesion';
import { MS_DOBLE_TOQUE } from '../sim/constantes';
import {
  cancelarOrden,
  ordenarAtacarMover,
  ordenarMantenerPosicion,
  ordenarPatrullar,
  ordenarReparar,
  ordenarRecolectar,
} from '../sim/ordenes';
import { Clase, Entidad, ENTIDAD_NULA, NUM_TIPOS_EDIFICIO, TipoEdificio, indiceDe } from '../sim/tipos';
import type { Mundo } from '../sim/mundo';
import type { CamaraJuego } from '../render/camara';
import type { ControlCamara } from './camaraControl';
import { obrerosOciosos } from './seleccion';

/**
 * Teclado: todo lo que en el esquema de escritorio se dispara con una tecla y no
 * con el ratón. Traduce cada tecla a llamadas sobre `sesion` y `../sim/ordenes`;
 * quien decide dónde mueve la cámara con WASD/flechas es `ControlCamara`, este
 * módulo solo calcula la dirección pedida cada fotograma.
 *
 * ── Un conflicto real del propio encargo, resuelto a propósito ──────────────────
 * El esquema pide a la vez «WASD/flechas cámara» y «A ataque-movimiento». Ambas
 * cosas no caben en la tecla A. Se resuelve dando prioridad a los comandos de una
 * sola letra (A, S, H, P) sobre su homónimo de WASD: las flechas cubren solas las
 * cuatro direcciones sin ambigüedad, y W/D quedan libres para camera también
 * (no chocan con ningún comando), pero A y S se reservan para ataque-movimiento y
 * detener. Es la misma solución que adoptan los clásicos del género (Age of
 * Empires II, por ejemplo, mueve la cámara solo con flechas por esta razón exacta).
 *
 * ── Grupos de control (1-9) ──────────────────────────────────────────────────────
 * Pulsar un número recupera el grupo. Ctrl+número lo guarda. Pulsar el mismo número
 * dos veces seguidas (dentro de `MS_DOBLE_TOQUE`, la misma ventana que ya usa el
 * doble toque de selección: es la definición de «rápido» que maneja todo el resto
 * de la entrada) además centra la cámara en el grupo.
 *
 * ── «B», menú de construcción ────────────────────────────────────────────────────
 * Este frente no incluye ni posee `src/ui/**`, y ahí es donde vive el panel real
 * (rejilla de iconos, costes, tecnología). Sin ese panel no hay de dónde elegir un
 * tipo de edificio con el ratón, así que B se implementa como lo único honesto que
 * se puede ofrecer sin invadir ese fichero: cicla `sesion.iniciarColocacion` por los
 * tipos de edificio uno a uno. Dejo el fantasma de colocación, la validación de
 * suelo y la confirmación con el clic completamente funcionales (eso sí es de este
 * frente); lo que falta es la cuadrícula de iconos que la traduzca en un menú de
 * verdad, y eso le corresponde a quien construya `src/ui`.
 */

export type ModoObjetivo = 'atacar' | 'patrullar' | 'reparar' | 'recolectar' | null;

function numeroDeDigito(codigo: string): number | undefined {
  if (!codigo.startsWith('Digit')) return undefined;
  const n = Number(codigo.slice(5));
  return n >= 1 && n <= 9 ? n : undefined;
}

export class ControlTeclado {
  private readonly camara: CamaraJuego;
  private readonly controlCamara: ControlCamara;

  private presionadas = new Set<string>();
  private modoObjetivo: ModoObjetivo = null;
  private ultimaPulsacionGrupo = new Map<number, number>();
  private cicloObreroOcioso = -1;
  private tipoColocacionCiclo = 0;

  /**
   * Se llama cuando Escape no tuvo nada que cancelar en la jugabilidad. Quien
   * cablea este módulo decide qué significa eso —normalmente, alternar la
   * pausa—; el teclado no sabe nada de menús.
   */
  private alEscapeVacio?: () => void;

  /**
   * Si hay un menú abierto, la cascada de Escape ni se plantea cancelar nada
   * de la jugabilidad: ese Escape es para cerrar el menú, y decidirlo es tan
   * responsabilidad de `alEscapeVacio` como abrirlo. Sin esto, un menú recién
   * abierto por `alEscapeVacio` en este mismo evento podría cancelarse una
   * selección residual bajo cuerda en el próximo Escape en vez de cerrarse.
   */
  private hayMenuAbierto?: () => boolean;

  constructor(camara: CamaraJuego, controlCamara: ControlCamara) {
    this.camara = camara;
    this.controlCamara = controlCamara;
  }

  fijarAlEscapeVacio(cb: () => void): void {
    this.alEscapeVacio = cb;
  }

  fijarConsultaMenuAbierto(cb: () => boolean): void {
    this.hayMenuAbierto = cb;
  }

  get modoObjetivoActivo(): ModoObjetivo {
    return this.modoObjetivo;
  }

  /**
   * Activa un modo de espera de objetivo desde fuera del teclado: lo usa la carta
   * de comandos de la interfaz cuando el jugador pulsa «atacar», «patrullar»,
   * «reparar» o «recolectar» con el ratón en vez de con la tecla correspondiente.
   * El siguiente clic/toque lo consume `consumirClicObjetivo`, exactamente igual
   * que si hubiera venido de pulsar A o P.
   */
  activarModoObjetivo(modo: Exclude<ModoObjetivo, null>): void {
    this.modoObjetivo = modo;
  }

  alPulsarTecla(mundo: Mundo, codigo: string, tiempoMs: number, ctrl: boolean): void {
    const numero = numeroDeDigito(codigo);
    if (numero !== undefined) {
      this.manejarGrupo(mundo, numero, ctrl, tiempoMs);
      return;
    }

    this.presionadas.add(codigo);

    switch (codigo) {
      case 'KeyA':
        this.modoObjetivo = 'atacar';
        break;
      case 'KeyP':
        this.modoObjetivo = 'patrullar';
        break;
      case 'KeyS':
        cancelarOrden(mundo, sesion.seleccion, sesion.bandoJugador);
        break;
      case 'KeyH':
        ordenarMantenerPosicion(mundo, sesion.seleccion, sesion.bandoJugador);
        break;
      case 'KeyB':
        this.cicloConstruccion();
        break;
      case 'Escape':
        // Solo si no había nada de la jugabilidad que cancelar (modo de objetivo,
        // colocación, selección) se deja pasar el Escape hacia arriba: es la
        // señal de que le toca a la pausa, no a este cascada.
        if (!this.manejarEscape()) this.alEscapeVacio?.();
        break;
      case 'Space':
        this.saltarAlUltimoAviso();
        break;
      case 'Comma':
        this.ciclarObreroOcioso(mundo);
        break;
      case 'Home':
        this.centrarEnBase(mundo);
        break;
      default:
        break;
    }
  }

  alSoltarTecla(codigo: string): void {
    this.presionadas.delete(codigo);
  }

  /**
   * Intenta consumir un clic/toque como destino de un modo de espera activo
   * (atacar, patrullar, reparar o recolectar). `objetivo`, la entidad bajo el
   * puntero si hay alguna, es obligatorio para reparar/recolectar —esos dos
   * ordenan sobre una entidad concreta, no sobre un punto suelto— y se ignora en
   * atacar/patrullar, que sí aceptan mover hacia suelo vacío.
   */
  consumirClicObjetivo(mundo: Mundo, x: number, z: number, objetivo: Entidad = ENTIDAD_NULA): boolean {
    if (this.modoObjetivo === null) return false;
    const modo = this.modoObjetivo;

    if ((modo === 'reparar' || modo === 'recolectar') && objetivo === ENTIDAD_NULA) {
      // Sin una entidad bajo el dedo no hay nada que reparar ni recolectar: se deja
      // el modo activo para que el jugador pueda intentarlo de nuevo con más tino,
      // en vez de descartar la orden silenciosamente sobre suelo vacío.
      return true;
    }
    this.modoObjetivo = null;

    switch (modo) {
      case 'atacar':
        ordenarAtacarMover(mundo, sesion.seleccion, x, z, sesion.bandoJugador);
        break;
      case 'patrullar':
        ordenarPatrullar(mundo, sesion.seleccion, x, z, sesion.bandoJugador);
        break;
      case 'reparar':
        ordenarReparar(mundo, sesion.seleccion, objetivo, sesion.bandoJugador);
        break;
      case 'recolectar':
        ordenarRecolectar(mundo, sesion.seleccion, objetivo, sesion.bandoJugador);
        break;
    }
    return true;
  }

  /** Dirección continua WASD/flechas, para que `ControlCamara` la aplique cada fotograma. */
  actualizar(): void {
    let dx = 0;
    let dz = 0;
    if (this.presionadas.has('ArrowUp') || this.presionadas.has('KeyW')) dz -= 1;
    if (this.presionadas.has('ArrowDown')) dz += 1;
    if (this.presionadas.has('ArrowLeft')) dx -= 1;
    if (this.presionadas.has('ArrowRight') || this.presionadas.has('KeyD')) dx += 1;
    this.controlCamara.fijarDireccionTeclado(dx, dz);
  }

  liberar(): void {
    this.presionadas.clear();
    this.controlCamara.fijarDireccionTeclado(0, 0);
  }

  // --- Privado ---

  private manejarGrupo(mundo: Mundo, numero: number, ctrl: boolean, tiempoMs: number): void {
    if (ctrl) {
      sesion.guardarGrupo(numero);
      return;
    }
    const habia = sesion.recuperarGrupo(mundo, numero);
    const anterior = this.ultimaPulsacionGrupo.get(numero) ?? -Infinity;
    this.ultimaPulsacionGrupo.set(numero, tiempoMs);
    if (habia && tiempoMs - anterior <= MS_DOBLE_TOQUE) {
      this.centrarEnSeleccion(mundo);
    }
  }

  private centrarEnSeleccion(mundo: Mundo): void {
    if (sesion.seleccion.length === 0) return;
    let sx = 0;
    let sz = 0;
    let n = 0;
    for (const entidad of sesion.seleccion) {
      if (!mundo.esValida(entidad)) continue;
      const i = indiceDe(entidad);
      sx += mundo.x[i]!;
      sz += mundo.z[i]!;
      n++;
    }
    if (n === 0) return;
    this.camara.irA(sx / n, sz / n);
  }

  private cicloConstruccion(): void {
    if (sesion.colocacion.activo) sesion.cancelarColocacion();
    this.tipoColocacionCiclo = (this.tipoColocacionCiclo + 1) % NUM_TIPOS_EDIFICIO;
    sesion.iniciarColocacion(this.tipoColocacionCiclo as TipoEdificio);
  }

  /** Cancela un paso de la jugabilidad. Devuelve si de verdad canceló algo. */
  private manejarEscape(): boolean {
    if (this.hayMenuAbierto?.()) return false;
    if (this.modoObjetivo !== null) {
      this.modoObjetivo = null;
      return true;
    }
    if (sesion.colocacion.activo) {
      sesion.cancelarColocacion();
      return true;
    }
    if (sesion.seleccion.length > 0) {
      sesion.limpiarSeleccion();
      return true;
    }
    return false;
  }

  private saltarAlUltimoAviso(): void {
    const aviso = sesion.ultimoAvisoActivo;
    if (aviso) this.camara.irA(aviso.x, aviso.z);
  }

  private ciclarObreroOcioso(mundo: Mundo): void {
    const ociosos = obrerosOciosos(mundo, sesion.bandoJugador);
    if (ociosos.length === 0) return;
    this.cicloObreroOcioso = (this.cicloObreroOcioso + 1) % ociosos.length;
    const indice = ociosos[this.cicloObreroOcioso]!;
    sesion.seleccionar(mundo, [mundo.entidadDeIndice(indice)]);
    this.camara.irA(mundo.x[indice]!, mundo.z[indice]!);
  }

  private centrarEnBase(mundo: Mundo): void {
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.clase[i] !== Clase.EDIFICIO) continue;
      if (mundo.tipo[i] !== TipoEdificio.AYUNTAMIENTO) continue;
      if (mundo.bando[i] !== sesion.bandoJugador) continue;
      this.camara.saltarA(mundo.x[i]!, mundo.z[i]!);
      return;
    }
  }
}
