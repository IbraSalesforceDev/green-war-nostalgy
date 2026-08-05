import { Azar } from '../core/rng';
import { TERRITORIOS, capitalDe, territorio } from './territorios';
import {
  ARMAS,
  Arma,
  BANDOS_EN_GUERRA,
  BandoCampana,
  type Composicion,
  type Ejercito,
  FaseTurno,
  type IdTerritorio,
  type ResultadoBatalla,
  bandoRival,
  composicionVacia,
  copiarComposicion,
  totalTropas,
} from './tipos';

/**
 * El juego por turnos sobre el mapa.
 *
 * Esta clase es la autoridad de la campaña: sabe quién controla qué, cuánto dinero
 * hay, dónde está cada ejército y quién ha ganado. No sabe nada de Three.js, del
 * DOM ni de cómo se libran las batallas —solo que alguien se las resolverá y le
 * dirá quién ganó—, igual que `Simulacion` no sabe nada del render.
 *
 * ── El ciclo de un turno ──────────────────────────────────────────────────────
 *   RECAUDACION → MANIOBRA → BATALLAS → (turno del rival) → …
 *
 * `RECAUDACION` y `BATALLAS` las procesa la propia clase; en `MANIOBRA` se queda
 * esperando órdenes, vengan de la persona que juega o de la IA. Al terminar la
 * maniobra, los choques provocados se van resolviendo de uno en uno: quien
 * orqueste el juego saca el siguiente con `siguienteChoque()`, lo dirime como
 * quiera (una escena de acción, o `resolverChoqueAutomaticamente()`) y devuelve
 * el veredicto con `aplicarResultado()`.
 */

// --- Economía -------------------------------------------------------------------

/** Lo que cuesta cada arma, en monedas. */
export const COSTE_ARMA: Readonly<Record<Arma, number>> = {
  [Arma.INFANTERIA]: 6,
  [Arma.CABALLERIA]: 10,
  [Arma.ARTILLERIA]: 14,
};

/** Monedas con las que arranca cada bando: dos turnos de margen para maniobrar. */
export const TESORO_INICIAL = 30;

/** Tropas con las que empieza cada territorio de retaguardia y de frontera. */
const GUARNICION_FRONTERA: Composicion = [3, 1, 1];
const GUARNICION_RETAGUARDIA: Composicion = [2, 0, 0];

// --- Combate --------------------------------------------------------------------

/**
 * El triángulo del juego, en forma de tabla [ataca][defiende].
 *
 * La caballería arrolla a los cañones, que no pueden apuntar tan rápido; la
 * artillería destroza a la infantería antes de que llegue a tiro; y la infantería
 * en formación cerrada rechaza a la caballería. Ninguna arma gana sola: es lo que
 * obliga a mirar la composición del enemigo antes de atacar, y no solo el número.
 */
const VENTAJA: readonly (readonly number[])[] = [
  //                inf   cab   art
  /* infantería  */ [1.0, 1.5, 0.7],
  /* caballería  */ [0.7, 1.0, 1.6],
  /* artillería  */ [1.6, 0.6, 1.0],
];

/** Lo que aporta cada arma en bruto, antes de aplicar el triángulo. */
const PESO_ARMA: Readonly<Record<Arma, number>> = {
  [Arma.INFANTERIA]: 1,
  [Arma.CABALLERIA]: 1.3,
  [Arma.ARTILLERIA]: 1.6,
};

/** Un fuerte multiplica lo que vale su guarnición. Asaltarlo de frente sale caro. */
export const VENTAJA_FUERTE = 1.6;

/**
 * Fuerza efectiva de un ejército contra otro concreto.
 *
 * No es una propiedad del ejército sino de la pareja: los mismos mil jinetes valen
 * mucho contra una batería y poco contra un cuadro de infantería.
 */
export function fuerzaContra(propia: Composicion, ajena: Composicion): number {
  const tropasAjenas = totalTropas(ajena);
  let fuerza = 0;
  for (const arma of ARMAS) {
    const cuantos = propia[arma];
    if (cuantos === 0) continue;
    // La ventaja se pondera por la mezcla del rival: la caballería solo cobra su
    // bonificación contra artillería en la medida en que haya artillería enfrente.
    let factor = 1;
    if (tropasAjenas > 0) {
      factor = 0;
      for (const armaAjena of ARMAS) {
        factor += (VENTAJA[arma]![armaAjena]! * ajena[armaAjena]) / tropasAjenas;
      }
    }
    fuerza += cuantos * PESO_ARMA[arma] * factor;
  }
  return fuerza;
}

