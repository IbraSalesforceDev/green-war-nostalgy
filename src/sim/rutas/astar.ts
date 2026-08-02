import { MAX_NODOS_ASTAR } from '../constantes';
import type { MapaJuego } from '../mapa';
import { MonticuloBinario } from './monticulo';

/**
 * A* sobre la rejilla del mapa, con movimiento en 8 direcciones.
 *
 * Decisiones que marcan la diferencia entre un RTS que se siente bien y uno roto:
 *
 *  - **Heurística octil.** Con movimiento diagonal, ni Manhattan (sobreestima, deja
 *    de ser admisible y produce rutas torcidas) ni euclídea (subestima y hace
 *    explorar de más) sirven. La octil mide exactamente el coste del camino libre.
 *
 *  - **Sin corte de esquinas.** Una diagonal solo se toma si las dos casillas
 *    ortogonales que la flanquean también son transitables. Sin esto las unidades
 *    se cuelan por las esquinas de los edificios y parece que atraviesan paredes.
 *
 *  - **Presupuesto duro de nodos.** Al agotarlo no se declara «imposible»: se
 *    devuelve el mejor camino parcial hacia el nodo más próximo a la meta. La unidad
 *    avanza algo y vuelve a pedir ruta más cerca, que es mucho mejor que quedarse
 *    quieta. Solo se declara imposible cuando la frontera se agota de verdad, es
 *    decir cuando la región alcanzable está completamente cerrada.
 *
 *  - **Cero basura por búsqueda.** Los arrays de coste, padre y estado se reservan
 *    una vez por mapa y se «limpian» incrementando un sello de generación.
 */

/** Coste de un paso diagonal. Constante exacta para que el coste sea reproducible. */
export const COSTE_DIAGONAL = Math.SQRT2;
export const COSTE_ORTOGONAL = 1;

/** Estado marcado en `estados` (solo válido si el sello coincide con la generación). */
const ABIERTO = 1;
const CERRADO = 2;

/**
 * Vecinos en orden fijo: primero las cuatro ortogonales, luego las cuatro
 * diagonales. El orden es parte del contrato de determinismo.
 */
const VECINO_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
const VECINO_DZ = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);

export type EstadoBusqueda = 'completo' | 'parcial' | 'imposible';

export interface ConsultaAEstrella {
  origenCX: number;
  origenCZ: number;
  destinoCX: number;
  destinoCZ: number;
  /**
   * Distancia en casillas a la que se da por buena la llegada. Un arquero con
   * alcance 5 no necesita pisar el objetivo.
   */
  toleranciaCasillas: number;
  /**
   * Casillas libres exigidas a cada lado del camino. 0 para unidades que caben en
   * una casilla (la inmensa mayoría); 1 para las de radio mayor que una casilla.
   */
  holgura: number;
  /** Tope de nodos expandidos. Por omisión, `MAX_NODOS_ASTAR`. */
  maxNodos?: number;
}

export interface ResultadoAEstrella {
  estado: EstadoBusqueda;
  /**
   * Índices de casilla del camino, del origen al final, en el búfer reutilizable
   * del buscador. Solo son válidos los `longitud` primeros y solo hasta la
   * siguiente llamada a `buscar`.
   */
  casillas: Int32Array;
  longitud: number;
  /** Nodos expandidos (extraídos de la cola). Para el panel de depuración. */
  nodosExplorados: number;
  /** Casilla final realmente alcanzada; con `parcial` no es la pedida. */
  casillaFinal: number;
}

export class BuscadorAEstrella {
  private readonly mapa: MapaJuego;

  // --- Estructuras reutilizadas entre búsquedas ---
  private readonly coste: Float64Array;
  private readonly padre: Int32Array;
  private readonly estados: Uint8Array;
  private readonly sello: Int32Array;
  private readonly monticulo: MonticuloBinario;
  private readonly buffer: Int32Array;
  private readonly bufferInverso: Int32Array;
  private generacion = 0;

  /** Objeto de resultado reutilizado: el llamante debe consumirlo antes de rebuscar. */
  private readonly resultado: ResultadoAEstrella;

  constructor(mapa: MapaJuego) {
    this.mapa = mapa;
    const n = mapa.numCasillas;
    this.coste = new Float64Array(n);
    this.padre = new Int32Array(n);
    this.estados = new Uint8Array(n);
    this.sello = new Int32Array(n);
    // El sello arranca en 0, así que la primera generación debe ser 1.
    this.monticulo = new MonticuloBinario(Math.min(n, 8192));
    this.buffer = new Int32Array(n);
    this.bufferInverso = new Int32Array(n);
    this.resultado = {
      estado: 'imposible',
      casillas: this.buffer,
      longitud: 0,
      nodosExplorados: 0,
      casillaFinal: -1,
    };
  }

