/**
 * Generador de números pseudoaleatorios determinista (xorshift128).
 *
 * La simulación NUNCA debe llamar a Math.random(). Toda aleatoriedad que afecte
 * al estado del juego (daño, dispersión de flechas, decisiones de la IA) pasa por
 * aquí, de forma que una misma semilla más una misma secuencia de órdenes producen
 * exactamente la misma partida. Eso nos da repeticiones, tests reproducibles y la
 * puerta abierta a multijugador con simulación en lock-step.
 *
 * Los efectos puramente visuales (chispas, hojas al viento) pueden usar su propia
 * instancia separada: no deben consumir del flujo de la simulación.
 */
export class Azar {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(semilla = 0x1a2b3c4d) {
    // SplitMix32 para dispersar la semilla en los cuatro estados iniciales.
    let s = semilla >>> 0;
    const siguiente = (): number => {
      s = (s + 0x9e3779b9) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.a = siguiente();
    this.b = siguiente();
    this.c = siguiente();
    this.d = siguiente();
    // Un estado todo-ceros es un punto fijo del algoritmo: hay que evitarlo.
    if ((this.a | this.b | this.c | this.d) === 0) this.a = 1;
  }

  /** Entero sin signo de 32 bits. */
  siguienteEntero(): number {
    const t = this.b << 9;
    let r = Math.imul(this.b, 5);
    r = ((r << 7) | (r >>> 25)) >>> 0;
    r = Math.imul(r, 9) >>> 0;

    this.c ^= this.a;
    this.d ^= this.b;
    this.b ^= this.c;
    this.a ^= this.d;
    this.c ^= t;
    this.d = ((this.d << 11) | (this.d >>> 21)) >>> 0;

    return r >>> 0;
  }

  /** Flotante en [0, 1). */
  siguiente(): number {
    return this.siguienteEntero() / 4294967296;
  }

  /** Flotante en [minimo, maximo). */
  rango(minimo: number, maximo: number): number {
    return minimo + this.siguiente() * (maximo - minimo);
  }

  /** Entero en [minimo, maximo] — ambos extremos incluidos. */
  entero(minimo: number, maximo: number): number {
    return minimo + Math.floor(this.siguiente() * (maximo - minimo + 1));
  }

  /** `true` con la probabilidad dada (0 = nunca, 1 = siempre). */
  probabilidad(p: number): boolean {
    return this.siguiente() < p;
  }

  /** Un elemento cualquiera del array. Devuelve `undefined` si está vacío. */
  elegir<T>(items: readonly T[]): T | undefined {
    if (items.length === 0) return undefined;
    return items[Math.floor(this.siguiente() * items.length)];
  }

  /** Baraja in situ (Fisher-Yates). */
  barajar<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(this.siguiente() * (i + 1));
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** Punto uniforme dentro de un disco de radio `radio`. */
  enDisco(radio: number, salida: { x: number; y: number }): void {
    // La raíz es necesaria: sin ella los puntos se apelotonan en el centro.
    const r = radio * Math.sqrt(this.siguiente());
    const angulo = this.siguiente() * Math.PI * 2;
    salida.x = Math.cos(angulo) * r;
    salida.y = Math.sin(angulo) * r;
  }

  /** Captura el estado interno, para guardar partida o depurar una desincronización. */
  guardarEstado(): [number, number, number, number] {
    return [this.a, this.b, this.c, this.d];
  }

  restaurarEstado(estado: readonly [number, number, number, number]): void {
    this.a = estado[0];
    this.b = estado[1];
    this.c = estado[2];
    this.d = estado[3];
  }
}

/** Instancia dedicada a efectos visuales. Consumirla no altera la simulación. */
export const azarVisual = new Azar(0xbeef1234);
