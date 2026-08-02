/**
 * Cola de prioridad (montículo binario mínimo) sobre arrays tipados.
 *
 * Es el corazón del A* y del Dijkstra de los campos de flujo: se llama cientos de
 * miles de veces por partida. Por eso no guarda objetos sino tres arrays paralelos
 * y no reserva memoria en `insertar` ni en `extraerMinimo`. El único momento en que
 * pide memoria es al crecer, y como el buscador lo dimensiona de antemano al número
 * de casillas del mapa, en la práctica no crece nunca.
 *
 * Orden total y determinista de las entradas:
 *   1. menor `prioridad` (el coste f en el A*)
 *   2. a igualdad, menor `desempate` (la heurística h: prefiere avanzar hacia la meta)
 *   3. a igualdad, menor `nodo` (índice de casilla)
 *
 * El tercer criterio es lo que garantiza que dos búsquedas idénticas devuelvan
 * exactamente la misma ruta: nunca se depende del orden de inserción.
 */
export class MonticuloBinario {
  private nodos: Int32Array;
  private prioridades: Float64Array;
  private desempates: Float64Array;
  private cuenta = 0;

  constructor(capacidadInicial = 1024) {
    const capacidad = Math.max(16, capacidadInicial);
    this.nodos = new Int32Array(capacidad);
    this.prioridades = new Float64Array(capacidad);
    this.desempates = new Float64Array(capacidad);
  }

  get tamano(): number {
    return this.cuenta;
  }

  get vacio(): boolean {
    return this.cuenta === 0;
  }

  get capacidad(): number {
    return this.nodos.length;
  }

  /** Vacía el montículo sin liberar ni tocar la memoria. O(1). */
  limpiar(): void {
    this.cuenta = 0;
  }

  /**
   * Inserta un nodo. Se admiten duplicados del mismo nodo con prioridades
   * distintas («inserción perezosa»): sale antes el de menor coste y el A*
   * descarta los repetidos al extraerlos. Evita tener que implementar
   * `decrease-key`, que exigiría un índice inverso y más memoria tocada.
   */
  insertar(nodo: number, prioridad: number, desempate: number): void {
    if (this.cuenta === this.nodos.length) this.crecer();

    let i = this.cuenta++;
    this.nodos[i] = nodo;
    this.prioridades[i] = prioridad;
    this.desempates[i] = desempate;

    // Flotar hacia arriba.
    while (i > 0) {
      const padre = (i - 1) >> 1;
      if (!this.esMenor(i, padre)) break;
      this.intercambiar(i, padre);
      i = padre;
    }
  }

  /** Extrae el nodo de menor prioridad. Devuelve -1 si está vacío. */
  extraerMinimo(): number {
    if (this.cuenta === 0) return -1;

    const raiz = this.nodos[0];
    this.cuenta--;

    if (this.cuenta > 0) {
      this.nodos[0] = this.nodos[this.cuenta];
      this.prioridades[0] = this.prioridades[this.cuenta];
      this.desempates[0] = this.desempates[this.cuenta];

      // Hundir hacia abajo.
      let i = 0;
      for (;;) {
        const izq = i * 2 + 1;
        if (izq >= this.cuenta) break;
        const der = izq + 1;
        let menor = izq;
        if (der < this.cuenta && this.esMenor(der, izq)) menor = der;
        if (!this.esMenor(menor, i)) break;
        this.intercambiar(i, menor);
        i = menor;
      }
    }

    return raiz;
  }

  /** Prioridad del nodo que está en la cima, sin extraerlo. Infinity si está vacío. */
  prioridadMinima(): number {
    return this.cuenta === 0 ? Infinity : this.prioridades[0];
  }

  private esMenor(a: number, b: number): boolean {
    const pa = this.prioridades[a];
    const pb = this.prioridades[b];
    if (pa !== pb) return pa < pb;
    const da = this.desempates[a];
    const db = this.desempates[b];
    if (da !== db) return da < db;
    return this.nodos[a] < this.nodos[b];
  }

  private intercambiar(a: number, b: number): void {
    const n = this.nodos[a];
    this.nodos[a] = this.nodos[b];
    this.nodos[b] = n;

    const p = this.prioridades[a];
    this.prioridades[a] = this.prioridades[b];
    this.prioridades[b] = p;

    const d = this.desempates[a];
    this.desempates[a] = this.desempates[b];
    this.desempates[b] = d;
  }

  private crecer(): void {
    const nuevaCapacidad = this.nodos.length * 2;

    const nodos = new Int32Array(nuevaCapacidad);
    nodos.set(this.nodos);
    this.nodos = nodos;

    const prioridades = new Float64Array(nuevaCapacidad);
    prioridades.set(this.prioridades);
    this.prioridades = prioridades;

    const desempates = new Float64Array(nuevaCapacidad);
    desempates.set(this.desempates);
    this.desempates = desempates;
  }
}