// --- Estructuras ------------------------------------------------------------------

/** Un choque a la espera de dirimirse. */
export interface Choque {
  /** Ejército que entra. */
  readonly idAtacante: number;
  readonly territorio: IdTerritorio;
  /** Cómo se dirime: a campo abierto o asaltando la fortificación. */
  readonly tipo: 'campal' | 'fuerte';
  readonly atacante: BandoCampana;
  readonly defensor: BandoCampana;
  readonly composicionAtacante: Composicion;
  readonly composicionDefensor: Composicion;
}

export interface OpcionesCampana {
  semilla?: number;
  /** Bando que lleva la persona que juega. */
  bandoJugador?: BandoCampana;
}

export class Campana {
  readonly azar: Azar;
  readonly bandoJugador: BandoCampana;

  turno = 1;
  bandoActivo: BandoCampana = BandoCampana.UNION;
  fase: FaseTurno = FaseTurno.MANIOBRA;
  ganador: BandoCampana = BandoCampana.NINGUNO;

  private readonly dueno = new Map<IdTerritorio, BandoCampana>();
  private readonly tesoro = new Map<BandoCampana, number>();
  private readonly ejercitos: Ejercito[] = [];
  private readonly choques: Choque[] = [];
  private siguienteId = 1;

  constructor(opciones: OpcionesCampana = {}) {
    this.azar = new Azar(opciones.semilla ?? 0x4e5320);
    this.bandoJugador = opciones.bandoJugador ?? BandoCampana.UNION;

    for (const bando of BANDOS_EN_GUERRA) this.tesoro.set(bando, TESORO_INICIAL);

    for (const t of TERRITORIOS) {
      this.dueno.set(t.id, t.duenoInicial);
      // Solo se guarnecen la capital y los territorios que tocan al enemigo. El
      // resto arranca vacío: da al primer avance algo de terreno que ganar sin
      // pelear, que es como empieza el original.
      const esFrontera = t.vecinos.some((v) => territorio(v).duenoInicial !== t.duenoInicial);
      const esCapital = t.capitalDe === t.duenoInicial;
      if (esFrontera || esCapital) {
        this.crearEjercito(t.duenoInicial, t.id, copiarComposicion(GUARNICION_FRONTERA));
      } else if (t.puerto) {
        this.crearEjercito(t.duenoInicial, t.id, copiarComposicion(GUARNICION_RETAGUARDIA));
      }
    }
  }

  // --- Consultas -------------------------------------------------------------

  duenoDe(id: IdTerritorio): BandoCampana {
    return this.dueno.get(id) ?? BandoCampana.NINGUNO;
  }

  monedasDe(bando: BandoCampana): number {
    return this.tesoro.get(bando) ?? 0;
  }

  /** Todos los ejércitos vivos. No se debe modificar desde fuera. */
  get todosLosEjercitos(): readonly Ejercito[] {
    return this.ejercitos;
  }

  ejercitoEn(id: IdTerritorio): Ejercito | undefined {
    return this.ejercitos.find((e) => e.territorio === id);
  }

  ejercitoPorId(id: number): Ejercito | undefined {
    return this.ejercitos.find((e) => e.id === id);
  }

  ejercitosDe(bando: BandoCampana): Ejercito[] {
    return this.ejercitos.filter((e) => e.bando === bando);
  }

  territoriosDe(bando: BandoCampana): IdTerritorio[] {
    return TERRITORIOS.filter((t) => this.duenoDe(t.id) === bando).map((t) => t.id);
  }

  /** Renta por turno de un bando: la suma de lo que rinden sus territorios. */
  rentaDe(bando: BandoCampana): number {
    return TERRITORIOS.filter((t) => this.duenoDe(t.id) === bando).reduce(
      (suma, t) => suma + t.renta,
      0,
    );
  }

