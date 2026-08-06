import { Azar } from '../core/rng';
import {
  ARMAS,
  Arma,
  BandoCampana,
  type Composicion,
  bandoRival,
  composicionVacia,
  totalTropas,
} from '../campana/tipos';

/**
 * La batalla campal: lo que ocurre cuando dos ejércitos se encuentran.
 *
 * Es una simulación propia, no la del RTS que había antes. La de aquel juego
 * arrastraba búsqueda de caminos, recolección, construcción y colas de
 * producción para un campo abierto donde no hace falta nada de eso: aquí las
 * tropas se ven desde el primer segundo, avanzan en línea recta y se pegan. Lo
 * único que se comparte es el generador determinista y el vocabulario de armas.
 *
 * ── Las tres armas, otra vez ─────────────────────────────────────────────────
 * El triángulo de la campaña se sostiene aquí, pero por motivos que se ven en
 * pantalla en vez de salir de una tabla:
 *
 *   · la CABALLERÍA es rapidísima y solo hiere de cerca: llega antes que nadie
 *     y arrolla a los cañones, que no pueden bajar el tubo a tiempo;
 *   · la ARTILLERÍA tira de lejísimos y recarga muy despacio: destroza a la
 *     infantería que avanza en formación, pero si la alcanzan está perdida;
 *   · la INFANTERÍA tira a media distancia y aguanta: es la que rechaza cargas.
 *
 * Nadie gana solo. Esa es la partida.
 *
 * ── Determinismo ─────────────────────────────────────────────────────────────
 * Todo el azar pasa por `Azar`, igual que en la campaña: la misma semilla y las
 * mismas órdenes dan la misma batalla, tick a tick.
 */

/** Ticks por segundo de la simulación de batalla. */
export const HERCIOS_BATALLA = 30;
export const PASO_BATALLA = 1 / HERCIOS_BATALLA;

/** Ancho y fondo del campo, en unidades de escena. */
export const ANCHO_CAMPO = 84;
export const FONDO_CAMPO = 46;

/**
 * Distancia mínima a la que puede quedar cualquier pareja de unidades, que es la
 * suma de los dos radios mayores. Ningún alcance puede bajar de aquí o quien lo
 * tenga jamás llegará a golpear: la separación lo mantendrá siempre demasiado
 * lejos de su presa.
 */
export const ALCANCE_CUERPO_MINIMO = 2.4;

const MITAD_ANCHO = ANCHO_CAMPO / 2 - 2;
const MITAD_FONDO = FONDO_CAMPO / 2 - 2;

/**
 * Tope de duración. Tres minutos era el número «razonable» sobre el papel y una
 * eternidad delante de la pantalla: una batalla que no se ha decidido en poco
 * más de un minuto ya no la va a decidir nadie.
 */
const SEGUNDOS_MAXIMOS = 75;

/**
 * Si en este tiempo no cae nadie, se acabó el atrincherarse: hasta el defensor
 * fortificado sale a buscar pelea.
 *
 * Sin esto la batalla podía quedarse en tablas eternas —un superviviente por
 * bando, cada uno en su punta del campo, el defensor esperando por diseño y el
 * atacante demasiado lento para llegar— y consumir el tope entero sin que
 * pasara nada. Un estancamiento no es una defensa: es un juego parado.
 */
const SEGUNDOS_SIN_BAJAS_PARA_ROMPER_TABLAS = 18;

export enum EstadoUnidad {
  AVANZANDO = 0,
  COMBATIENDO = 1,
  MURIENDO = 2,
  MUERTA = 3,
}

/** Lo que define a cada arma en el campo de batalla. */
export interface FichaArma {
  readonly vida: number;
  /** Unidades por segundo. */
  readonly velocidad: number;
  /** Distancia a la que puede herir. */
  readonly alcance: number;
  /** Segundos entre disparos. */
  readonly cadencia: number;
  readonly danio: number;
  /** Radio de la unidad, para separarse de las vecinas. */
  readonly radio: number;
  /** Dispara proyectil visible en vez de golpear de cerca. */
  readonly proyectil: boolean;
}

