import type { MapaJuego } from '../mapa';
import { MonticuloBinario } from './monticulo';

/**
 * Campos de flujo para movimiento de grupo.
 *
 * Cuando el jugador selecciona veinte unidades y hace clic en un punto, calcular
 * veinte A* es tirar el presupuesto: todas van al mismo sitio. Un campo de flujo
 * resuelve el problema una sola vez para todo el mapa —Dijkstra desde el destino
 * hacia atrás— y deja en cada casilla la dirección que hay que tomar. Consultarlo
 * después es un acceso a array por unidad.
 *
 * El coste se guarda en enteros (10 el paso ortogonal, 14 el diagonal ~ 10·√2) para
 * poder usar `Uint16Array`: un campo de un mapa de 96×96 ocupa 27 KB en vez de 55.
 *
 * Convive con el A* en vez de sustituirlo: el campo ignora el radio de la unidad y
 * traza el camino más corto global, así que para unidades sueltas —sobre todo las
 * grandes o las que van a un punto raro— sigue siendo mejor el A*.
 */

/** Coste que marca «inalcanzable». */
export const COSTE_INFINITO = 0xffff;

/** Dirección que marca «sin salida» (el propio destino o una casilla aislada). */
export const SIN_DIRECCION = 255;

const COSTE_ORTOGONAL = 10;
const COSTE_DIAGONAL = 14;

/** Mismo orden de vecinos que el A*: ortogonales primero, luego diagonales. */
export const FLUJO_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
export const FLUJO_DZ = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);

export interface CampoFlujo {
  /** Casilla destino del campo. */
  destinoCX: number;
  destinoCZ: number;
  indiceDestino: number;
  /** Coste entero desde cada casilla hasta el destino. `COSTE_INFINITO` si no llega. */
  coste: Uint16Array;
  /** Índice de vecino (0..7) al que hay que ir, o `SIN_DIRECCION`. */
  direccion: Uint8Array;
  /** Tick en que se calculó, para la caducidad. */
  tickCreacion: number;
  /** Último tick en que se usó, para la expulsión por desuso. */
  ultimoUso: number;
}

export interface OpcionesCache {
  /** Máximo de campos vivos a la vez. Cada uno cuesta 3 bytes por casilla. */
  maxEntradas?: number;
  /** Ticks tras los cuales un campo se considera rancio y se recalcula. */
  caducidadTicks?: number;
}

/**
 * Caché de campos de flujo indexada por casilla destino.
 *
 * La expulsión es determinista: se echa el campo con el `ultimoUso` más antiguo y,
 * a igualdad, el de menor índice de casilla destino. Nunca se depende del orden de
 * iteración de un `Map`.
 */
export class CacheCamposFlujo {
  private readonly mapa: MapaJuego;
  private readonly entradas = new Map<number, CampoFlujo>();
  private readonly maxEntradas: number;
  private readonly caducidadTicks: number;
  private readonly monticulo: MonticuloBinario;
  /** Campos expulsados cuyos arrays se reciclan. Evita reservar 27 KB por grupo. */
  private readonly reciclaje: CampoFlujo[] = [];

  /** Contadores para el panel de depuración. */
  aciertos = 0;
  fallos = 0;
  camposCalculados = 0;
  ultimasCasillasVisitadas = 0;

  constructor(mapa: MapaJuego, opciones: OpcionesCache = {}) {
    this.mapa = mapa;
    this.maxEntradas = Math.max(1, opciones.maxEntradas ?? 6);
    this.caducidadTicks = Math.max(1, opciones.caducidadTicks ?? 240);
    this.monticulo = new MonticuloBinario(Math.min(mapa.numCasillas, 8192));
  }

  get tamano(): number {
    return this.entradas.size;
  }

  /**
   * Devuelve el campo de flujo hacia esa casilla, calculándolo si hace falta.
   * `null` si el destino no es transitable ni siquiera tras redirigir.
   */
  obtener(destinoCX: number, destinoCZ: number, tick: number): CampoFlujo | null {
    const mapa = this.mapa;
    if (!mapa.dentro(destinoCX, destinoCZ)) return null;
    if (!mapa.transitable(destinoCX, destinoCZ)) {
      const libre = mapa.casillaLibreMasCercana(destinoCX, destinoCZ);
      if (libre === null) return null;
      destinoCX = libre[0];
      destinoCZ = libre[1];
    }

    const clave = mapa.indice(destinoCX, destinoCZ);
    const existente = this.entradas.get(clave);
    if (existente !== undefined) {
      if (tick - existente.tickCreacion < this.caducidadTicks) {
        existente.ultimoUso = tick;
        this.aciertos++;
        return existente;
      }
      // Rancio: se recicla en el sitio.
      this.entradas.delete(clave);
      this.reciclaje.push(existente);
    }

    this.fallos++;
    if (this.entradas.size >= this.maxEntradas) this.expulsarMasViejo();

    const campo = this.tomarCampo();
    this.calcular(campo, destinoCX, destinoCZ, tick);
    this.entradas.set(clave, campo);
    this.camposCalculados++;
    return campo;
  }

  /** Invalida todo. Un campo cubre el mapa entero: cualquier cambio lo estropea. */
  invalidarTodo(): void {
    for (const campo of this.entradas.values()) this.reciclaje.push(campo);
    this.entradas.clear();
  }

