import { Azar } from '../core/rng';
import { distanciaCuadrada } from '../core/math';
import {
  LIMITE_POBLACION,
  MADERA_INICIAL,
  ORO_INICIAL,
  TAM_CELDA_ESPACIAL,
} from './constantes';
import { MapaJuego } from './mapa';
import {
  Bando,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  ElementoCola,
  EstadoBando,
  EstadoUnidad,
  MAX_ENTIDADES,
  NUM_BANDOS,
  Orden,
  Ruta,
  TipoArmadura,
  TipoDanio,
  componerEntidad,
  generacionDe,
  indiceDe,
} from './tipos';

/**
 * El mundo: todo el estado de la simulación en un solo objeto.
 *
 * Los datos están en arrays paralelos («estructura de arrays») en lugar de en un
 * array de objetos. La razón es de rendimiento puro: cuando el sistema de movimiento
 * recorre todas las unidades solo necesita posición y velocidad, y con este diseño
 * esos bytes van seguidos en memoria. Con objetos, cada unidad sería un salto a otra
 * región del montón y una línea de caché desperdiciada.
 *
 * Regla de oro para todos los sistemas: el mundo es el único dueño del estado. Nadie
 * guarda referencias a entidades entre ticks sin validarlas con `esValida()`.
 */
export class Mundo {
  readonly mapa: MapaJuego;
  readonly azar: Azar;

  /** Tick actual de la simulación. Lo avanza el orquestador, no los sistemas. */
  tick = 0;

  // --- Gestión de identidades ---
  private generaciones = new Uint16Array(MAX_ENTIDADES);
  private libres: number[] = [];
  private siguienteIndice = 1; // el índice 0 se reserva para ENTIDAD_NULA

  /** Índices ocupados actualmente. Recorrer esto es mucho mejor que ir de 0 a MAX. */
  readonly activos: Uint8Array = new Uint8Array(MAX_ENTIDADES);

  /** Índice más alto en uso; acota los bucles de los sistemas. */
  indiceMaximo = 0;

  // --- Datos comunes a toda entidad ---
  readonly clase = new Uint8Array(MAX_ENTIDADES);
  /** TipoUnidad, TipoEdificio o TipoYacimiento según la clase. */
  readonly tipo = new Uint8Array(MAX_ENTIDADES);
  readonly bando = new Uint8Array(MAX_ENTIDADES);

  readonly x = new Float32Array(MAX_ENTIDADES);
  readonly z = new Float32Array(MAX_ENTIDADES);
  /** Posición del tick anterior; el render interpola entre ambas. */
  readonly xPrevio = new Float32Array(MAX_ENTIDADES);
  readonly zPrevio = new Float32Array(MAX_ENTIDADES);

  readonly vx = new Float32Array(MAX_ENTIDADES);
  readonly vz = new Float32Array(MAX_ENTIDADES);

  readonly angulo = new Float32Array(MAX_ENTIDADES);
  readonly anguloPrevio = new Float32Array(MAX_ENTIDADES);

  readonly radio = new Float32Array(MAX_ENTIDADES);
  readonly vida = new Float32Array(MAX_ENTIDADES);
  readonly vidaMaxima = new Float32Array(MAX_ENTIDADES);
  readonly armadura = new Float32Array(MAX_ENTIDADES);
  readonly tipoArmadura = new Uint8Array(MAX_ENTIDADES);

  readonly estado = new Uint8Array(MAX_ENTIDADES);
  /** Segundos que lleva en el estado actual; lo usa el render para las animaciones. */
  readonly tiempoEstado = new Float32Array(MAX_ENTIDADES);

  // --- Órdenes ---
  readonly orden = new Uint8Array(MAX_ENTIDADES);
  readonly ordenX = new Float32Array(MAX_ENTIDADES);
  readonly ordenZ = new Float32Array(MAX_ENTIDADES);
  readonly ordenObjetivo = new Int32Array(MAX_ENTIDADES);
  /** Segunda mitad de una patrulla, o punto de guardia al que volver. */
  readonly anclaX = new Float32Array(MAX_ENTIDADES);
  readonly anclaZ = new Float32Array(MAX_ENTIDADES);

  // --- Combate ---
  readonly objetivoActual = new Int32Array(MAX_ENTIDADES);
  readonly enfriamientoAtaque = new Float32Array(MAX_ENTIDADES);
  readonly danioMin = new Float32Array(MAX_ENTIDADES);
  readonly danioMax = new Float32Array(MAX_ENTIDADES);
  readonly tipoDanio = new Uint8Array(MAX_ENTIDADES);
  readonly alcance = new Float32Array(MAX_ENTIDADES);
  readonly cadencia = new Float32Array(MAX_ENTIDADES);
  readonly vision = new Float32Array(MAX_ENTIDADES);

