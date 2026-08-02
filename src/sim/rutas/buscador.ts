import { CADUCIDAD_RUTA, MAX_NODOS_ASTAR, MAX_RUTAS_POR_TICK, TAM_CASILLA } from '../constantes';
import type { MapaJuego } from '../mapa';
import type { Ruta } from '../tipos';
import { BuscadorAEstrella, holguraParaRadio, type ConsultaAEstrella } from './astar';
import { alcanzable, caminoPorCampo, CacheCamposFlujo } from './camposFlujo';
import type { BuscadorRutas, PeticionRuta, ResultadoRuta } from './contrato';
import { MonticuloBinario } from './monticulo';
import { suavizarCamino } from './suavizado';

/**
 * Implementación del `BuscadorRutas`: la pieza que ata el A*, los campos de flujo y
 * el suavizado, y los reparte entre los ticks sin reventar el presupuesto.
 *
 * Cómo funciona un tick:
 *
 *  1. Se cuentan las peticiones vivas por casilla de destino. Es la única pasada que
 *     recorre la cola entera, y solo suma enteros.
 *  2. Se sacan de la cola de prioridad hasta `maxRutasPorTick` peticiones. La cola es
 *     un montículo con orden total (prioridad, luego número de secuencia), así que el
 *     reparto no depende jamás del orden de iteración de un `Map`.
 *  3. Cada petición se resuelve con A* o, si hay muchas al mismo sitio, siguiendo un
 *     campo de flujo compartido que se calcula **una sola vez** y se cachea.
 *  4. El camino de casillas se suaviza y se deja en la bandeja de salida, de donde el
 *     sistema de movimiento lo retira con `recoger`.
 *
 * Deduplicación: una petición nueva de la misma entidad sustituye a la anterior. La
 * vieja no se busca en el montículo (sería O(n)); se marca y se descarta al extraerla
 * («borrado perezoso»), que es lo mismo que hace el A* con los duplicados.
 *
 * Basura por tick: cero en el camino caliente. Las peticiones salen de una reserva
 * reutilizada, la consulta al A* es un objeto fijo, los búferes de camino se reservan
 * una vez y `pendiente` / `imposible` son singletons. Lo único que se reserva de
 * verdad es el `Float32Array` de puntos de cada ruta nueva, que es propiedad de quien
 * la pidió y no se puede compartir.
 */

/** Peticiones al mismo destino a partir de las cuales compensa un campo de flujo. */
export const UMBRAL_CAMPO_FLUJO = 4;

/** Campos de flujo vivos a la vez. Cada uno cuesta 3 bytes por casilla. */
export const MAX_CAMPOS_CACHE = 6;

export interface OpcionesBuscador {
  /** Rutas resueltas por tick. Por omisión `MAX_RUTAS_POR_TICK`. */
  maxRutasPorTick?: number;
  /** Nodos por búsqueda A*. Por omisión `MAX_NODOS_ASTAR`. */
  maxNodos?: number;
  /** Peticiones al mismo destino que disparan el campo de flujo compartido. */
  umbralCampoFlujo?: number;
  /** Campos de flujo cacheados a la vez. */
  maxCamposCache?: number;
  /** Ticks tras los cuales un campo de flujo se considera rancio. */
  caducidadCampoTicks?: number;
}

export interface EstadisticasBuscador {
  /** Peticiones encoladas sin resolver. */
  pendientes: number;
  /** Rutas resueltas en el último `actualizar`. */
  calculadasEsteTick: number;
  /** Nodos expandidos por el A* en el último `actualizar`. */
  nodosExplorados: number;
  /** Nodos expandidos por la búsqueda más cara vista hasta ahora. */
  nodosPeorCaso: number;
  /** Búsquedas A* ejecutadas desde el arranque. */
  busquedasAEstrella: number;
  /** Peticiones servidas leyendo un campo de flujo. */
  serviciosPorCampo: number;
  /** Campos de flujo calculados (no reutilizados) desde el arranque. */
  camposCalculados: number;
  /** Peticiones resueltas como «no hay camino». */
  imposibles: number;
  /** Rutas listas esperando a que alguien las recoja. */
  enBandeja: number;
}

/** Petición viva dentro del buscador. Sale de una reserva y vuelve a ella. */
interface PeticionInterna {
  entidad: number;
  origenX: number;
  origenZ: number;
  destinoX: number;
  destinoZ: number;
  radio: number;
  tolerancia: number;
  prioridad: number;
  /** Orden de llegada. Desempata la cola y detecta las entradas rancias. */
  secuencia: number;
  /** Casilla de destino ya recortada al mapa: la clave de agrupación. */
  claveDestino: number;
}

