import { BusEventos, bus as busGlobal } from '../core/events';
import { INTERVALO_IA } from '../sim/constantes';
import { Mundo } from '../sim/mundo';
import { Bando, type EstadoBando, TipoEdificio } from '../sim/tipos';
import { CombateIA } from './combate';
import { EconomiaIA } from './economia';
import { ExploracionIA } from './exploracion';
import { FaseIA } from './fases';
import { ProduccionIA } from './produccion';

export { FaseIA } from './fases';

/**
 * Orquestador de la IA de un bando.
 *
 * `new DirectorIA(mundo, Bando.ORCOS)` y luego `paso(dt)` una vez por tick de
 * simulación, exactamente igual que `Simulacion.paso`. Por dentro solo actúa cada
 * `INTERVALO_IA` ticks (la IA no necesita pensar a 20 Hz): si quien la engancha llama
 * a `paso` en cada tick del bucle, esta clase se encarga de filtrar; si prefiere
 * llamarla ya solo cada `INTERVALO_IA` ticks, funciona exactamente igual, porque el
 * filtro mira el tick global del mundo y no un contador propio.
 *
 * Coordina cuatro módulos con una máquina de estados de cuatro fases
 * (ver `FaseIA`): ARRANQUE (pura economía) → CRECIMIENTO (barracón y las primeras
 * tropas) → MILICIA (acumular una fuerza libre) → ASALTO (presión sostenida). El
 * orden de las llamadas dentro de un pensamiento no es casual:
 *
 *  1. `exploracion` reclama primero a sus exploradores (les da destino nuevo en
 *     cuanto llegan), para que economía y combate no los cuenten como "libres" ese
 *     mismo pensamiento.
 *  2. `economia` reparte a los obreros que quedan y decide si toca construir.
 *  3. `produccion` decide qué entrenar con la fase de este pensamiento.
 *  4. la fase se recalcula con la milicia libre que vio `combate` el pensamiento
 *     anterior (medio segundo o un segundo de retraso, que para una decisión
 *     estratégica no pesa nada).
 *  5. `combate` agrupa la milicia libre de este pensamiento, defiende si hace falta
 *     y ataca si la fase y el tamaño del grupo lo permiten.
 *
 * Sin trampas: ningún módulo lee la posición del jugador salvo a través de
 * `mapa.esVisible` / `mapa.esExplorado` del propio bando, y nadie usa `Math.random()`
 * — toda la aleatoriedad de la IA sale de `mundo.azar`, así que una partida con la
 * misma semilla y las mismas órdenes del jugador se repite exactamente igual.
 */

// --- Ajustes propios del director (no existían en constantes.ts) ---

/** Segundos mínimos antes de plantearse nada más allá de la economía pura. */
export const TIEMPO_MIN_ARRANQUE = 35;

/** Techo de seguridad: si a este punto no hay barracón, se avanza de fase igualmente. */
export const TIEMPO_MAX_CRECIMIENTO = 170;

/** Población mínima (aparte del barracón) para dar CRECIMIENTO por superado. */
export const POBLACION_MINIMA_MILICIA = 14;

/** Milicia libre necesaria para pasar de acumular fuerzas a asaltar de verdad. */
export const MILICIA_PARA_ASALTO = 8;

/** Por debajo de esto en ASALTO, se vuelve a MILICIA a recomponer fuerzas. */
export const MILICIA_MINIMA_EN_ASALTO = 3;

export class DirectorIA {
  readonly mundo: Mundo;
  readonly bando: Bando;

  private readonly economia = new EconomiaIA();
  private readonly produccion = new ProduccionIA();
  private readonly combate: CombateIA;
  private readonly exploracion = new ExploracionIA();

  private faseActual: FaseIA = FaseIA.ARRANQUE;
  private segundosTranscurridos = 0;

  constructor(mundo: Mundo, bando: Bando, bus: BusEventos = busGlobal) {
    this.mundo = mundo;
    this.bando = bando;
    this.combate = new CombateIA(bando, bus);
  }

  /** Fase actual de la máquina de estados. Solo lectura: útil para depurar y para pruebas. */
  get fase(): FaseIA {
    return this.faseActual;
  }

  /**
   * Un pensamiento de la IA. Seguro de llamar en cada tick de simulación: por dentro
   * solo actúa cada `INTERVALO_IA` ticks.
   */
  paso(dt: number): void {
    this.segundosTranscurridos += dt;

    const mundo = this.mundo;
    if (mundo.tick % INTERVALO_IA !== 0) return;

    const estado = mundo.estadoDe(this.bando);
    if (estado.derrotado) return;

    this.exploracion.paso(mundo, this.bando);
    this.economia.paso(mundo, this.bando, this.faseActual);
    this.produccion.paso(mundo, this.bando, this.faseActual);
    this.actualizarFase(estado);
    this.combate.paso(mundo, this.bando, this.faseActual);
  }

  /** Da de baja las suscripciones al bus. Solo hace falta en pruebas que crean muchas IA. */
  destruir(): void {
    this.combate.destruir();
  }

  private actualizarFase(estado: EstadoBando): void {
    switch (this.faseActual) {
      case FaseIA.ARRANQUE:
        if (this.segundosTranscurridos >= TIEMPO_MIN_ARRANQUE) {
          this.faseActual = FaseIA.CRECIMIENTO;
        }
        break;

      case FaseIA.CRECIMIENTO: {
        const tieneBarracon = estado.edificiosDisponibles.has(TipoEdificio.BARRACON);
        if (
          (tieneBarracon && estado.poblacion >= POBLACION_MINIMA_MILICIA) ||
          this.segundosTranscurridos >= TIEMPO_MAX_CRECIMIENTO
        ) {
          this.faseActual = FaseIA.MILICIA;
        }
        break;
      }

      case FaseIA.MILICIA:
        if (this.combate.tamanoMiliciaLibre >= MILICIA_PARA_ASALTO) {
          this.faseActual = FaseIA.ASALTO;
        }
        break;

      case FaseIA.ASALTO:
        if (this.combate.tamanoMiliciaLibre < MILICIA_MINIMA_EN_ASALTO) {
          this.faseActual = FaseIA.MILICIA;
        }
        break;
    }
  }
}