  // --- Movimiento ---
  readonly velocidad = new Float32Array(MAX_ENTIDADES);
  readonly velocidadGiro = new Float32Array(MAX_ENTIDADES);
  /** Segundos sin avanzar de forma apreciable; dispara el desatasco. */
  readonly tiempoAtascado = new Float32Array(MAX_ENTIDADES);

  // --- Recolección ---
  readonly cargaTipo = new Uint8Array(MAX_ENTIDADES);
  readonly cargaCantidad = new Float32Array(MAX_ENTIDADES);
  /** Progreso del ciclo de picar o talar, en segundos. */
  readonly progresoTrabajo = new Float32Array(MAX_ENTIDADES);
  /** Yacimiento al que el obrero vuelve tras entregar la carga. */
  readonly yacimientoMemorizado = new Int32Array(MAX_ENTIDADES);

  // --- Edificios y yacimientos ---
  /** Lado de la huella en casillas. */
  readonly huella = new Uint8Array(MAX_ENTIDADES);
  /** Casilla de origen (esquina) de la huella. */
  readonly casillaX = new Int16Array(MAX_ENTIDADES);
  readonly casillaZ = new Int16Array(MAX_ENTIDADES);
  /** Progreso de construcción en [0, 1]. Vale 1 en todo lo ya terminado. */
  readonly progresoObra = new Float32Array(MAX_ENTIDADES);
  /** Obreros trabajando ahora mismo en el andamio. */
  readonly obrerosEnObra = new Uint8Array(MAX_ENTIDADES);
  /** Reservas restantes de un yacimiento. */
  readonly reserva = new Float32Array(MAX_ENTIDADES);
  /** Obreros asignados a un yacimiento, para repartirlos y no amontonarlos. */
  readonly ocupacionYacimiento = new Uint8Array(MAX_ENTIDADES);

  /** Colas de producción, solo para los pocos edificios que producen. */
  readonly colas = new Map<number, ElementoCola[]>();
  /** Punto de reunión de un edificio productor. */
  readonly puntoReunion = new Map<number, { x: number; z: number }>();
  /** Rutas activas, solo para las unidades que se están moviendo. */
  readonly rutas = new Map<number, Ruta>();

  // --- Estado por bando ---
  readonly bandos: EstadoBando[] = [];

  // --- Particionado espacial ---
  private celdasAncho: number;
  private celdasAlto: number;
  private celdas: number[][];

  constructor(mapa: MapaJuego, semilla = 1337) {
    this.mapa = mapa;
    this.azar = new Azar(semilla);

    this.celdasAncho = Math.ceil(mapa.ancho / TAM_CELDA_ESPACIAL);
    this.celdasAlto = Math.ceil(mapa.alto / TAM_CELDA_ESPACIAL);
    this.celdas = Array.from({ length: this.celdasAncho * this.celdasAlto }, () => []);

    for (let b = 0; b < NUM_BANDOS; b++) {
      this.bandos.push({
        bando: b as Bando,
        oro: b === Bando.NEUTRAL ? 0 : ORO_INICIAL,
        madera: b === Bando.NEUTRAL ? 0 : MADERA_INICIAL,
        poblacion: 0,
        poblacionMaxima: 0,
        limitePoblacion: LIMITE_POBLACION,
        unidadesEntrenadas: 0,
        unidadesPerdidas: 0,
        bajasCausadas: 0,
        oroRecogido: 0,
        maderaRecogida: 0,
        edificiosConstruidos: 0,
        edificiosDisponibles: new Set(),
        derrotado: false,
        esIA: false,
      });
    }
  }

  // --- Ciclo de vida de las entidades ---

  /**
   * Reserva un identificador nuevo y limpia su fila en todos los arrays.
   * Los sistemas de alto nivel (fabrica.ts) rellenan los campos según la ficha.
   */
  crear(clase: Clase, bando: Bando, x: number, z: number): Entidad {
    let indice: number;
    if (this.libres.length > 0) {
      indice = this.libres.pop()!;
    } else {
      if (this.siguienteIndice >= MAX_ENTIDADES) {
        console.error('[mundo] Se ha agotado el espacio de entidades');
        return ENTIDAD_NULA;
      }
      indice = this.siguienteIndice++;
    }

    if (indice > this.indiceMaximo) this.indiceMaximo = indice;
    this.activos[indice] = 1;
    this.limpiarFila(indice);

    this.clase[indice] = clase;
    this.bando[indice] = bando;
    this.x[indice] = x;
    this.z[indice] = z;
    this.xPrevio[indice] = x;
    this.zPrevio[indice] = z;
    this.radio[indice] = 0.35;

    return componerEntidad(indice, this.generaciones[indice]);
  }