// Los dos resultados sin carga son inmutables y se comparten: `recoger` se llama una
// vez por unidad y por tick mientras espera, y no debe generar basura.
const RESULTADO_PENDIENTE: ResultadoRuta = { estado: 'pendiente' };
const RESULTADO_IMPOSIBLE: ResultadoRuta = { estado: 'imposible' };

export class BuscadorRutasRejilla implements BuscadorRutas {
  readonly mapa: MapaJuego;

  private readonly aestrella: BuscadorAEstrella;
  private readonly campos: CacheCamposFlujo;

  private readonly maxRutasPorTick: number;
  private readonly maxNodos: number;
  private readonly umbralCampoFlujo: number;

  /** Cola de prioridad. Los nodos son números de secuencia, no entidades. */
  private readonly cola: MonticuloBinario;
  /** Secuencia -> petición. Es la que manda: si no está aquí, la entrada es rancia. */
  private readonly porSecuencia = new Map<number, PeticionInterna>();
  /** Entidad -> petición viva. Da la deduplicación en O(1). */
  private readonly porEntidad = new Map<number, PeticionInterna>();
  /** Bandeja de salida: rutas calculadas aún sin recoger. */
  private readonly bandeja = new Map<number, Ruta>();
  /** Entidades cuya última petición resultó irresoluble. */
  private readonly sinCamino = new Set<number>();
  /** Reserva de objetos petición. */
  private readonly reserva: PeticionInterna[] = [];
  /** Cuentas por casilla de destino, recalculadas cada tick sobre el mismo Map. */
  private readonly cuentaPorDestino = new Map<number, number>();

  /** Camino de casillas leído de un campo de flujo. Reutilizado. */
  private readonly caminoCampo: Int32Array;
  /** Consulta al A*, reutilizada para no crear un objeto por búsqueda. */
  private readonly consulta: ConsultaAEstrella = {
    origenCX: 0,
    origenCZ: 0,
    destinoCX: 0,
    destinoCZ: 0,
    toleranciaCasillas: 0,
    holgura: 0,
    maxNodos: MAX_NODOS_ASTAR,
  };

  private siguienteSecuencia = 1;

  // --- Contadores ---
  private calculadasEsteTick = 0;
  private nodosEsteTick = 0;
  private nodosPeorCaso = 0;
  private busquedasAEstrella = 0;
  private serviciosPorCampo = 0;
  private imposibles = 0;

  constructor(mapa: MapaJuego, opciones: OpcionesBuscador = {}) {
    this.mapa = mapa;
    this.aestrella = new BuscadorAEstrella(mapa);
    this.campos = new CacheCamposFlujo(mapa, {
      maxEntradas: opciones.maxCamposCache ?? MAX_CAMPOS_CACHE,
      caducidadTicks: opciones.caducidadCampoTicks ?? CADUCIDAD_RUTA,
    });
    this.maxRutasPorTick = Math.max(1, opciones.maxRutasPorTick ?? MAX_RUTAS_POR_TICK);
    this.maxNodos = Math.max(1, opciones.maxNodos ?? MAX_NODOS_ASTAR);
    this.umbralCampoFlujo = Math.max(2, opciones.umbralCampoFlujo ?? UMBRAL_CAMPO_FLUJO);
    this.consulta.maxNodos = this.maxNodos;
    this.cola = new MonticuloBinario(256);
    this.caminoCampo = new Int32Array(mapa.numCasillas);
  }

  // --- API del contrato ---

  pedir(peticion: PeticionRuta): void {
    const entidad = peticion.entidad;

    // Una unidad solo persigue un destino: lo anterior se tira, esté donde esté.
    const anterior = this.porEntidad.get(entidad);
    if (anterior !== undefined) {
      this.porSecuencia.delete(anterior.secuencia);
      this.porEntidad.delete(entidad);
      this.devolver(anterior);
    }
    this.bandeja.delete(entidad);
    this.sinCamino.delete(entidad);

    const p = this.tomar();
    p.entidad = entidad;
    p.origenX = peticion.origenX;
    p.origenZ = peticion.origenZ;
    p.destinoX = peticion.destinoX;
    p.destinoZ = peticion.destinoZ;
    p.radio = peticion.radio;
    p.tolerancia = peticion.tolerancia;
    p.prioridad = peticion.prioridad;
    p.secuencia = this.siguienteSecuencia++;
    p.claveDestino = this.claveDeDestino(peticion.destinoX, peticion.destinoZ);

    this.porSecuencia.set(p.secuencia, p);
    this.porEntidad.set(entidad, p);
    // Mayor prioridad primero; a igualdad, la que llegó antes. Orden total: la
    // secuencia es única, así que dos ticks idénticos reparten el trabajo igual.
    this.cola.insertar(p.secuencia, -p.prioridad, p.secuencia);
  }