  /** ¿Puede este ejército entrar ahí ahora mismo? */
  puedeMover(idEjercito: number, destino: IdTerritorio): boolean {
    if (this.fase !== FaseTurno.MANIOBRA) return false;
    const ejercito = this.ejercitoPorId(idEjercito);
    if (!ejercito) return false;
    if (ejercito.bando !== this.bandoActivo) return false;
    if (ejercito.haMovido) return false;
    if (totalTropas(ejercito.composicion) === 0) return false;
    return territorio(ejercito.territorio).vecinos.includes(destino);
  }

  /** Destinos legales de un ejército. Lo usan la interfaz y la IA. */
  destinosDe(idEjercito: number): IdTerritorio[] {
    const ejercito = this.ejercitoPorId(idEjercito);
    if (!ejercito) return [];
    return territorio(ejercito.territorio).vecinos.filter((v) => this.puedeMover(idEjercito, v));
  }

  // --- Turno -------------------------------------------------------------------

  /**
   * Cobra rentas y compra refuerzos para el bando de turno.
   *
   * Los refuerzos aparecen en un puerto propio —así es como llegan las tropas en
   * esta guerra— o, si no queda ninguno, en la capital. Perder todos los puertos
   * no deja a un bando sin refuerzos, solo los concentra en un punto previsible
   * que el rival puede vigilar.
   */
  recaudar(bando: BandoCampana = this.bandoActivo): void {
    this.tesoro.set(bando, this.monedasDe(bando) + this.rentaDe(bando));
    this.comprarRefuerzos(bando);
  }

  private comprarRefuerzos(bando: BandoCampana): void {
    const destino = this.puntoDeDesembarco(bando);
    if (!destino) return;

    const compra = composicionVacia();
    let gastado = 0;
    // Se compra de lo caro a lo barato mientras alcance: una batería vale más que
    // dos pelotones sueltos, y así el dinero sobrante nunca se queda sin usar.
    const porPrecio = [Arma.ARTILLERIA, Arma.CABALLERIA, Arma.INFANTERIA];
    let presupuesto = this.monedasDe(bando);
    for (const arma of porPrecio) {
      // De cada arma cara, como mucho una por turno: si no, un bando rico acabaría
      // fabricando ejércitos de pura artillería y el triángulo dejaría de importar.
      const tope = arma === Arma.INFANTERIA ? 99 : 1;
      while (compra[arma] < tope && presupuesto >= COSTE_ARMA[arma]) {
        compra[arma]++;
        presupuesto -= COSTE_ARMA[arma];
        gastado += COSTE_ARMA[arma];
      }
    }
    if (totalTropas(compra) === 0) return;

    this.tesoro.set(bando, this.monedasDe(bando) - gastado);
    const existente = this.ejercitoEn(destino);
    if (existente && existente.bando === bando) {
      for (const arma of ARMAS) existente.composicion[arma] += compra[arma];
    } else {
      this.crearEjercito(bando, destino, compra);
    }
  }

  private puntoDeDesembarco(bando: BandoCampana): IdTerritorio | null {
    const puertos = TERRITORIOS.filter((t) => t.puerto && this.duenoDe(t.id) === bando);
    if (puertos.length > 0) {
      // El puerto más alejado del frente: desembarcar tropas nuevas justo donde el
      // enemigo puede caerles encima el turno siguiente sería regalárselas.
      const rival = bandoRival(bando);
      let mejor = puertos[0]!;
      let mejorDistancia = -Infinity;
      for (const puerto of puertos) {
        const distancia = this.distanciaAlBando(puerto.id, rival);
        if (distancia > mejorDistancia) {
          mejorDistancia = distancia;
          mejor = puerto;
        }
      }
      return mejor.id;
    }
    const capital = capitalDe(bando);
    return this.duenoDe(capital.id) === bando ? capital.id : null;
  }

  /** Saltos hasta el territorio más cercano del bando dado. Infinito si no queda ninguno. */
  distanciaAlBando(desde: IdTerritorio, bando: BandoCampana): number {
    const visitados = new Set<IdTerritorio>([desde]);
    let frontera: IdTerritorio[] = [desde];
    let saltos = 0;
    while (frontera.length > 0) {
      if (frontera.some((id) => this.duenoDe(id) === bando)) return saltos;
      const siguiente: IdTerritorio[] = [];
      for (const id of frontera) {
        for (const vecino of territorio(id).vecinos) {
          if (visitados.has(vecino)) continue;
          visitados.add(vecino);
          siguiente.push(vecino);
        }
      }
      frontera = siguiente;
      saltos++;
    }
    return Infinity;
  }