  /**
   * Retira una entidad. El índice vuelve a la lista de libres y la generación avanza,
   * de modo que cualquier referencia antigua a esa entidad deja de validar.
   */
  destruir(entidad: Entidad): void {
    const i = indiceDe(entidad);
    if (!this.esValida(entidad)) return;

    this.colas.delete(i);
    this.puntoReunion.delete(i);
    this.rutas.delete(i);

    this.activos[i] = 0;
    this.generaciones[i] = (this.generaciones[i] + 1) & 0xfff;
    this.libres.push(i);
  }

  /** Comprueba índice y generación. Todo sistema que guarde una entidad debe usarlo. */
  esValida(entidad: Entidad): boolean {
    if (entidad === ENTIDAD_NULA) return false;
    const i = indiceDe(entidad);
    if (i <= 0 || i >= MAX_ENTIDADES) return false;
    if (this.activos[i] !== 1) return false;
    return this.generaciones[i] === generacionDe(entidad);
  }

  /** Identificador completo (con generación) a partir de un índice crudo. */
  entidadDeIndice(indice: number): Entidad {
    if (this.activos[indice] !== 1) return ENTIDAD_NULA;
    return componerEntidad(indice, this.generaciones[indice]);
  }

  private limpiarFila(i: number): void {
    this.clase[i] = Clase.NINGUNA;
    this.tipo[i] = 0;
    this.bando[i] = Bando.NEUTRAL;
    this.vx[i] = 0;
    this.vz[i] = 0;
    this.angulo[i] = 0;
    this.anguloPrevio[i] = 0;
    this.radio[i] = 0;
    this.vida[i] = 1;
    this.vidaMaxima[i] = 1;
    this.armadura[i] = 0;
    this.tipoArmadura[i] = TipoArmadura.NINGUNA;
    this.estado[i] = EstadoUnidad.INACTIVO;
    this.tiempoEstado[i] = 0;
    this.orden[i] = Orden.NINGUNA;
    this.ordenX[i] = 0;
    this.ordenZ[i] = 0;
    this.ordenObjetivo[i] = 0;
    this.anclaX[i] = 0;
    this.anclaZ[i] = 0;
    this.objetivoActual[i] = 0;
    this.enfriamientoAtaque[i] = 0;
    this.danioMin[i] = 0;
    this.danioMax[i] = 0;
    this.tipoDanio[i] = TipoDanio.CORTANTE;
    this.alcance[i] = 0;
    this.cadencia[i] = 1;
    this.vision[i] = 0;
    this.velocidad[i] = 0;
    this.velocidadGiro[i] = 6;
    this.tiempoAtascado[i] = 0;
    this.cargaTipo[i] = 0;
    this.cargaCantidad[i] = 0;
    this.progresoTrabajo[i] = 0;
    this.yacimientoMemorizado[i] = 0;
    this.huella[i] = 0;
    this.casillaX[i] = 0;
    this.casillaZ[i] = 0;
    this.progresoObra[i] = 1;
    this.obrerosEnObra[i] = 0;
    this.reserva[i] = 0;
    this.ocupacionYacimiento[i] = 0;
  }

  /** Cambia de estado reiniciando el cronómetro, para que el render corte la animación. */
  cambiarEstado(indice: number, nuevo: EstadoUnidad): void {
    if (this.estado[indice] === nuevo) return;
    this.estado[indice] = nuevo;
    this.tiempoEstado[indice] = 0;
  }

  // --- Relaciones entre bandos ---

  sonEnemigos(bandoA: number, bandoB: number): boolean {
    if (bandoA === Bando.NEUTRAL || bandoB === Bando.NEUTRAL) return false;
    return bandoA !== bandoB;
  }