  recoger(entidad: number): ResultadoRuta {
    const ruta = this.bandeja.get(entidad);
    if (ruta !== undefined) {
      this.bandeja.delete(entidad);
      return { estado: 'lista', ruta };
    }
    if (this.sinCamino.delete(entidad)) return RESULTADO_IMPOSIBLE;
    if (this.porEntidad.has(entidad)) return RESULTADO_PENDIENTE;
    // Nadie ha pedido nada (o ya se entregó): mejor cerrar que dejar esperando para
    // siempre a una unidad que cree tener una petición en vuelo.
    return RESULTADO_IMPOSIBLE;
  }

  cancelar(entidad: number): void {
    const p = this.porEntidad.get(entidad);
    if (p !== undefined) {
      this.porEntidad.delete(entidad);
      this.porSecuencia.delete(p.secuencia);
      this.devolver(p);
    }
    this.bandeja.delete(entidad);
    this.sinCamino.delete(entidad);
  }

  actualizar(tick: number): void {
    this.calculadasEsteTick = 0;
    this.nodosEsteTick = 0;
    if (this.porSecuencia.size === 0) {
      // Sin trabajo no se toca ni una estructura: el caso más frecuente con diferencia.
      if (!this.cola.vacio) this.cola.limpiar();
      return;
    }

    this.contarDestinos();

    let hechas = 0;
    while (hechas < this.maxRutasPorTick && !this.cola.vacio) {
      const secuencia = this.cola.extraerMinimo();
      const p = this.porSecuencia.get(secuencia);
      if (p === undefined) continue; // entrada rancia: sustituida o cancelada
      this.porSecuencia.delete(secuencia);
      this.porEntidad.delete(p.entidad);

      this.resolver(p, tick);
      this.devolver(p);
      hechas++;
    }

    this.calculadasEsteTick = hechas;
  }

  invalidarRegion(cx: number, cz: number, lado: number): void {
    // Un campo de flujo abarca el mapa entero: la caché decide cuáles sobreviven.
    this.campos.invalidarRegion(cx, cz, lado);
  }

  estadisticas(): EstadisticasBuscador {
    return {
      pendientes: this.porEntidad.size,
      calculadasEsteTick: this.calculadasEsteTick,
      nodosExplorados: this.nodosEsteTick,
      nodosPeorCaso: this.nodosPeorCaso,
      busquedasAEstrella: this.busquedasAEstrella,
      serviciosPorCampo: this.serviciosPorCampo,
      camposCalculados: this.campos.camposCalculados,
      imposibles: this.imposibles,
      enBandeja: this.bandeja.size,
    };
  }

  // --- Interior ---

  /** Casilla de destino recortada al mapa; es la clave con la que se agrupa. */
  private claveDeDestino(x: number, z: number): number {
    const mapa = this.mapa;
    let cx = mapa.aCasilla(x);
    let cz = mapa.aCasilla(z);
    if (cx < 0) cx = 0;
    else if (cx >= mapa.ancho) cx = mapa.ancho - 1;
    if (cz < 0) cz = 0;
    else if (cz >= mapa.alto) cz = mapa.alto - 1;
    return mapa.indice(cx, cz);
  }

  /**
   * Cuenta cuántas peticiones vivas van a cada casilla. Se recorre un `Map`, pero
   * solo para sumar: el resultado no depende del orden de iteración.
   */
  private contarDestinos(): void {
    const cuentas = this.cuentaPorDestino;
    cuentas.clear();
    for (const p of this.porSecuencia.values()) {
      cuentas.set(p.claveDestino, (cuentas.get(p.claveDestino) ?? 0) + 1);
    }
  }

  private resolver(p: PeticionInterna, tick: number): void {
    const holgura = holguraParaRadio(p.radio, TAM_CASILLA);

    // El campo de flujo ignora el radio de la unidad, así que solo sirve para las que
    // caben en una casilla. Para el resto, siempre A*.
    if (holgura === 0) {
      const cuenta = this.cuentaPorDestino.get(p.claveDestino) ?? 1;
      if (cuenta >= this.umbralCampoFlujo && this.resolverPorCampo(p, tick)) return;
    }

    this.resolverPorAEstrella(p, tick, holgura);
  }