export const FICHA: Readonly<Record<Arma, FichaArma>> = {
  [Arma.INFANTERIA]: {
    vida: 100,
    velocidad: 3.4,
    alcance: 10,
    cadencia: 1.9,
    danio: 24,
    radio: 0.9,
    proyectil: true,
  },
  [Arma.CABALLERIA]: {
    // Rápida y dura, pero tiene que llegar hasta el enemigo para hacer daño.
    //
    // Ojo con el alcance: tiene que superar a la suma de los radios de las dos
    // unidades, porque la separación las mantiene justo a esa distancia. Con 1,8
    // frente a los 2,3 que suman un jinete y un cañón, la carga llegaba encima
    // del enemigo y se quedaba dando vueltas sin poder tocarlo —la caballería
    // perdía todos los combates y parecía un problema de equilibrio cuando era
    // geométrico—. `ALCANCE_CUERPO_MINIMO` deja constancia de ese suelo.
    vida: 140,
    velocidad: 7.2,
    alcance: 2.9,
    cadencia: 1.1,
    danio: 30,
    radio: 1.1,
    proyectil: false,
  },
  [Arma.ARTILLERIA]: {
    // Tira mucho más lejos que nadie, pero no tanto como para batir el campo
    // entero: con alcance 30 sobre 84 de frente, una carga de caballería comía
    // cinco segundos largos de fuego antes de llegar y no llegaba nunca. El
    // cañón tiene que ser temible, no invulnerable.
    vida: 85,
    velocidad: 1.5,
    alcance: 21,
    cadencia: 3.6,
    danio: 52,
    radio: 1.2,
    proyectil: true,
  },
};

/**
 * Multiplicador de daño [ataca][defiende]. Mismo triángulo que la campaña, con
 * los mismos números, para que lo que se ve en la batalla case con lo que
 * predice el mapa.
 */
const VENTAJA: readonly (readonly number[])[] = [
  //                inf   cab   art
  /* infantería  */ [1.0, 1.5, 0.7],
  /* caballería  */ [0.7, 1.0, 1.6],
  /* artillería  */ [1.6, 0.6, 1.0],
];

export interface UnidadBatalla {
  readonly id: number;
  readonly bando: BandoCampana;
  readonly arma: Arma;
  x: number;
  z: number;
  /** Hacia dónde mira, en radianes. Lo usa el render para orientar la figura. */
  angulo: number;
  vida: number;
  readonly vidaMaxima: number;
  estado: EstadoUnidad;
  /** Enemigo al que se dirige o dispara. 0 = ninguno. */
  objetivo: number;
  /** Segundos que faltan para poder volver a disparar. */
  recarga: number;
  /** Cuenta atrás de la animación de muerte antes de retirar el cuerpo. */
  agonia: number;
  /** Punto al que se le ha ordenado ir; si es null, busca enemigo por su cuenta. */
  destinoX: number | null;
  destinoZ: number | null;
}

/** Aviso de disparo para que el render dibuje el proyectil y el audio suene. */
export interface DisparoBatalla {
  readonly origenX: number;
  readonly origenZ: number;
  readonly destinoX: number;
  readonly destinoZ: number;
  readonly arma: Arma;
  readonly bando: BandoCampana;
}

export interface OpcionesBatalla {
  atacante: BandoCampana;
  composicionAtacante: Composicion;
  composicionDefensor: Composicion;
  /** El defensor pelea tras una fortificación: más resistente y no avanza. */
  enFuerte?: boolean;
  semilla?: number;
  /** Bando que lleva la persona que juega. */
  bandoJugador: BandoCampana;
}

