import { BusEventos, bus as busGlobal, type MapaEventos } from '../core/events';
import { distanciaCuadrada } from '../core/math';
import { HERCIOS_SIMULACION } from '../sim/constantes';
import { Mundo } from '../sim/mundo';
import { esObrero, ordenarAtacarMover } from '../sim/ordenes';
import { Bando, Clase, type Entidad, Orden, TipoEdificio, indiceDe } from '../sim/tipos';
import { buscarPuntoInexplorado } from './exploracion';
import { FaseIA } from './fases';

/**
 * Combate de la IA.
 *
 * Agrupa la milicia libre (tropa viva, sin orden de ataque, sea cual sea su otra
 * ocupación), decide si ya hay masa crítica para salir a pelear y atiende primero la
 * defensa de la propia base cuando algo suyo ha recibido un golpe hace poco.
 *
 * Todo lo que sabe del enemigo pasa por la niebla del propio bando: una unidad
 * enemiga solo cuenta como objetivo si está `esVisible` ahora mismo (se mueve, no se
 * puede fiar de un recuerdo), un edificio basta con que su casilla esté al menos
 * `esExplorado` (no se mueve, lo visto una vez sigue siendo cierto). Sin esas dos
 * comprobaciones la IA estaría jugando con las cartas del humano boca arriba.
 */

// --- Ajustes propios del módulo (no existían en constantes.ts) ---

/** Milicia libre mínima para plantearse atacar, según la fase. `Infinity` = nunca. */
// 8 unidades libres antes de la primera salida es más ejército permanente que
// milicia de incursión, y en un mapa modesto tarda más de lo razonable en reunirse:
// cada unidad cuesta 500-900 de oro y compite además por población con la propia
// economía. 5 es la primera cifra que de verdad merece llamarse "masa crítica" sin
// convertir el primer ataque en un objetivo que solo llega tras una economía perfecta.
const MILICIA_MINIMA_ATAQUE: Readonly<Record<FaseIA, number>> = {
  [FaseIA.ARRANQUE]: Infinity,
  [FaseIA.CRECIMIENTO]: Infinity,
  [FaseIA.MILICIA]: 5,
  [FaseIA.ASALTO]: 4,
};

/** Segundos que un aviso de "me atacan" sigue siendo relevante para desviar tropas. */
const VENTANA_DEFENSA_SEGUNDOS = 12;

/** Radio en casillas dentro del cual la milicia libre se considera "cerca" del golpe. */
const RADIO_DEFENSA = 26;

export class CombateIA {
  private readonly bando: Bando;
  private readonly darDeBaja: () => void;

  /** Mundo de la última llamada a `paso`; lo necesita el oyente de daño, que no lo recibe. */
  private mundoActual: Mundo | null = null;

  private readonly grupoLibre: number[] = [];
  private tamanoMiliciaLibreCache = 0;

  private avisoDefensaX = 0;
  private avisoDefensaZ = 0;
  private avisoDefensaTick = -Infinity;

  private readonly cercanosDefensa: Entidad[] = [];
  private readonly entidadesAtaque: Entidad[] = [];

  constructor(bando: Bando, bus: BusEventos = busGlobal) {
    this.bando = bando;
    this.darDeBaja = bus.al('danio', (datos) => this.alRecibirDanio(datos));
  }

  /** Milicia libre contada en el último pensamiento. Lo usa `DirectorIA` para las fases. */
  get tamanoMiliciaLibre(): number {
    return this.tamanoMiliciaLibreCache;
  }

  /** Da de baja la suscripción al bus. Solo hace falta en pruebas que crean muchas IA. */
  destruir(): void {
    this.darDeBaja();
  }

  paso(mundo: Mundo, bando: Bando, fase: FaseIA): void {
    this.mundoActual = mundo;
    this.grupoLibre.length = 0;

    let ayuntamientoX = 0;
    let ayuntamientoZ = 0;
    let hayAyuntamiento = false;

    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      if (mundo.vida[i] <= 0) continue;
      if (mundo.bando[i] !== bando) continue;

      const clase = mundo.clase[i];
      if (clase === Clase.EDIFICIO) {
        if (
          !hayAyuntamiento &&
          mundo.tipo[i] === TipoEdificio.AYUNTAMIENTO &&
          mundo.progresoObra[i] >= 1
        ) {
          ayuntamientoX = mundo.x[i]!;
          ayuntamientoZ = mundo.z[i]!;
          hayAyuntamiento = true;
        }
        continue;
      }

      if (clase !== Clase.UNIDAD) continue;
      if (esObrero(mundo, i)) continue;
      if (mundo.danioMax[i] <= 0) continue;

      const orden = mundo.orden[i];
      if (orden === Orden.ATACAR || orden === Orden.ATACAR_MOVER) continue;
      this.grupoLibre.push(i);
    }

