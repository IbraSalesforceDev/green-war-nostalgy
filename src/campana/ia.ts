import { Campana, VENTAJA_FUERTE, fuerzaContra } from './campana';
import { capitalDe, territorio } from './territorios';
import {
  BandoCampana,
  type Composicion,
  type Ejercito,
  type IdTerritorio,
  bandoRival,
  totalTropas,
} from './tipos';

/**
 * La IA de la campaña: decide los movimientos de un bando en su fase de maniobra.
 *
 * No hace trampas. Ve el mapa entero —igual que la persona que juega, porque en
 * esta capa no hay niebla— pero está sujeta a las mismas reglas: un movimiento por
 * ejército y turno, solo a territorios con frontera común.
 *
 * ── Cómo decide ───────────────────────────────────────────────────────────────
 * No hay búsqueda en profundidad ni minimax. Para cada ejército que puede moverse
 * se puntúan sus destinos y se ejecuta el mejor, en orden: primero deciden los
 * ejércitos con más tropas, porque son los que pueden permitirse los ataques y
 * conviene que elijan objetivo antes de que los pequeños ocupen el hueco.
 *
 * Es deliberadamente sencillo. Un adversario que planifica cinco turnos por
 * delante no hace la partida más divertida, la hace frustrante; lo que sí la hace
 * divertida es que castigue los descuidos —una capital desguarnecida, un flanco
 * abierto— y que no se suicide atacando de frente un fuerte con la mitad de gente.
 */

/** Margen de superioridad que la IA exige antes de atacar. */
const MARGEN_ATAQUE = 1.15;

/** Tropas que la IA procura no bajar nunca en su capital. */
const GUARNICION_MINIMA_CAPITAL = 3;

interface Jugada {
  ejercito: Ejercito;
  destino: IdTerritorio;
  puntos: number;
}

export class IACampana {
  private readonly bando: BandoCampana;

  constructor(bando: BandoCampana) {
    this.bando = bando;
  }

  /**
   * Juega la fase de maniobra entera. Devuelve cuántos movimientos hizo, que es
   * lo que necesita quien orqueste el turno para saber si pasó algo.
   */
  jugarManiobra(campana: Campana): number {
    if (campana.bandoActivo !== this.bando) return 0;

    let movimientos = 0;
    // Se recalcula la lista en cada vuelta: un movimiento cambia el mapa y puede
    // convertir en mala una jugada que hace un instante parecía buena.
    for (let intento = 0; intento < 40; intento++) {
      const jugada = this.mejorJugada(campana);
      if (!jugada) break;
      const choque = campana.mover(jugada.ejercito.id, jugada.destino);
      movimientos++;
      // Si el movimiento provocó una batalla, la IA no la dirime: eso es cosa de
      // quien orqueste el turno, que puede querer mostrarla como escena jugable.
      if (choque) break;
    }
    return movimientos;
  }

  private mejorJugada(campana: Campana): Jugada | null {
    const disponibles = campana
      .ejercitosDe(this.bando)
      .filter((e) => !e.haMovido && totalTropas(e.composicion) > 0)
      // De mayor a menor: que los ejércitos con capacidad de atacar elijan primero.
      .sort((a, b) => totalTropas(b.composicion) - totalTropas(a.composicion));

    let mejor: Jugada | null = null;
    for (const ejercito of disponibles) {
      for (const destino of campana.destinosDe(ejercito.id)) {
        const puntos = this.puntuar(campana, ejercito, destino);
        if (puntos <= 0) continue;
        if (!mejor || puntos > mejor.puntos) mejor = { ejercito, destino, puntos };
      }
    }
    return mejor;
  }