/** Lo que se devuelve a la campaña cuando la batalla termina. */
export interface DesenlaceBatalla {
  vencedor: BandoCampana;
  supervivientesAtacante: Composicion;
  supervivientesDefensor: Composicion;
}

export class Batalla {
  readonly azar: Azar;
  readonly atacante: BandoCampana;
  readonly defensor: BandoCampana;
  readonly bandoJugador: BandoCampana;
  readonly enFuerte: boolean;

  readonly unidades: UnidadBatalla[] = [];
  /** Disparos de este tick. El render los consume y se vacían solos. */
  readonly disparos: DisparoBatalla[] = [];

  terminada = false;
  vencedor: BandoCampana = BandoCampana.NINGUNO;
  tiempo = 0;

  /** Momento de la última baja. Gobierna la ruptura de tablas. */
  private ultimaBaja = 0;

  /** Cuántos entraron de cada bando, para saber qué fracción sobrevive. */
  private readonly inicialAtacante: Composicion;
  private readonly inicialDefensor: Composicion;
  private siguienteId = 1;

  constructor(opciones: OpcionesBatalla) {
    this.azar = new Azar(opciones.semilla ?? 0xba7a11a);
    this.atacante = opciones.atacante;
    this.defensor = bandoRival(opciones.atacante);
    this.bandoJugador = opciones.bandoJugador;
    this.enFuerte = opciones.enFuerte ?? false;

    this.inicialAtacante = [...opciones.composicionAtacante] as Composicion;
    this.inicialDefensor = [...opciones.composicionDefensor] as Composicion;

    // El atacante entra por el oeste y el defensor aguarda al este. Que siempre
    // sea así importa: quien juega tiene que saber de un vistazo cuál es su lado.
    this.desplegar(this.atacante, opciones.composicionAtacante, -1);
    this.desplegar(this.defensor, opciones.composicionDefensor, 1);
  }

  /**
   * Coloca un ejército en su mitad del campo.
   *
   * La formación no es decorativa: la artillería se queda detrás porque alcanza
   * de sobra desde allí, la caballería sale por los flancos —que es de donde
   * sirve una carga— y la infantería aguanta el centro. Sale una línea de
   * batalla de manual sin que nadie tenga que ordenarla.
   */
  private desplegar(bando: BandoCampana, composicion: Composicion, lado: -1 | 1): void {
    const bordeX = lado * (ANCHO_CAMPO / 2 - 8);

    for (const arma of ARMAS) {
      const cuantos = composicion[arma];
      if (cuantos === 0) continue;

      // Cada arma tiene su profundidad dentro del despliegue.
      const retranqueo = arma === Arma.ARTILLERIA ? 9 : arma === Arma.INFANTERIA ? 0 : -3;
      const filas = Math.ceil(cuantos / 5);

      for (let i = 0; i < cuantos; i++) {
        const fila = Math.floor(i / 5);
        const enFila = i % 5;
        const anchoFila = Math.min(5, cuantos - fila * 5);

        let z = (enFila - (anchoFila - 1) / 2) * 3.4;
        // La caballería se abre hacia los flancos, alternando arriba y abajo.
        if (arma === Arma.CABALLERIA) {
          z += (i % 2 === 0 ? 1 : -1) * (FONDO_CAMPO / 2 - 7);
        }

        // Acotar aquí no es cosmético: el retranqueo de la artillería sumaba
        // sobre el borde y la sacaba fuera del tablero antes de empezar.
        const x = limitar(bordeX + lado * (retranqueo + fila * 3.2), -MITAD_ANCHO, MITAD_ANCHO);
        this.crear(bando, arma, x, limitar(z, -MITAD_FONDO, MITAD_FONDO), -lado);
        void filas;
      }
    }
  }