  /**
   * Mueve un ejército. Devuelve el choque provocado, o `null` si el paso fue
   * pacífico (territorio propio, o enemigo pero sin quien lo defienda).
   */
  mover(idEjercito: number, destino: IdTerritorio): Choque | null {
    if (!this.puedeMover(idEjercito, destino)) return null;
    const ejercito = this.ejercitoPorId(idEjercito)!;
    const defensor = this.ejercitoEn(destino);

    // Territorio propio: se ocupa, y si ya había tropas propias se funden en una
    // sola ficha. Sin esto el mapa se llenaría de pilas de una unidad.
    if (!defensor || defensor.bando === ejercito.bando) {
      if (defensor && defensor.id !== ejercito.id) {
        for (const arma of ARMAS) defensor.composicion[arma] += ejercito.composicion[arma];
        defensor.haMovido = true;
        this.retirar(ejercito.id);
      } else {
        ejercito.territorio = destino;
        ejercito.haMovido = true;
      }
      if (this.duenoDe(destino) !== ejercito.bando) this.conquistar(destino, ejercito.bando);
      return null;
    }

    const enFuerte = territorio(destino).fuerte;
    const choque: Choque = {
      idAtacante: ejercito.id,
      territorio: destino,
      tipo: enFuerte ? 'fuerte' : 'campal',
      atacante: ejercito.bando,
      defensor: defensor.bando,
      composicionAtacante: copiarComposicion(ejercito.composicion),
      composicionDefensor: copiarComposicion(defensor.composicion),
    };
    ejercito.haMovido = true;
    this.choques.push(choque);
    return choque;
  }

  /** El siguiente choque por dirimir, o `null` si no queda ninguno. */
  siguienteChoque(): Choque | null {
    return this.choques[0] ?? null;
  }

  get hayChoquesPendientes(): boolean {
    return this.choques.length > 0;
  }

  /**
   * Dirime un choque sin escena de acción: el resultado que daría la batalla si
   * nadie la jugara. Lo usan la IA, las pruebas y —de momento— también el jugador,
   * hasta que la batalla campal tenga su propia escena.
   *
   * Las bajas no son proporcionales al resultado: quien gana de calle apenas
   * pierde gente, y una victoria ajustada deja a los dos ejércitos maltrechos. Es
   * lo que hace que valga la pena elegir bien las batallas en vez de atacar
   * siempre que se tenga un hombre más.
   */
  resolverChoqueAutomaticamente(choque: Choque): ResultadoBatalla {
    const bonificacion = choque.tipo === 'fuerte' ? VENTAJA_FUERTE : 1;
    const fuerzaAtacante = fuerzaContra(choque.composicionAtacante, choque.composicionDefensor);
    const fuerzaDefensor =
      fuerzaContra(choque.composicionDefensor, choque.composicionAtacante) * bonificacion;

    // Un empujón de azar acotado (±15 %) para que dos batallas idénticas no den
    // siempre lo mismo, sin llegar a que gane el débil por suerte.
    const suerte = 0.85 + this.azar.siguiente() * 0.3;
    const efectivaAtacante = fuerzaAtacante * suerte;

    const total = efectivaAtacante + fuerzaDefensor;
    const ventaja = total > 0 ? efectivaAtacante / total : 0.5;
    const venceAtacante = ventaja > 0.5;

    // El perdedor conserva una fracción tanto menor cuanto más claro fue el
    // resultado; el ganador pierde justo lo contrario.
    const holgura = Math.abs(ventaja - 0.5) * 2; // 0 = empate técnico, 1 = paseo
    const restoGanador = 0.45 + holgura * 0.5;
    const restoPerdedor = (1 - holgura) * 0.35;

    return {
      territorio: choque.territorio,
      atacante: choque.atacante,
      vencedor: venceAtacante ? choque.atacante : choque.defensor,
      supervivientesAtacante: this.diezmar(
        choque.composicionAtacante,
        venceAtacante ? restoGanador : restoPerdedor,
      ),
      supervivientesDefensor: this.diezmar(
        choque.composicionDefensor,
        venceAtacante ? restoPerdedor : restoGanador,
      ),
    };
  }