  /**
   * Cuánto vale llevar este ejército a ese sitio. Cero o menos significa «no lo
   * hagas»: quedarse quieto siempre es una opción legítima.
   */
  private puntuar(campana: Campana, ejercito: Ejercito, destino: IdTerritorio): number {
    const rival = bandoRival(this.bando);
    const info = territorio(destino);
    const defensor = campana.ejercitoEn(destino);
    const esEnemigo = campana.duenoDe(destino) === rival;

    // Nunca desguarnecer la propia capital por debajo del mínimo. Lo que quedaría
    // allí si este ejército se marcha es, exactamente, lo que tengan los demás.
    const capitalPropia = capitalDe(this.bando);
    const salgoDeLaCapital =
      ejercito.territorio === capitalPropia.id && campana.duenoDe(capitalPropia.id) === this.bando;
    if (salgoDeLaCapital) {
      const seQuedan = campana
        .ejercitosDe(this.bando)
        .filter((e) => e.territorio === capitalPropia.id && e.id !== ejercito.id)
        .reduce((suma, e) => suma + totalTropas(e.composicion), 0);
      // Solo se permite dejarla floja para ir a por la capital enemiga, que gana
      // la partida en el acto: no hay turno siguiente que lamentar.
      if (seQuedan < GUARNICION_MINIMA_CAPITAL && info.capitalDe !== rival) return 0;
    }

    if (defensor && defensor.bando === rival) {
      return this.puntuarAtaque(ejercito, destino, defensor.composicion);
    }

    if (esEnemigo) {
      // Territorio enemigo sin defensa: se toma gratis. Es la mejor jugada que hay.
      let puntos = 60 + info.renta * 10;
      if (info.capitalDe === rival) puntos += 1000; // ganar la partida
      if (info.fuerte) puntos += 15;
      if (info.puerto) puntos += 10;
      return puntos;
    }

    return this.puntuarMovimientoPropio(campana, ejercito, destino);
  }

  private puntuarAtaque(
    ejercito: Ejercito,
    destino: IdTerritorio,
    defensa: Composicion,
  ): number {
    const info = territorio(destino);
    const rival = bandoRival(this.bando);

    const mia = fuerzaContra(ejercito.composicion, defensa);
    const suya = fuerzaContra(defensa, ejercito.composicion) * (info.fuerte ? VENTAJA_FUERTE : 1);
    if (suya <= 0) return 80 + info.renta * 10;

    const proporcion = mia / suya;
    // Tomar la capital enemiga gana la partida: se intenta aunque la cuenta salga
    // ajustada, porque no hay turno siguiente que lamentar.
    const exigencia = info.capitalDe === rival ? 1.0 : MARGEN_ATAQUE;
    if (proporcion < exigencia) return 0;

    let puntos = 30 + (proporcion - 1) * 40 + info.renta * 8;
    if (info.capitalDe === rival) puntos += 1000;
    if (info.puerto) puntos += 8;
    return puntos;
  }

  /** Mover dentro de casa: solo vale la pena para acudir al frente o apuntalarlo. */
  private puntuarMovimientoPropio(
    campana: Campana,
    ejercito: Ejercito,
    destino: IdTerritorio,
  ): number {
    const rival = bandoRival(this.bando);
    const distanciaActual = campana.distanciaAlBando(ejercito.territorio, rival);
    const distanciaDestino = campana.distanciaAlBando(destino, rival);

    // Acercarse al enemigo es el impulso de fondo: sin él, los ejércitos de
    // retaguardia se quedarían plantados toda la partida.
    let puntos = 0;
    if (distanciaDestino < distanciaActual) puntos += 20;
    else if (distanciaDestino > distanciaActual) return 0; // alejarse, nunca

    // Concentrarse: llevar tropas a un territorio propio de frontera que ya tenga
    // ejército suma fuerzas para el asalto del turno siguiente.
    const amigo = campana.ejercitoEn(destino);
    if (amigo && amigo.bando === this.bando) {
      const enFrontera = territorio(destino).vecinos.some((v) => campana.duenoDe(v) === rival);
      if (enFrontera) puntos += 15;
    }

    // Un territorio propio que linda con el enemigo y está vacío es un agujero por
    // donde entrarán: taparlo vale casi tanto como atacar.
    const info = territorio(destino);
    const amenazado = info.vecinos.some((v) => {
      const vecino = campana.ejercitoEn(v);
      return vecino !== undefined && vecino.bando === rival;
    });
    if (amenazado && !amigo) puntos += 25 + info.renta * 5;

    return puntos;
  }
}
