import { Arma, type BandoCampana } from '../campana/tipos';
import { Batalla, FICHA, Postura } from './batalla';

/**
 * El mando de la máquina en el campo de batalla.
 *
 * Hasta ahora sus tropas se batían solas: buscaban enemigo y disparaban con
 * buen criterio, pero nadie las dirigía. Quien jugaba tenía tres botones para
 * adelantar la infantería, replegar los cañones y elegir el momento de la carga,
 * y enfrente no había nadie tomando ninguna de esas decisiones. La ventaja no
 * era de quien jugaba mejor: era de quien tenía mando.
 *
 * Esta clase no toca la simulación por dentro. Usa exactamente los mismos verbos
 * que los botones —`fijarPosturaDe` y `lanzarCarga`— y por la misma puerta. Es
 * deliberado: si la máquina pudiera hacer algo que la persona no puede, dejaría
 * de ser un rival para pasar a ser un tramposo, y además cualquier cambio de
 * reglas dejaría de afectarles a los dos por igual.
 *
 * ── De dónde salen las decisiones ────────────────────────────────────────────
 * No de una tabla de personalidades ni de un árbol de comportamiento: de los
 * números que ya rigen el combate. El triángulo dice que la caballería hace
 * ×1,6 a la artillería y ×0,7 a la infantería, así que la caballería espera a
 * que la infantería enemiga esté mermada y entonces va a por los cañones. La
 * artillería tiene alcance 21 y velocidad 1,5: batir de lejos es todo lo que
 * sabe hacer, así que se para en cuanto tiene blanco y se repliega si la
 * alcanzan. La infantería tiene alcance 16 y gana a la caballería: se planta a
 * distancia de fuego en vez de seguir caminando hacia una carga.
 *
 * ── Sin azar ─────────────────────────────────────────────────────────────────
 * No consume ni un número del generador de la batalla. Podría —lo tiene a mano—
 * pero entonces las pruebas de determinismo cambiarían de significado: dejarían
 * de comparar dos simulaciones idénticas para comparar dos simulaciones más las
 * tiradas de la máquina. Siendo puramente reactiva, la misma semilla sigue
 * dando la misma batalla y sus decisiones se pueden leer una a una.
 */

/**
 * Cada cuánto replantea la situación, en segundos.
 *
 * No es un ahorro de cálculo —son treinta unidades y cuatro cuentas—, es que un
 * mando que reevalúa treinta veces por segundo cambia de postura a mitad de
 * cada paso y las tropas salen temblando en el sitio. Tres cuartos de segundo
 * es más o menos lo que tarda una persona en mirar el campo y pulsar un botón.
 */
const RITMO = 0.75;

/**
 * A qué distancia la artillería se da por amenazada y se repliega.
 *
 * Bastante antes de tenerlos encima: con velocidad 1,5 contra los 7,2 de la
 * caballería, una batería que espera a verlos llegar ya no se salva. Retirarse
 * no la pone a salvo del todo —nada lo hace— pero le regala los segundos de
 * fuego que justifican tenerla.
 */
const DISTANCIA_AMENAZA = 11;

/** Con el enemigo más lejos que esto, una carga se gasta en el camino. */
const ALCANCE_DE_CARGA = 38;

/** Se considera que la infantería enemiga ya no protege sus cañones. */
const FRACCION_INFANTERIA_MERMADA = 0.5;

export class IABatalla {
  private readonly rival: BandoCampana;
  /** Infantería que tenía el enemigo al empezar: el listón de «mermada». */
  private readonly infanteriaInicialRival: number;
  private cuentaAtras = 0;

  constructor(
    private readonly batalla: Batalla,
    private readonly bando: BandoCampana,
  ) {
    this.rival = bando === batalla.atacante ? batalla.defensor : batalla.atacante;
    this.infanteriaInicialRival = batalla.contarPorArma(this.rival)[Arma.INFANTERIA];
    // La primera decisión se toma en el primer tick, no a los tres cuartos de
    // segundo: si no, el despliegue inicial arranca siempre con la postura por
    // defecto y la artillería da un paso al frente que nunca quiso dar.
    this.decidir();
  }

  actualizar(dt: number): void {
    if (this.batalla.terminada) return;
    this.cuentaAtras -= dt;
    if (this.cuentaAtras > 0) return;
    this.cuentaAtras = RITMO;
    this.decidir();
  }

  private decidir(): void {
    const mias = this.batalla.vivasDe(this.bando);
    const suyas = this.batalla.vivasDe(this.rival);
    if (mias.length === 0 || suyas.length === 0) return;

    this.mandarArtilleria(mias, suyas);
    this.mandarInfanteria(mias, suyas);
    this.mandarCaballeria(mias, suyas);
  }