    this.tamanoMiliciaLibreCache = this.grupoLibre.length;
    if (this.grupoLibre.length === 0) return;

    const referenciaX = hayAyuntamiento ? ayuntamientoX : mundo.x[this.grupoLibre[0]!]!;
    const referenciaZ = hayAyuntamiento ? ayuntamientoZ : mundo.z[this.grupoLibre[0]!]!;

    // La defensa manda siempre sobre la ofensiva: no tiene sentido lanzar un ataque
    // con la casa ardiendo.
    if (this.intentarDefender(mundo, bando)) return;

    const umbral = MILICIA_MINIMA_ATAQUE[fase];
    if (this.grupoLibre.length < umbral) return;

    const objetivo = this.buscarObjetivo(mundo, bando, referenciaX, referenciaZ);
    if (objetivo) {
      this.lanzarAtaque(mundo, bando, objetivo.x, objetivo.z);
      return;
    }

    // Ni rastro del enemigo: mejor mandar la fuerza a explorar lo desconocido que
    // quedarse sentada, y mucho mejor que adivinar dónde está el jugador.
    const puntoCiego = buscarPuntoInexplorado(mundo, bando, referenciaX, referenciaZ);
    if (puntoCiego) this.lanzarAtaque(mundo, bando, puntoCiego.x, puntoCiego.z);
  }

  // --- Defensa ---

  private alRecibirDanio(datos: MapaEventos['danio']): void {
    const mundo = this.mundoActual;
    if (!mundo) return;
    if (!mundo.esValida(datos.objetivo)) return;
    const j = indiceDe(datos.objetivo);
    if (mundo.bando[j] !== this.bando) return;

    this.avisoDefensaX = datos.x;
    this.avisoDefensaZ = datos.z;
    this.avisoDefensaTick = mundo.tick;
  }

  private intentarDefender(mundo: Mundo, bando: Bando): boolean {
    if (mundo.tick - this.avisoDefensaTick > VENTANA_DEFENSA_SEGUNDOS * HERCIOS_SIMULACION) {
      return false;
    }

    this.cercanosDefensa.length = 0;
    const radioCuadrado = RADIO_DEFENSA * RADIO_DEFENSA;
    for (let k = 0; k < this.grupoLibre.length; k++) {
      const i = this.grupoLibre[k]!;
      const d = distanciaCuadrada(mundo.x[i]!, mundo.z[i]!, this.avisoDefensaX, this.avisoDefensaZ);
      if (d <= radioCuadrado) this.cercanosDefensa.push(mundo.entidadDeIndice(i));
    }
    if (this.cercanosDefensa.length === 0) return false;

    ordenarAtacarMover(mundo, this.cercanosDefensa, this.avisoDefensaX, this.avisoDefensaZ, bando);
    return true;
  }

  // --- Ofensiva ---

  private buscarObjetivo(
    mundo: Mundo,
    bando: Bando,
    referenciaX: number,
    referenciaZ: number,
  ): { x: number; z: number } | null {
    let mejor = 0;
    let mejorPuntuacion = Infinity;

    for (let j = 1; j <= mundo.indiceMaximo; j++) {
      if (mundo.activos[j] !== 1) continue;
      if (mundo.vida[j] <= 0) continue;
      if (!mundo.sonEnemigos(bando, mundo.bando[j])) continue;

      const clase = mundo.clase[j];
      if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) continue;

      const cx = mundo.casillaX[j]!;
      const cz = mundo.casillaZ[j]!;
      const conocido =
        clase === Clase.EDIFICIO
          ? mundo.mapa.esExplorado(bando, cx, cz)
          : mundo.mapa.esVisible(bando, cx, cz);
      if (!conocido) continue;

      const puntuacion = distanciaCuadrada(referenciaX, referenciaZ, mundo.x[j]!, mundo.z[j]!);
      if (puntuacion < mejorPuntuacion || (puntuacion === mejorPuntuacion && j < mejor)) {
        mejorPuntuacion = puntuacion;
        mejor = j;
      }
    }

    if (mejor === 0) return null;
    return { x: mundo.x[mejor]!, z: mundo.z[mejor]! };
  }

  private lanzarAtaque(mundo: Mundo, bando: Bando, x: number, z: number): void {
    this.entidadesAtaque.length = 0;
    for (let k = 0; k < this.grupoLibre.length; k++) {
      this.entidadesAtaque.push(mundo.entidadDeIndice(this.grupoLibre[k]!));
    }
    ordenarAtacarMover(mundo, this.entidadesAtaque, x, z, bando);
  }
}
