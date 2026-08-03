import { UMBRAL_ARRASTRE, MS_PULSACION_LARGA, MS_DOBLE_TOQUE } from '../sim/constantes';
import { deltaAngulo } from '../core/math';

/**
 * Detección de gestos sobre punteros ya normalizados (ver `puntero.ts`).
 *
 * Es una máquina de estados alimentada a mano por `entrada.ts`: `alPresionar`,
 * `alMover`, `alSoltar`, `alCancelar` por cada evento, y `actualizar(tiempoMs)` una
 * vez por fotograma para poder detectar la pulsación larga sin usar `setTimeout`
 * (que sería una tarea suelta más que gestionar y, sobre todo, mucho más difícil
 * de probar de forma determinista: aquí basta con llamar a `actualizar` con el
 * instante que se quiera).
 *
 * Un único dedo o el ratón es el «primario»; un segundo dedo activa el modo de
 * dos dedos (pellizco + rotación) y suspende lo que estuviera haciendo el primero.
 *
 * ── Reglas de qué gesto gana ────────────────────────────────────────────────
 *  - Ratón, botón izquierdo: arrastrar de inmediato es caja de selección. No hay
 *    pulsación larga en ratón: el usuario tiene botón derecho para la orden
 *    contextual, así que no hace falta simular una espera.
 *  - Ratón, botón central: arrastrar mueve la cámara.
 *  - Ratón, botón derecho: acción instantánea al pulsar (no se espera a soltar);
 *    no genera ni arrastre ni doble clic.
 *  - Un dedo: arrastrar de inmediato mueve la cámara (con inercia, ver
 *    `camaraControl.ts`). Si el dedo se queda quieto el tiempo de una pulsación
 *    larga, `alPulsarLargo` decide qué pasa con un arrastre posterior:
 *      · devuelve 'caja'    → ese arrastre, aunque sea de un solo dedo, dibuja
 *                             una caja de selección en vez de mover la cámara.
 *      · devuelve 'ninguno' → ya se disparó una orden contextual con el punto de
 *                             la pulsación larga; cualquier movimiento posterior
 *                             de ese dedo se ignora hasta soltarlo.
 *  - Dos dedos: la distancia entre ellos manda el zoom (pellizco) en cada
 *    movimiento; el ángulo acumulado dispara el giro solo cuando supera
 *    `UMBRAL_ROTACION_DOS_DEDOS`, para que un pellizco con la mano ligeramente
 *    torcida no gire la cámara sin que el jugador lo pida.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ModoArrastre = 'camara' | 'caja';
/** Lo que decide el consumidor de `alPulsarLargo` para el arrastre que pueda seguir. */
export type ResultadoPulsacionLarga = 'caja' | 'ninguno';

/** Distancia mínima entre dedos antes de fiarse del pellizco: evita saltos con dedos casi juntos. */
const DISTANCIA_MINIMA_PELLIZCO = 14;

/** Giro acumulado, en radianes, que debe superar un pellizco antes de contar como rotación. */
export const UMBRAL_ROTACION_DOS_DEDOS = 0.05;

/** Distancia máxima entre dos toques para que cuenten como el mismo punto (doble toque/clic). */
const TOLERANCIA_POSICION_DOBLE = UMBRAL_ARRASTRE * 2;

export interface CallbacksGestos {
  /** Toque o clic corto: no hubo arrastre ni pulsación larga de por medio. */
  alTocar(x: number, y: number, esRaton: boolean, boton: number): void;
  /** Segundo toque/clic sobre (casi) el mismo punto dentro de `MS_DOBLE_TOQUE`. */
  alTocarDoble(x: number, y: number, boton: number): void;
  /**
   * Se cumplió el tiempo de pulsación larga sin que el dedo se moviera. Solo se
   * llama para punteros que no son ratón. El valor devuelto gobierna el arrastre
   * que pueda venir después (ver la nota de reglas más arriba).
   */
  alPulsarLargo(x: number, y: number): ResultadoPulsacionLarga;

  alIniciarArrastreCamara(x: number, y: number): void;
  /** `dx`/`dy` son el delta en píxeles desde el último movimiento, no desde el inicio. */
  alArrastrarCamara(dx: number, dy: number, x: number, y: number): void;
  alSoltarArrastreCamara(x: number, y: number): void;

  alIniciarCaja(x: number, y: number): void;
  alArrastrarCaja(x: number, y: number): void;
  alSoltarCaja(x: number, y: number): void;

  /** `factor` es multiplicativo y relativo al fotograma anterior, listo para `camara.acercar`. */
  alPellizco(factor: number, xMedio: number, yMedio: number): void;
  /** Radianes acumulados desde el último disparo, ya filtrados por el umbral. */
  alRotarDosDedos(deltaRadianes: number): void;
  alIniciarDosDedos(): void;
  alSoltarDosDedos(): void;
}