  /** Heurística octil: el coste exacto en rejilla libre con 8 direcciones. */
  static heuristica(dx: number, dz: number): number {
    const ax = dx < 0 ? -dx : dx;
    const az = dz < 0 ? -dz : dz;
    const menor = ax < az ? ax : az;
    return ax + az + (COSTE_DIAGONAL - 2) * menor;
  }

  /** ¿Cabe aquí una unidad que exige `holgura` casillas libres a cada lado? */
  private libreConHolgura(cx: number, cz: number, holgura: number): boolean {
    if (!this.mapa.transitable(cx, cz)) return false;
    if (holgura <= 0) return true;
    for (let dz = -holgura; dz <= holgura; dz++) {
      for (let dx = -holgura; dx <= holgura; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (!this.mapa.transitable(cx + dx, cz + dz)) return false;
      }
    }
    return true;
  }

  /**
   * ¿Se puede dar el paso (cx,cz) -> (nx,nz)?
   * Para diagonales exige además que las dos ortogonales que la flanquean sean
   * transitables desde el origen: es la regla que impide el corte de esquinas.
   */
  private pasoValido(
    cx: number,
    cz: number,
    nx: number,
    nz: number,
    diagonal: boolean,
    holgura: number,
  ): boolean {
    if (!this.mapa.transitableEntre(cx, cz, nx, nz)) return false;
    if (!this.libreConHolgura(nx, nz, holgura)) return false;
    if (!diagonal) return true;
    // Prohibición de corte de esquinas, en ambos ejes.
    if (!this.mapa.transitableEntre(cx, cz, nx, cz)) return false;
    if (!this.mapa.transitableEntre(cx, cz, cx, nz)) return false;
    if (holgura > 0) {
      if (!this.libreConHolgura(nx, cz, holgura)) return false;
      if (!this.libreConHolgura(cx, nz, holgura)) return false;
    }
    return true;
  }