  /**
   * Los cañones: batir de lejos mientras se pueda y salir corriendo cuando no.
   *
   * Con alcance 21 y velocidad 1,5, avanzar es casi siempre un error —cada paso
   * adelante es un segundo de fuego menos y un segundo más cerca de la
   * caballería—, así que solo se mueven cuando no llegan a nada.
   */
  private mandarArtilleria(mias: Unidades, suyas: Unidades): void {
    const propias = mias.filter((u) => u.arma === Arma.ARTILLERIA);
    if (propias.length === 0) return;

    const amenaza = distanciaMinima(propias, suyas);
    if (amenaza < DISTANCIA_AMENAZA) {
      this.batalla.fijarPosturaDe(this.bando, Arma.ARTILLERIA, Postura.RETIRAR);
      return;
    }
    // Dentro de alcance se planta: disparar no exige estar quieto, pero avanzar
    // sí acorta la distancia que la mantiene viva.
    const postura =
      amenaza <= FICHA[Arma.ARTILLERIA].alcance ? Postura.MANTENER : Postura.AVANZAR;
    this.batalla.fijarPosturaDe(this.bando, Arma.ARTILLERIA, postura);
  }

  /**
   * La infantería: acercarse hasta tener tiro y ahí quedarse.
   *
   * Es la única arma que gana a la caballería (×1,5), y lo hace disparando, no
   * caminando. Seguir avanzando después de tener blanco solo sirve para llegar
   * al cuerpo a cuerpo, que es donde ese ×1,5 deja de contar.
   */
  private mandarInfanteria(mias: Unidades, suyas: Unidades): void {
    const propias = mias.filter((u) => u.arma === Arma.INFANTERIA);
    if (propias.length === 0) return;

    const distancia = distanciaMinima(propias, suyas);
    const postura =
      distancia <= FICHA[Arma.INFANTERIA].alcance ? Postura.MANTENER : Postura.AVANZAR;
    this.batalla.fijarPosturaDe(this.bando, Arma.INFANTERIA, postura);
  }

  /**
   * La caballería: esperar y elegir el momento.
   *
   * Es la decisión que más se parece a jugar. Lanzada de frente contra
   * infantería fresca se deshace (×0,7 a favor de ella, ×1,5 en contra); lanzada
   * sobre los cañones cuando ya nadie los cubre, decide la batalla (×1,6). Así
   * que se queda atrás —fuera del alcance de los fusiles— hasta que se cumple
   * una de las dos condiciones que hacen buena la carga.
   */
  private mandarCaballeria(mias: Unidades, suyas: Unidades): void {
    const propias = mias.filter((u) => u.arma === Arma.CABALLERIA);
    if (propias.length === 0) return;

    const distancia = distanciaMinima(propias, suyas);
    const infanteriaRival = suyas.filter((u) => u.arma === Arma.INFANTERIA).length;
    const artilleriaRival = suyas.filter((u) => u.arma === Arma.ARTILLERIA).length;

    const infanteriaMermada =
      infanteriaRival <= this.infanteriaInicialRival * FRACCION_INFANTERIA_MERMADA;
    // Cañones sin escolta: el blanco para el que existe la caballería.
    const canonesDescubiertos = artilleriaRival > 0 && infanteriaRival === 0;
    // Sin nadie más de mi lado no hay nada que reservar: o cargan o miran.
    const ultimaBaza = propias.length === mias.length;

    const mereceLaPena =
      distancia <= ALCANCE_DE_CARGA &&
      (infanteriaMermada || canonesDescubiertos || ultimaBaza);

    if (mereceLaPena) {
      // Si la embestida ya está en marcha esto no hace nada, y si se agotó deja
      // a la caballería avanzando, que es lo que toca una vez comprometida.
      this.batalla.lanzarCarga(this.bando);
      this.batalla.fijarPosturaDe(this.bando, Arma.CABALLERIA, Postura.AVANZAR);
      return;
    }

    // Aún no toca: se mantiene fuera del alcance de los fusiles enemigos.
    const aTiroDeFusil = distancia <= FICHA[Arma.INFANTERIA].alcance && infanteriaRival > 0;
    this.batalla.fijarPosturaDe(
      this.bando,
      Arma.CABALLERIA,
      aTiroDeFusil ? Postura.RETIRAR : Postura.MANTENER,
    );
  }
}

type Unidades = ReturnType<Batalla['vivasDe']>;

/** La distancia más corta entre dos grupos. Es la que marca todas las decisiones. */
function distanciaMinima(unas: Unidades, otras: Unidades): number {
  let minima = Infinity;
  for (const una of unas) {
    for (const otra of otras) {
      const distancia = Math.hypot(otra.x - una.x, otra.z - una.z);
      if (distancia < minima) minima = distancia;
    }
  }
  return minima;
}
