import { limitar } from './math';

/**
 * Bucle principal con paso fijo para la simulación y paso libre para el render.
 *
 * Por qué separarlos: la simulación de un RTS debe avanzar siempre en incrementos
 * idénticos (determinismo, física estable, IA predecible), mientras que el render
 * debe ir tan rápido como pueda el dispositivo. El acumulador clásico resuelve las
 * dos cosas a la vez, y el factor `alfa` que se pasa al render permite interpolar
 * entre el estado anterior y el actual: 20 ticks por segundo se ven como 120 fps.
 */

export interface OpcionesBucle {
  /** Ticks de simulación por segundo. */
  hercios?: number;
  /** Tope de ticks por fotograma, para no entrar en la espiral de la muerte. */
  maxTicksPorFotograma?: number;
  /** Avanza la simulación un paso fijo. `dt` siempre vale lo mismo. */
  alSimular: (dt: number, tick: number) => void;
  /**
   * Dibuja un fotograma.
   * @param dtReal segundos transcurridos desde el fotograma anterior
   * @param alfa   posición entre el tick anterior y el actual, en [0, 1]
   */
  alRenderizar: (dtReal: number, alfa: number) => void;
}

export class BucleJuego {
  readonly hercios: number;
  readonly pasoFijo: number;

  private maxTicks: number;
  private alSimular: (dt: number, tick: number) => void;
  private alRenderizar: (dtReal: number, alfa: number) => void;

  private acumulador = 0;
  private ultimoTiempo = 0;
  private idAnimacion = 0;
  private corriendo = false;
  private pausado = false;

  /** Multiplicador de velocidad de juego. 1 = normal, 2 = rápido, 0 = congelado. */
  escalaTiempo = 1;

  /** Número de ticks simulados desde el arranque. Es el reloj de la simulación. */
  tick = 0;

  // Telemetría de rendimiento, consumida por el HUD de depuración.
  fps = 0;
  msSimulacion = 0;
  msRender = 0;
  private acumuladorFps = 0;
  private fotogramasFps = 0;

  constructor(opciones: OpcionesBucle) {
    this.hercios = opciones.hercios ?? 20;
    this.pasoFijo = 1 / this.hercios;
    this.maxTicks = opciones.maxTicksPorFotograma ?? 5;
    this.alSimular = opciones.alSimular;
    this.alRenderizar = opciones.alRenderizar;
  }

  iniciar(): void {
    if (this.corriendo) return;
    this.corriendo = true;
    this.ultimoTiempo = performance.now();
    this.acumulador = 0;
    this.idAnimacion = requestAnimationFrame(this.fotograma);
  }

  detener(): void {
    this.corriendo = false;
    if (this.idAnimacion) cancelAnimationFrame(this.idAnimacion);
    this.idAnimacion = 0;
  }

  pausar(): void {
    this.pausado = true;
  }

  reanudar(): void {
    if (!this.pausado) return;
    this.pausado = false;
    // Descartamos el tiempo transcurrido durante la pausa: si no, la simulación
    // intentaría recuperar minutos enteros de golpe.
    this.ultimoTiempo = performance.now();
    this.acumulador = 0;
  }

  get estaPausado(): boolean {
    return this.pausado;
  }

  private fotograma = (ahora: number): void => {
    if (!this.corriendo) return;
    this.idAnimacion = requestAnimationFrame(this.fotograma);

    // Un fotograma nunca puede valer más de 250 ms. Si la pestaña estuvo en segundo
    // plano, el salto sería enorme y la simulación se quedaría atascada recuperándolo.
    const dtReal = limitar((ahora - this.ultimoTiempo) / 1000, 0, 0.25);
    this.ultimoTiempo = ahora;

    this.acumuladorFps += dtReal;
    this.fotogramasFps++;
    if (this.acumuladorFps >= 0.5) {
      this.fps = this.fotogramasFps / this.acumuladorFps;
      this.acumuladorFps = 0;
      this.fotogramasFps = 0;
    }

    if (!this.pausado && this.escalaTiempo > 0) {
      this.acumulador += dtReal * this.escalaTiempo;

      const inicioSim = performance.now();
      let ticksEsteFotograma = 0;
      while (this.acumulador >= this.pasoFijo && ticksEsteFotograma < this.maxTicks) {
        this.alSimular(this.pasoFijo, this.tick);
        this.tick++;
        this.acumulador -= this.pasoFijo;
        ticksEsteFotograma++;
      }
      // Si seguimos por detrás tras agotar el presupuesto, tiramos el tiempo sobrante.
      // Vale más perder un instante de simulación que arrastrar un parón creciente.
      if (this.acumulador > this.pasoFijo * this.maxTicks) {
        this.acumulador = 0;
      }
      this.msSimulacion = performance.now() - inicioSim;
    }

    const alfa = this.pausado ? 1 : limitar(this.acumulador / this.pasoFijo, 0, 1);
    const inicioRender = performance.now();
    this.alRenderizar(dtReal, alfa);
    this.msRender = performance.now() - inicioRender;
  };
}