  private crear(bando: BandoCampana, arma: Arma, x: number, z: number, mirandoA: number): void {
    const ficha = FICHA[arma];
    // El defensor tras una fortificación aguanta bastante más.
    const bonificacion = this.enFuerte && bando === this.defensor ? 1.85 : 1;
    this.unidades.push({
      id: this.siguienteId++,
      bando,
      arma,
      x,
      z,
      angulo: mirandoA > 0 ? 0 : Math.PI,
      vida: ficha.vida * bonificacion,
      vidaMaxima: ficha.vida * bonificacion,
      estado: EstadoUnidad.AVANZANDO,
      objetivo: 0,
      recarga: this.azar.rango(0, ficha.cadencia),
      agonia: 0,
      destinoX: null,
      destinoZ: null,
    });
  }

  // --- Consultas ----------------------------------------------------------------

  /**
   * Las que siguen en pie. Una unidad en agonía ya no cuenta: no dispara, no
   * estorba y no debe sostener a su bando en la comprobación de final. El render
   * sí la necesita, y para eso recorre `unidades` directamente.
   */
  vivasDe(bando: BandoCampana): UnidadBatalla[] {
    return this.unidades.filter(
      (u) =>
        u.bando === bando &&
        u.estado !== EstadoUnidad.MUERTA &&
        u.estado !== EstadoUnidad.MURIENDO,
    );
  }

  unidadPorId(id: number): UnidadBatalla | undefined {
    return this.unidades.find((u) => u.id === id);
  }

  /** Cuántas quedan en pie de cada arma. */
  contarPorArma(bando: BandoCampana): Composicion {
    const cuenta = composicionVacia();
    for (const u of this.unidades) {
      if (u.bando !== bando) continue;
      if (u.estado === EstadoUnidad.MUERTA || u.estado === EstadoUnidad.MURIENDO) continue;
      cuenta[u.arma]++;
    }
    return cuenta;
  }

  // --- Órdenes -------------------------------------------------------------------

  /**
   * Manda a un grupo de unidades hacia un punto. Es toda la interacción que
   * necesita la batalla: se elige a quién y se señala dónde.
   */
  ordenarIr(ids: readonly number[], x: number, z: number): void {
    for (const id of ids) {
      const unidad = this.unidadPorId(id);
      if (!unidad || unidad.bando !== this.bandoJugador) continue;
      if (unidad.estado === EstadoUnidad.MUERTA || unidad.estado === EstadoUnidad.MURIENDO) continue;
      unidad.destinoX = x;
      unidad.destinoZ = z;
    }
  }

  /** Devuelve a las unidades a su comportamiento normal: buscar y batirse. */
  ordenarAtacarLibremente(ids: readonly number[]): void {
    for (const id of ids) {
      const unidad = this.unidadPorId(id);
      if (!unidad || unidad.bando !== this.bandoJugador) continue;
      unidad.destinoX = null;
      unidad.destinoZ = null;
    }
  }

  // --- Simulación -----------------------------------------------------------------

  paso(dt: number): void {
    if (this.terminada) return;
    this.tiempo += dt;
    this.disparos.length = 0;

    for (const unidad of this.unidades) {
      if (unidad.estado === EstadoUnidad.MUERTA) continue;
      if (unidad.estado === EstadoUnidad.MURIENDO) {
        unidad.agonia -= dt;
        if (unidad.agonia <= 0) unidad.estado = EstadoUnidad.MUERTA;
        continue;
      }

      unidad.recarga -= dt;
      this.elegirObjetivo(unidad);
      this.actuar(unidad, dt);
    }

    this.separar();
    this.comprobarFinal();
  }