  /**
   * Invalida los campos afectados por un cambio de transitabilidad.
   *
   * Un campo de flujo abarca todo el mapa, así que en rigor cualquier bloqueo nuevo
   * lo puede invalidar: se tiran todos. Es brusco pero correcto, y construir un
   * edificio no es algo que pase treinta veces por segundo. Los parámetros se
   * conservan para poder afinarlo más adelante sin cambiar a los llamantes.
   */
  invalidarRegion(_cx: number, _cz: number, _lado: number): void {
    this.invalidarTodo();
  }

  private expulsarMasViejo(): void {
    let claveVictima = -1;
    let usoVictima = Infinity;
    for (const [clave, campo] of this.entradas) {
      if (campo.ultimoUso < usoVictima || (campo.ultimoUso === usoVictima && clave < claveVictima)) {
        usoVictima = campo.ultimoUso;
        claveVictima = clave;
      }
    }
    if (claveVictima < 0) return;
    const victima = this.entradas.get(claveVictima)!;
    this.entradas.delete(claveVictima);
    this.reciclaje.push(victima);
  }

  private tomarCampo(): CampoFlujo {
    const reciclado = this.reciclaje.pop();
    if (reciclado !== undefined) return reciclado;
    return {
      destinoCX: 0,
      destinoCZ: 0,
      indiceDestino: -1,
      coste: new Uint16Array(this.mapa.numCasillas),
      direccion: new Uint8Array(this.mapa.numCasillas),
      tickCreacion: 0,
      ultimoUso: 0,
    };
  }

  /**
   * Dijkstra desde el destino hacia atrás y, en el mismo recorrido, gradiente por
   * casilla. Respeta las mismas reglas que el A*: nada de cortar esquinas y nada de
   * subir escalones fuera de una rampa.
   */
  private calcular(campo: CampoFlujo, destinoCX: number, destinoCZ: number, tick: number): void {
    const mapa = this.mapa;
    const ancho = mapa.ancho;
    const alto = mapa.alto;
    const coste = campo.coste;
    const direccion = campo.direccion;

    coste.fill(COSTE_INFINITO);
    direccion.fill(SIN_DIRECCION);

    const indiceDestino = mapa.indice(destinoCX, destinoCZ);
    campo.destinoCX = destinoCX;
    campo.destinoCZ = destinoCZ;
    campo.indiceDestino = indiceDestino;
    campo.tickCreacion = tick;
    campo.ultimoUso = tick;

    const monticulo = this.monticulo;
    monticulo.limpiar();
    coste[indiceDestino] = 0;
    monticulo.insertar(indiceDestino, 0, 0);

    let visitadas = 0;

    while (!monticulo.vacio) {
      // Inserción perezosa: puede haber copias rancias del mismo nodo en la cola.
      const prioridad = monticulo.prioridadMinima();
      const actual = monticulo.extraerMinimo();
      if (prioridad > coste[actual]) continue;
      const cx = actual % ancho;
      const cz = (actual - cx) / ancho;
      const costeActual = coste[actual];
      visitadas++;

      for (let k = 0; k < 8; k++) {
        const nx = cx + FLUJO_DX[k];
        const nz = cz + FLUJO_DZ[k];
        if (nx < 0 || nz < 0 || nx >= ancho || nz >= alto) continue;

        const diagonal = k >= 4;
        // Se propaga «hacia atrás»: el paso real será del vecino hacia `actual`.
        if (!mapa.transitableEntre(nx, nz, cx, cz)) continue;
        if (diagonal) {
          if (!mapa.transitableEntre(nx, nz, cx, nz)) continue;
          if (!mapa.transitableEntre(nx, nz, nx, cz)) continue;
        }

        const vecino = nz * ancho + nx;
        const nuevo = costeActual + (diagonal ? COSTE_DIAGONAL : COSTE_ORTOGONAL);
        if (nuevo >= COSTE_INFINITO) continue;
        if (nuevo >= coste[vecino]) continue;

        coste[vecino] = nuevo;
        // La dirección desde el vecino hacia `actual` es la opuesta de k.
        direccion[vecino] = opuesta(k);
        monticulo.insertar(vecino, nuevo, nuevo);
      }
    }

    this.ultimasCasillasVisitadas = visitadas;
  }
}

/** Índice del vecino opuesto en las tablas FLUJO_DX / FLUJO_DZ. */
export function opuesta(k: number): number {
  // Ortogonales: 0<->2, 1<->3. Diagonales: 4<->6, 5<->7.
  return k < 4 ? (k + 2) % 4 : ((k - 4 + 2) % 4) + 4;
}

/** ¿Llega este campo desde esa casilla? */
export function alcanzable(campo: CampoFlujo, indice: number): boolean {
  return campo.coste[indice] < COSTE_INFINITO;
}

/**
 * Sigue el campo desde una casilla hasta el destino y escribe el camino de casillas
 * en `salida`. Devuelve el número de casillas escritas (0 si no hay camino).
 * `salida[0]` es siempre la casilla de partida, igual que en el A*.
 */
export function caminoPorCampo(
  campo: CampoFlujo,
  ancho: number,
  origen: number,
  salida: Int32Array,
): number {
  if (campo.coste[origen] >= COSTE_INFINITO) return 0;

  let n = 0;
  let actual = origen;
  const tope = salida.length;

  while (n < tope) {
    salida[n++] = actual;
    if (actual === campo.indiceDestino) return n;
    const k = campo.direccion[actual];
    if (k === SIN_DIRECCION) return n;
    const cx = actual % ancho;
    const cz = (actual - cx) / ancho;
    actual = (cz + FLUJO_DZ[k]) * ancho + (cx + FLUJO_DX[k]);
  }

  return n;
}