  /** ¿Es un blanco legítimo? Vivo, de otro bando y capaz de recibir daño. */
  esObjetivoValido(atacanteIndice: number, objetivo: Entidad): boolean {
    if (!this.esValida(objetivo)) return false;
    const j = indiceDe(objetivo);
    if (this.vida[j] <= 0) return false;
    const clase = this.clase[j];
    if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) return false;
    return this.sonEnemigos(this.bando[atacanteIndice], this.bando[j]);
  }

  // --- Particionado espacial ---

  private indiceCelda(x: number, z: number): number {
    const cx = Math.min(this.celdasAncho - 1, Math.max(0, Math.floor(x / TAM_CELDA_ESPACIAL)));
    const cz = Math.min(this.celdasAlto - 1, Math.max(0, Math.floor(z / TAM_CELDA_ESPACIAL)));
    return cz * this.celdasAncho + cx;
  }

  /**
   * Reconstruye la rejilla espacial. Se llama una vez por tick, antes de los sistemas
   * que hacen consultas de proximidad. Reconstruir entero es más rápido y mucho menos
   * propenso a errores que ir actualizando celdas conforme las unidades se mueven.
   */
  reconstruirEspacial(): void {
    for (let i = 0; i < this.celdas.length; i++) this.celdas[i]!.length = 0;
    for (let i = 1; i <= this.indiceMaximo; i++) {
      if (this.activos[i] !== 1) continue;
      const clase = this.clase[i];
      if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO && clase !== Clase.YACIMIENTO) {
        continue;
      }
      this.celdas[this.indiceCelda(this.x[i], this.z[i])]!.push(i);
    }
  }

  /**
   * Recorre los índices de entidades dentro de un radio.
   * Recibe una función en lugar de devolver un array: cero reservas de memoria por
   * llamada, y esto se llama cientos de veces por tick.
   */
  consultarRadio(x: number, z: number, radio: number, visitar: (indice: number) => void): void {
    const minCX = Math.max(0, Math.floor((x - radio) / TAM_CELDA_ESPACIAL));
    const maxCX = Math.min(this.celdasAncho - 1, Math.floor((x + radio) / TAM_CELDA_ESPACIAL));
    const minCZ = Math.max(0, Math.floor((z - radio) / TAM_CELDA_ESPACIAL));
    const maxCZ = Math.min(this.celdasAlto - 1, Math.floor((z + radio) / TAM_CELDA_ESPACIAL));
    const radioCuadrado = radio * radio;

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const celda = this.celdas[cz * this.celdasAncho + cx]!;
        for (let k = 0; k < celda.length; k++) {
          const i = celda[k]!;
          if (distanciaCuadrada(x, z, this.x[i], this.z[i]) <= radioCuadrado) visitar(i);
        }
      }
    }
  }

  /** Enemigo vivo más cercano dentro del radio, o 0 si no hay ninguno. */
  enemigoMasCercano(indiceOrigen: number, radio: number): number {
    let mejor = 0;
    let mejorDistancia = Infinity;
    const ox = this.x[indiceOrigen];
    const oz = this.z[indiceOrigen];
    const miBando = this.bando[indiceOrigen];

    this.consultarRadio(ox, oz, radio, (i) => {
      if (i === indiceOrigen) return;
      if (this.vida[i] <= 0) return;
      const clase = this.clase[i];
      if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) return;
      if (!this.sonEnemigos(miBando, this.bando[i])) return;
      const d = distanciaCuadrada(ox, oz, this.x[i], this.z[i]);
      if (d < mejorDistancia) {
        mejorDistancia = d;
        mejor = i;
      }
    });

    return mejor;
  }

  // --- Utilidades de posición ---

  /** Distancia entre los bordes de dos entidades, descontando sus radios. */
  distanciaEntreBordes(a: number, b: number): number {
    const d = Math.sqrt(distanciaCuadrada(this.x[a], this.z[a], this.x[b], this.z[b]));
    return Math.max(0, d - this.radio[a] - this.radio[b]);
  }

  /** Altura del suelo bajo una entidad. */
  alturaDe(indice: number): number {
    return this.mapa.alturaEnMundo(this.x[indice], this.z[indice]);
  }

  estadoDe(bando: Bando): EstadoBando {
    return this.bandos[bando]!;
  }

  /** Guarda la posición actual como «anterior». Se llama al inicio de cada tick. */
  archivarTransformaciones(): void {
    for (let i = 1; i <= this.indiceMaximo; i++) {
      if (this.activos[i] !== 1) continue;
      this.xPrevio[i] = this.x[i];
      this.zPrevio[i] = this.z[i];
      this.anguloPrevio[i] = this.angulo[i];
    }
  }

  /** Número de entidades vivas. Solo para depuración y telemetría. */
  contarActivas(): number {
    let n = 0;
    for (let i = 1; i <= this.indiceMaximo; i++) if (this.activos[i] === 1) n++;
    return n;
  }
}