  /**
   * Busca el enemigo más conveniente.
   *
   * No es «el más cercano» a secas: cada arma pondera la distancia con lo bien
   * que le viene esa presa. Así la caballería se va derecha a los cañones —que
   * es lo que hace una carga— en lugar de estrellarse contra el primer cuadro
   * de infantería que se cruce.
   */
  private elegirObjetivo(unidad: UnidadBatalla): void {
    const actual = this.unidadPorId(unidad.objetivo);
    // Solo se replantea si el objetivo ha caído: cambiar de presa cada tick
    // dejaría a todo el mundo girando sin llegar a pegar a nadie.
    if (actual && actual.estado !== EstadoUnidad.MUERTA && actual.estado !== EstadoUnidad.MURIENDO) {
      return;
    }

    let mejor = 0;
    let mejorCoste = Infinity;
    for (const otra of this.unidades) {
      if (otra.bando === unidad.bando) continue;
      if (otra.estado === EstadoUnidad.MUERTA || otra.estado === EstadoUnidad.MURIENDO) continue;
      const d = Math.hypot(otra.x - unidad.x, otra.z - unidad.z);
      const apetito = VENTAJA[unidad.arma]![otra.arma]!;
      const coste = d / apetito;
      if (coste < mejorCoste) {
        mejorCoste = coste;
        mejor = otra.id;
      }
    }
    unidad.objetivo = mejor;
  }

  private actuar(unidad: UnidadBatalla, dt: number): void {
    const ficha = FICHA[unidad.arma];

    // Una orden del jugador manda sobre el instinto, salvo que ya tenga a alguien
    // a tiro: nadie pasa de largo con el enemigo delante.
    const objetivo = this.unidadPorId(unidad.objetivo);
    const distancia = objetivo ? Math.hypot(objetivo.x - unidad.x, objetivo.z - unidad.z) : Infinity;

    if (objetivo && distancia <= ficha.alcance) {
      unidad.estado = EstadoUnidad.COMBATIENDO;
      unidad.angulo = Math.atan2(objetivo.z - unidad.z, objetivo.x - unidad.x);
      if (unidad.recarga <= 0) {
        this.disparar(unidad, objetivo);
        unidad.recarga = ficha.cadencia;
      }
      return;
    }

    // Un defensor atrincherado no sale a campo abierto: es toda su ventaja. Deja
    // de serlo cuando la batalla se ha detenido del todo y nadie cae: entonces
    // esperar ya no defiende nada, solo alarga la partida.
    const enTablas = this.tiempo - this.ultimaBaja > SEGUNDOS_SIN_BAJAS_PARA_ROMPER_TABLAS;
    if (this.enFuerte && unidad.bando === this.defensor && unidad.destinoX === null && !enTablas) {
      unidad.estado = EstadoUnidad.AVANZANDO;
      return;
    }

    const haciaX = unidad.destinoX ?? objetivo?.x ?? unidad.x;
    const haciaZ = unidad.destinoZ ?? objetivo?.z ?? unidad.z;
    const dx = haciaX - unidad.x;
    const dz = haciaZ - unidad.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.4) {
      // Llegó al punto ordenado: vuelve a buscar enemigos por su cuenta.
      if (unidad.destinoX !== null) {
        unidad.destinoX = null;
        unidad.destinoZ = null;
      }
      unidad.estado = EstadoUnidad.AVANZANDO;
      return;
    }

    unidad.estado = EstadoUnidad.AVANZANDO;
    unidad.angulo = Math.atan2(dz, dx);
    const avance = Math.min(dist, ficha.velocidad * dt);
    unidad.x += (dx / dist) * avance;
    unidad.z += (dz / dist) * avance;