interface EstadoPrimario {
  id: number;
  xInicio: number;
  yInicio: number;
  x: number;
  y: number;
  xUltimo: number;
  yUltimo: number;
  tInicio: number;
  esRaton: boolean;
  boton: number;
  modo: ModoArrastre | null;
  largaDisparada: boolean;
  consumidoPorLarga: boolean;
}

interface EstadoSecundario {
  id: number;
  x: number;
  y: number;
}

interface UltimoToque {
  x: number;
  y: number;
  t: number;
}

function modoPorDefecto(esRaton: boolean, boton: number): ModoArrastre {
  if (esRaton) return boton === 0 ? 'caja' : 'camara';
  return 'camara';
}

export class DetectorGestos {
  private cb: CallbacksGestos;

  private primario: EstadoPrimario | null = null;
  private secundario: EstadoSecundario | null = null;

  private distanciaAnteriorDedos = 0;
  private anguloAnteriorDedos = 0;
  private anguloAcumulado = 0;

  private ultimoToque: UltimoToque | null = null;

  constructor(callbacks: CallbacksGestos) {
    this.cb = callbacks;
  }

  /** Punteros activos ahora mismo (0, 1 o 2). Solo para telemetría/pruebas. */
  get cantidadActiva(): number {
    return (this.primario ? 1 : 0) + (this.secundario ? 1 : 0);
  }

  alPresionar(
    id: number,
    x: number,
    y: number,
    esRaton: boolean,
    boton: number,
    tiempoMs: number,
  ): void {
    if (esRaton && boton === 2) {
      // El botón derecho es una acción instantánea: no se rastrea como un
      // arrastre en curso, así que un botón central o izquierdo pulsado a la vez
      // no se ve interferido por él.
      this.cb.alTocar(x, y, true, 2);
      return;
    }

    if (this.primario && this.secundario) return; // ya hay dos punteros; se ignora un tercero

    if (!this.primario) {
      this.primario = {
        id,
        xInicio: x,
        yInicio: y,
        x,
        y,
        xUltimo: x,
        yUltimo: y,
        tInicio: tiempoMs,
        esRaton,
        boton,
        modo: null,
        largaDisparada: false,
        consumidoPorLarga: false,
      };
      return;
    }

    // No se mezcla ratón con táctil: un segundo puntero de otra familia se ignora.
    if (this.primario.esRaton !== esRaton) return;

    this.secundario = { id, x, y };
    this.distanciaAnteriorDedos = Math.max(DISTANCIA_MINIMA_PELLIZCO, distanciaEntre(this.primario, this.secundario));
    this.anguloAnteriorDedos = anguloEntre(this.primario, this.secundario);
    this.anguloAcumulado = 0;

    if (this.primario.modo === 'camara') this.cb.alSoltarArrastreCamara(this.primario.x, this.primario.y);
    else if (this.primario.modo === 'caja') this.cb.alSoltarCaja(this.primario.x, this.primario.y);

    this.cb.alIniciarDosDedos();
  }

  alMover(id: number, x: number, y: number, _tiempoMs: number): void {
    const primario = this.primario;
    const secundario = this.secundario;

    if (primario && secundario && (id === primario.id || id === secundario.id)) {
      if (id === primario.id) {
        primario.x = x;
        primario.y = y;
      } else {
        secundario.x = x;
        secundario.y = y;
      }

      const distanciaActual = distanciaEntre(primario, secundario);
      const factor = distanciaActual / Math.max(DISTANCIA_MINIMA_PELLIZCO, this.distanciaAnteriorDedos);
      const xMedio = (primario.x + secundario.x) * 0.5;
      const yMedio = (primario.y + secundario.y) * 0.5;
      this.cb.alPellizco(factor, xMedio, yMedio);
      this.distanciaAnteriorDedos = distanciaActual;

      const anguloActual = anguloEntre(primario, secundario);
      this.anguloAcumulado += deltaAngulo(this.anguloAnteriorDedos, anguloActual);
      this.anguloAnteriorDedos = anguloActual;
      if (Math.abs(this.anguloAcumulado) >= UMBRAL_ROTACION_DOS_DEDOS) {
        this.cb.alRotarDosDedos(this.anguloAcumulado);
        this.anguloAcumulado = 0;
      }
      return;
    }

    if (!primario || id !== primario.id) return;
    primario.x = x;
    primario.y = y;
    if (primario.consumidoPorLarga) return;

    if (primario.modo === null) {
      const distancia = Math.hypot(x - primario.xInicio, y - primario.yInicio);
      if (distancia < UMBRAL_ARRASTRE) return;

      primario.modo = modoPorDefecto(primario.esRaton, primario.boton);
      primario.xUltimo = primario.xInicio;
      primario.yUltimo = primario.yInicio;
      if (primario.modo === 'camara') {
        this.cb.alIniciarArrastreCamara(primario.xInicio, primario.yInicio);
      } else {
        this.cb.alIniciarCaja(primario.xInicio, primario.yInicio);
      }
      // Cae al tramo de abajo para aplicar ya este primer movimiento.
    }

    if (primario.modo === 'camara') {
      this.cb.alArrastrarCamara(x - primario.xUltimo, y - primario.yUltimo, x, y);
      primario.xUltimo = x;
      primario.yUltimo = y;
    } else if (primario.modo === 'caja') {
      this.cb.alArrastrarCaja(x, y);
    }
  }