  /**
   * Sirve la petición leyendo el campo de flujo del destino. Devuelve `false` si el
   * campo no se pudo calcular, para que el llamante recurra al A*.
   */
  private resolverPorCampo(p: PeticionInterna, tick: number): boolean {
    const mapa = this.mapa;
    const destinoCX = p.claveDestino % mapa.ancho;
    const destinoCZ = (p.claveDestino - destinoCX) / mapa.ancho;

    const campo = this.campos.obtener(destinoCX, destinoCZ, tick);
    if (campo === null) return false;

    let origenCX = mapa.aCasilla(p.origenX);
    let origenCZ = mapa.aCasilla(p.origenZ);
    if (!mapa.dentro(origenCX, origenCZ)) return false;
    if (!mapa.transitable(origenCX, origenCZ)) {
      const salida = mapa.casillaLibreMasCercana(origenCX, origenCZ);
      if (salida === null) return false;
      origenCX = salida[0];
      origenCZ = salida[1];
    }

    const indiceOrigen = mapa.indice(origenCX, origenCZ);
    if (!alcanzable(campo, indiceOrigen)) {
      // El campo es un Dijkstra completo con las mismas reglas de paso que el A*:
      // si desde aquí no se llega, no hay camino y no hace falta gastar un A*.
      this.marcarImposible(p.entidad);
      return true;
    }

    const longitud = caminoPorCampo(campo, mapa.ancho, indiceOrigen, this.caminoCampo);
    if (longitud <= 0) {
      this.marcarImposible(p.entidad);
      return true;
    }

    this.serviciosPorCampo++;
    this.entregar(p, this.caminoCampo, longitud, tick);
    return true;
  }

  private resolverPorAEstrella(p: PeticionInterna, tick: number, holgura: number): void {
    const mapa = this.mapa;
    const consulta = this.consulta;
    consulta.origenCX = mapa.aCasilla(p.origenX);
    consulta.origenCZ = mapa.aCasilla(p.origenZ);
    consulta.destinoCX = p.claveDestino % mapa.ancho;
    consulta.destinoCZ = (p.claveDestino - consulta.destinoCX) / mapa.ancho;
    consulta.toleranciaCasillas = p.tolerancia > 0 ? p.tolerancia / TAM_CASILLA : 0;
    consulta.holgura = holgura;
    consulta.maxNodos = this.maxNodos;

    const resultado = this.aestrella.buscar(consulta);
    this.busquedasAEstrella++;
    this.nodosEsteTick += resultado.nodosExplorados;
    if (resultado.nodosExplorados > this.nodosPeorCaso) {
      this.nodosPeorCaso = resultado.nodosExplorados;
    }

    if (resultado.estado === 'imposible' || resultado.longitud <= 0) {
      this.marcarImposible(p.entidad);
      return;
    }

    // Un camino parcial también se entrega: la unidad avanza y vuelve a pedir ruta
    // desde más cerca, que es infinitamente mejor que quedarse plantada.
    this.entregar(p, resultado.casillas, resultado.longitud, tick);
  }

  /** Suaviza el camino de casillas y lo deja en la bandeja de salida. */
  private entregar(
    p: PeticionInterna,
    casillas: Int32Array,
    longitud: number,
    tick: number,
  ): void {
    const puntos = suavizarCamino(
      this.mapa,
      casillas,
      longitud,
      p.origenX,
      p.origenZ,
      p.destinoX,
      p.destinoZ,
      p.radio,
      // El suavizado ya comprueba que la última casilla sea la del destino pedido;
      // si el camino se quedó corto, remata en el centro de casilla por su cuenta.
      true,
    );
    if (puntos.length === 0) {
      this.marcarImposible(p.entidad);
      return;
    }
    this.bandeja.set(p.entidad, { puntos, indice: 0, tickCalculo: tick });
  }

  private marcarImposible(entidad: number): void {
    this.imposibles++;
    this.sinCamino.add(entidad);
  }

  // --- Reserva de peticiones ---

  private tomar(): PeticionInterna {
    const reciclada = this.reserva.pop();
    if (reciclada !== undefined) return reciclada;
    return {
      entidad: 0,
      origenX: 0,
      origenZ: 0,
      destinoX: 0,
      destinoZ: 0,
      radio: 0,
      tolerancia: 0,
      prioridad: 0,
      secuencia: 0,
      claveDestino: 0,
    };
  }

  private devolver(p: PeticionInterna): void {
    if (this.reserva.length < 64) this.reserva.push(p);
  }
}

/** Atajo para montar el buscador sin acordarse del nombre de la clase. */
export function crearBuscadorRutas(
  mapa: MapaJuego,
  opciones: OpcionesBuscador = {},
): BuscadorRutasRejilla {
  return new BuscadorRutasRejilla(mapa, opciones);
}