    // El campo tiene bordes: nadie se sale del tablero.
    unidad.x = limitar(unidad.x, -MITAD_ANCHO, MITAD_ANCHO);
    unidad.z = limitar(unidad.z, -MITAD_FONDO, MITAD_FONDO);
  }

  private disparar(unidad: UnidadBatalla, objetivo: UnidadBatalla): void {
    const ficha = FICHA[unidad.arma];
    const multiplicador = VENTAJA[unidad.arma]![objetivo.arma]!;
    // ±20 % de dispersión: dos disparos iguales no hacen el mismo daño.
    const danio = ficha.danio * multiplicador * this.azar.rango(0.8, 1.2);

    objetivo.vida -= danio;
    this.disparos.push({
      origenX: unidad.x,
      origenZ: unidad.z,
      destinoX: objetivo.x,
      destinoZ: objetivo.z,
      arma: unidad.arma,
      bando: unidad.bando,
    });

    if (objetivo.vida <= 0) {
      objetivo.vida = 0;
      objetivo.estado = EstadoUnidad.MURIENDO;
      objetivo.agonia = 0.9;
      objetivo.objetivo = 0;
      this.ultimaBaja = this.tiempo;
    }
  }

  /**
   * Empuja a las unidades que se solapan.
   *
   * Sin esto, una compañía entera converge al mismo punto y acaba ocupando una
   * sola casilla: se ve como una unidad parpadeando, no como una tropa. Es una
   * separación simple de un solo paso, suficiente porque las unidades ya llegan
   * repartidas por el despliegue.
   */
  private separar(): void {
    for (let i = 0; i < this.unidades.length; i++) {
      const a = this.unidades[i]!;
      if (a.estado === EstadoUnidad.MUERTA || a.estado === EstadoUnidad.MURIENDO) continue;
      for (let j = i + 1; j < this.unidades.length; j++) {
        const b = this.unidades[j]!;
        if (b.estado === EstadoUnidad.MUERTA || b.estado === EstadoUnidad.MURIENDO) continue;

        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const minimo = FICHA[a.arma].radio + FICHA[b.arma].radio;
        const d2 = dx * dx + dz * dz;
        if (d2 >= minimo * minimo || d2 === 0) continue;

        const d = Math.sqrt(d2);
        const empuje = (minimo - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        a.x -= ux * empuje;
        a.z -= uz * empuje;
        b.x += ux * empuje;
        b.z += uz * empuje;
      }
    }
  }

  private comprobarFinal(): void {
    const vivasAtacante = this.vivasDe(this.atacante).length;
    const vivasDefensor = this.vivasDe(this.defensor).length;

    if (vivasAtacante === 0 || vivasDefensor === 0) {
      this.terminada = true;
      // Si caen los dos a la vez, el defensor conserva el terreno: quien ataca
      // tiene que ganar, no empatar.
      this.vencedor = vivasAtacante > 0 ? this.atacante : this.defensor;
      return;
    }

    if (this.tiempo >= SEGUNDOS_MAXIMOS) {
      this.terminada = true;
      // Al agotarse el tiempo gana quien conserve más fuerza; en tablas, el
      // defensor, por el mismo motivo de antes.
      this.vencedor = vivasAtacante > vivasDefensor ? this.atacante : this.defensor;
    }
  }

  /**
   * El parte de la batalla para la campaña.
   *
   * Los supervivientes no se cuentan por unidades en pie sino por la fracción
   * que queda de cada arma: en el mapa un «efectivo» representa mucha más gente
   * que la figura que se ha visto correr por el campo, y hay que devolver el
   * dato en la misma moneda en que se prestó.
   */
  desenlace(): DesenlaceBatalla {
    const proporcion = (bando: BandoCampana, inicial: Composicion): Composicion => {
      const enPie = this.contarPorArma(bando);
      const resultado = composicionVacia();
      for (const arma of ARMAS) {
        if (inicial[arma] === 0) continue;
        // `desplegar` crea una figura por efectivo, así que la cuenta es directa;
        // se deja explícito por si algún día se agrupan varios por figura.
        resultado[arma] = Math.min(inicial[arma], enPie[arma]);
      }
      return resultado;
    };

    return {
      vencedor: this.vencedor,
      supervivientesAtacante: proporcion(this.atacante, this.inicialAtacante),
      supervivientesDefensor: proporcion(this.defensor, this.inicialDefensor),
    };
  }

  /** Total de efectivos que entraron, para el marcador. */
  get totalInicial(): number {
    return totalTropas(this.inicialAtacante) + totalTropas(this.inicialDefensor);
  }
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}