  alSoltar(id: number, x: number, y: number, tiempoMs: number): void {
    const primario = this.primario;
    const secundario = this.secundario;

    if (primario && secundario && (id === primario.id || id === secundario.id)) {
      this.cb.alSoltarDosDedos();
      // El dedo que queda continúa como primario, sin saltos: su origen pasa a
      // ser su posición actual, así que no se interpreta como un arrastre brusco.
      const queda = id === primario.id ? secundario : primario;
      this.primario = {
        id: queda.id,
        xInicio: queda.x,
        yInicio: queda.y,
        x: queda.x,
        y: queda.y,
        xUltimo: queda.x,
        yUltimo: queda.y,
        tInicio: tiempoMs,
        esRaton: false,
        boton: SIN_BOTON,
        modo: null,
        largaDisparada: false,
        consumidoPorLarga: false,
      };
      this.secundario = null;
      return;
    }

    if (!primario || id !== primario.id) return;

    if (primario.modo === 'camara') {
      this.cb.alSoltarArrastreCamara(x, y);
    } else if (primario.modo === 'caja') {
      this.cb.alSoltarCaja(x, y);
    } else if (!primario.consumidoPorLarga) {
      const distancia = Math.hypot(x - primario.xInicio, y - primario.yInicio);
      if (distancia < UMBRAL_ARRASTRE) {
        const anterior = this.ultimoToque;
        if (
          anterior &&
          tiempoMs - anterior.t <= MS_DOBLE_TOQUE &&
          Math.hypot(x - anterior.x, y - anterior.y) < TOLERANCIA_POSICION_DOBLE
        ) {
          this.cb.alTocarDoble(x, y, primario.boton);
          this.ultimoToque = null;
        } else {
          this.cb.alTocar(x, y, primario.esRaton, primario.boton);
          this.ultimoToque = { x, y, t: tiempoMs };
        }
      }
    }

    this.primario = null;
  }

  /** El sistema operativo interrumpe el puntero (gesto del navegador, pérdida de foco…). */
  alCancelar(id: number): void {
    const primario = this.primario;
    const secundario = this.secundario;

    if (primario && id === primario.id) {
      if (primario.modo === 'camara') this.cb.alSoltarArrastreCamara(primario.x, primario.y);
      else if (primario.modo === 'caja') this.cb.alSoltarCaja(primario.x, primario.y);
      if (secundario) this.cb.alSoltarDosDedos();
      this.primario = secundario
        ? {
            id: secundario.id,
            xInicio: secundario.x,
            yInicio: secundario.y,
            x: secundario.x,
            y: secundario.y,
            xUltimo: secundario.x,
            yUltimo: secundario.y,
            tInicio: 0,
            esRaton: false,
            boton: SIN_BOTON,
            modo: null,
            largaDisparada: false,
            consumidoPorLarga: false,
          }
        : null;
      this.secundario = null;
      return;
    }

    if (secundario && id === secundario.id) {
      this.cb.alSoltarDosDedos();
      this.secundario = null;
      if (this.primario) this.primario.modo = null;
    }
  }

  /** Se llama una vez por fotograma con el reloj actual, para vencer la pulsación larga. */
  actualizar(tiempoMs: number): void {
    const primario = this.primario;
    if (!primario || primario.esRaton || primario.modo !== null || primario.largaDisparada) return;
    // Con un segundo dedo ya en pantalla estamos en modo pellizco/rotación: si el
    // primero llevaba quieto un rato antes de que aterrizara el segundo, no debe
    // colarse una pulsación larga (orden contextual o caja) en mitad del gesto.
    if (this.secundario) return;
    if (tiempoMs - primario.tInicio < MS_PULSACION_LARGA) return;

    primario.largaDisparada = true;
    const distancia = Math.hypot(primario.x - primario.xInicio, primario.y - primario.yInicio);
    if (distancia >= UMBRAL_ARRASTRE) return; // ya se movió: eso ya lo maneja `alMover`

    const resultado = this.cb.alPulsarLargo(primario.x, primario.y);
    if (resultado === 'caja') {
      primario.modo = 'caja';
      this.cb.alIniciarCaja(primario.x, primario.y);
    } else {
      primario.consumidoPorLarga = true;
    }
  }

  /** Reinicio completo, para cuando se suelta el mundo entero (p. ej. al perder el foco la ventana). */
  reiniciar(): void {
    this.primario = null;
    this.secundario = null;
    this.ultimoToque = null;
    this.anguloAcumulado = 0;
  }
}

// --- Geometría interna, sin reservas: opera sobre los estados ya existentes ---

const SIN_BOTON = -1;

function distanciaEntre(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function anguloEntre(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}