  /** Reduce una composición a una fracción, redondeando de forma estable. */
  private diezmar(composicion: Composicion, fraccion: number): Composicion {
    const resultado = composicionVacia();
    for (const arma of ARMAS) {
      resultado[arma] = Math.max(0, Math.round(composicion[arma] * fraccion));
    }
    return resultado;
  }

  /**
   * Aplica el veredicto de una batalla, venga de la resolución automática o de
   * una escena de acción jugada de verdad.
   */
  aplicarResultado(resultado: ResultadoBatalla): void {
    const indice = this.choques.findIndex((c) => c.territorio === resultado.territorio);
    const choque = indice >= 0 ? this.choques[indice]! : null;
    if (indice >= 0) this.choques.splice(indice, 1);

    const atacante = choque ? this.ejercitoPorId(choque.idAtacante) : undefined;
    const defensor = this.ejercitoEn(resultado.territorio);

    if (atacante) {
      atacante.composicion = copiarComposicion(resultado.supervivientesAtacante);
    }
    if (defensor) {
      defensor.composicion = copiarComposicion(resultado.supervivientesDefensor);
    }

    const atacanteVence = resultado.vencedor === resultado.atacante;
    if (atacanteVence) {
      if (defensor) this.retirar(defensor.id);
      if (atacante && totalTropas(atacante.composicion) > 0) {
        atacante.territorio = resultado.territorio;
        this.conquistar(resultado.territorio, resultado.atacante);
      } else if (atacante) {
        // Victoria pírrica: el territorio queda tomado pero sin nadie que lo ocupe.
        this.retirar(atacante.id);
        this.conquistar(resultado.territorio, resultado.atacante);
      }
    } else if (atacante) {
      // El ataque se deshace: los supervivientes se quedan donde salieron.
      if (totalTropas(atacante.composicion) === 0) this.retirar(atacante.id);
    }

    if (defensor && totalTropas(defensor.composicion) === 0) this.retirar(defensor.id);
    this.comprobarFinDePartida();
  }

  /**
   * Cierra la maniobra del bando activo y pasa el turno al rival. No debe llamarse
   * con choques pendientes: primero se dirimen las batallas.
   */
  terminarTurno(): void {
    if (this.fase === FaseTurno.FIN) return;
    if (this.hayChoquesPendientes) {
      this.fase = FaseTurno.BATALLAS;
      return;
    }

    if (this.comprobarFinDePartida()) return;

    this.bandoActivo = bandoRival(this.bandoActivo);
    if (this.bandoActivo === BandoCampana.UNION) this.turno++;

    for (const ejercito of this.ejercitos) {
      if (ejercito.bando === this.bandoActivo) ejercito.haMovido = false;
    }

    this.fase = FaseTurno.RECAUDACION;
    this.recaudar(this.bandoActivo);
    this.fase = FaseTurno.MANIOBRA;
  }

  // --- Interno ------------------------------------------------------------------

  private crearEjercito(
    bando: BandoCampana,
    donde: IdTerritorio,
    composicion: Composicion,
  ): Ejercito {
    const ejercito: Ejercito = {
      id: this.siguienteId++,
      bando,
      territorio: donde,
      composicion,
      haMovido: false,
    };
    this.ejercitos.push(ejercito);
    return ejercito;
  }

  private retirar(id: number): void {
    const indice = this.ejercitos.findIndex((e) => e.id === id);
    if (indice >= 0) this.ejercitos.splice(indice, 1);
  }

  private conquistar(id: IdTerritorio, bando: BandoCampana): void {
    this.dueno.set(id, bando);
    this.comprobarFinDePartida();
  }

  /**
   * Comprueba si alguien ha ganado. Devuelve si la partida está terminada —y no
   * solo por cortesía: sin ese booleano, quien llama tendría que volver a mirar
   * `this.fase`, y ahí TypeScript ya no sabe que este método ha podido cambiarla.
   */
  private comprobarFinDePartida(): boolean {
    if (this.fase === FaseTurno.FIN) return true;
    for (const bando of BANDOS_EN_GUERRA) {
      const rival = bandoRival(bando);
      const capital = capitalDe(rival);
      const sinCapital = this.duenoDe(capital.id) === bando;
      const sinTierra = this.territoriosDe(rival).length === 0;
      if (sinCapital || sinTierra) {
        this.ganador = bando;
        this.fase = FaseTurno.FIN;
        return true;
      }
    }
    return false;
  }
}