  /**
   * Ejecuta la búsqueda. Devuelve siempre el mismo objeto: cópialo o consúmelo
   * antes de volver a llamar.
   */
  buscar(consulta: ConsultaAEstrella): ResultadoAEstrella {
    const mapa = this.mapa;
    const res = this.resultado;
    res.longitud = 0;
    res.nodosExplorados = 0;
    res.casillaFinal = -1;
    res.estado = 'imposible';

    const holgura = consulta.holgura | 0;
    const maxNodos = consulta.maxNodos ?? MAX_NODOS_ASTAR;

    let origenCX = consulta.origenCX;
    let origenCZ = consulta.origenCZ;
    let destinoCX = consulta.destinoCX;
    let destinoCZ = consulta.destinoCZ;

    if (!mapa.dentro(origenCX, origenCZ)) return res;

    // Origen atascado dentro de un bloqueo (edificio recién puesto encima, empuje
    // de la evitación): se le busca la salida más próxima antes de empezar.
    if (!mapa.transitable(origenCX, origenCZ)) {
      const salida = mapa.casillaLibreMasCercana(origenCX, origenCZ);
      if (salida === null) return res;
      origenCX = salida[0];
      origenCZ = salida[1];
    }

    // Destino bloqueado: se redirige a la casilla libre más cercana.
    if (!mapa.dentro(destinoCX, destinoCZ) || !mapa.transitable(destinoCX, destinoCZ)) {
      const cxRecortado = destinoCX < 0 ? 0 : destinoCX >= mapa.ancho ? mapa.ancho - 1 : destinoCX;
      const czRecortado = destinoCZ < 0 ? 0 : destinoCZ >= mapa.alto ? mapa.alto - 1 : destinoCZ;
      const libre = mapa.casillaLibreMasCercana(cxRecortado, czRecortado);
      if (libre === null) return res;
      destinoCX = libre[0];
      destinoCZ = libre[1];
    }

    const indiceOrigen = mapa.indice(origenCX, origenCZ);
    const indiceDestino = mapa.indice(destinoCX, destinoCZ);

    // Caso trivial: ya estamos en la casilla meta.
    if (indiceOrigen === indiceDestino) {
      this.buffer[0] = indiceOrigen;
      res.longitud = 1;
      res.estado = 'completo';
      res.casillaFinal = indiceOrigen;
      return res;
    }

    const generacion = ++this.generacion;
    const coste = this.coste;
    const padre = this.padre;
    const estados = this.estados;
    const sello = this.sello;
    const monticulo = this.monticulo;
    monticulo.limpiar();

    const tolerancia = consulta.toleranciaCasillas > 0 ? consulta.toleranciaCasillas : 0;
    const toleranciaCuadrada = tolerancia * tolerancia;

    coste[indiceOrigen] = 0;
    padre[indiceOrigen] = -1;
    sello[indiceOrigen] = generacion;
    estados[indiceOrigen] = ABIERTO;

    const hOrigen = BuscadorAEstrella.heuristica(destinoCX - origenCX, destinoCZ - origenCZ);
    monticulo.insertar(indiceOrigen, hOrigen, hOrigen);

    let mejorNodo = indiceOrigen;
    let mejorH = hOrigen;
    let nodosExpandidos = 0;
    let nodoMeta = -1;

    const ancho = mapa.ancho;

    while (!monticulo.vacio) {
      const actual = monticulo.extraerMinimo();
      if (sello[actual] !== generacion) continue;
      if (estados[actual] === CERRADO) continue; // duplicado perezoso ya procesado
      estados[actual] = CERRADO;
      nodosExpandidos++;

      const cx = actual % ancho;
      const cz = (actual - cx) / ancho;

      const dxMeta = destinoCX - cx;
      const dzMeta = destinoCZ - cz;

      // ¿Hemos llegado? Con tolerancia, basta con acercarse lo suficiente.
      if (actual === indiceDestino) {
        nodoMeta = actual;
        break;
      }
      if (toleranciaCuadrada > 0 && dxMeta * dxMeta + dzMeta * dzMeta <= toleranciaCuadrada) {
        nodoMeta = actual;
        break;
      }

      const h = BuscadorAEstrella.heuristica(dxMeta, dzMeta);
      // Mejor candidato para el camino parcial. Desempate por índice de casilla.
      if (h < mejorH || (h === mejorH && actual < mejorNodo)) {
        mejorH = h;
        mejorNodo = actual;
      }

      if (nodosExpandidos >= maxNodos) break;

      const costeActual = coste[actual];

      for (let k = 0; k < 8; k++) {
        const nx = cx + VECINO_DX[k];
        const nz = cz + VECINO_DZ[k];
        if (nx < 0 || nz < 0 || nx >= ancho || nz >= mapa.alto) continue;

        const vecino = nz * ancho + nx;
        if (sello[vecino] === generacion && estados[vecino] === CERRADO) continue;

        const diagonal = k >= 4;
        if (!this.pasoValido(cx, cz, nx, nz, diagonal, holgura)) continue;

        const costeNuevo = costeActual + (diagonal ? COSTE_DIAGONAL : COSTE_ORTOGONAL);

        if (sello[vecino] === generacion && costeNuevo >= coste[vecino]) continue;

        sello[vecino] = generacion;
        estados[vecino] = ABIERTO;
        coste[vecino] = costeNuevo;
        padre[vecino] = actual;

        const hVecino = BuscadorAEstrella.heuristica(destinoCX - nx, destinoCZ - nz);
        monticulo.insertar(vecino, costeNuevo + hVecino, hVecino);
      }
    }

    res.nodosExplorados = nodosExpandidos;

    if (nodoMeta >= 0) {
      res.estado = 'completo';
      res.casillaFinal = nodoMeta;
      res.longitud = this.reconstruir(nodoMeta);
      return res;
    }

    // Frontera agotada sin encontrar la meta y sin gastar el presupuesto: el destino
    // está en otra componente conexa. Aquí sí es honesto decir «imposible».
    if (monticulo.vacio && nodosExpandidos < maxNodos) {
      res.estado = 'imposible';
      res.longitud = 0;
      return res;
    }

    // Presupuesto agotado: se entrega lo mejor que hemos encontrado.
    if (mejorNodo === indiceOrigen) {
      res.estado = 'imposible';
      res.longitud = 0;
      return res;
    }

    res.estado = 'parcial';
    res.casillaFinal = mejorNodo;
    res.longitud = this.reconstruir(mejorNodo);
    return res;
  }

  /** Rehace el camino siguiendo los padres y lo deja del derecho en `buffer`. */
  private reconstruir(nodoFinal: number): number {
    const inverso = this.bufferInverso;
    const padre = this.padre;
    let n = 0;
    let nodo = nodoFinal;
    while (nodo >= 0 && n < inverso.length) {
      inverso[n++] = nodo;
      nodo = padre[nodo];
    }
    const buffer = this.buffer;
    for (let i = 0; i < n; i++) buffer[i] = inverso[n - 1 - i];
    return n;
  }
}

/** Holgura (en casillas) que necesita una unidad de radio `radio` en unidades de mundo. */
export function holguraParaRadio(radio: number, tamCasilla: number): number {
  const h = Math.round(radio / tamCasilla - 0.5);
  return h > 0 ? h : 0;
}
