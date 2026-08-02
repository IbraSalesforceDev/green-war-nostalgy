/**
 * Utilidades matemáticas del núcleo.
 *
 * Todo lo que vive aquí lo usa la simulación, así que debe ser determinista:
 * nada de Math.random(), nada que dependa del tiempo real ni del hardware.
 */

export const TAU = Math.PI * 2;
export const DEG_A_RAD = Math.PI / 180;
export const RAD_A_GRADO = 180 / Math.PI;

export function limitar(valor: number, minimo: number, maximo: number): number {
  return valor < minimo ? minimo : valor > maximo ? maximo : valor;
}

export function limitar01(valor: number): number {
  return limitar(valor, 0, 1);
}

export function mezclar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolación independiente del framerate: converge igual a 30 fps que a 144. */
export function mezclarExp(actual: number, objetivo: number, velocidad: number, dt: number): number {
  return mezclar(actual, objetivo, 1 - Math.exp(-velocidad * dt));
}

export function paso(borde: number, valor: number): number {
  return valor < borde ? 0 : 1;
}

export function pasoSuave(borde0: number, borde1: number, valor: number): number {
  const t = limitar01((valor - borde0) / (borde1 - borde0));
  return t * t * (3 - 2 * t);
}

export function mapearRango(
  valor: number,
  entradaMin: number,
  entradaMax: number,
  salidaMin: number,
  salidaMax: number,
): number {
  const t = (valor - entradaMin) / (entradaMax - entradaMin);
  return salidaMin + limitar01(t) * (salidaMax - salidaMin);
}

export function signo(valor: number): number {
  return valor < 0 ? -1 : valor > 0 ? 1 : 0;
}

// --- Vectores 2D (el plano de juego es XZ; la Y es altura) ---

export function longitud(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function longitudCuadrada(x: number, y: number): number {
  return x * x + y * y;
}

export function distancia(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Distancia al cuadrado. Preferible a `distancia` en cualquier comparación:
 * ahorra una raíz cuadrada por llamada y en un RTS eso se llama miles de veces por tick.
 */
export function distanciaCuadrada(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Distancia de Chebyshev: la métrica correcta en una rejilla con movimiento diagonal. */
export function distanciaRejilla(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

/** Normaliza un vector escribiendo el resultado en `salida`. Devuelve la longitud original. */
export function normalizarEn(x: number, y: number, salida: { x: number; y: number }): number {
  const len = Math.sqrt(x * x + y * y);
  if (len < 1e-9) {
    salida.x = 0;
    salida.y = 0;
    return 0;
  }
  salida.x = x / len;
  salida.y = y / len;
  return len;
}

// --- Ángulos ---

/** Envuelve un ángulo al rango [-PI, PI]. */
export function envolverAngulo(angulo: number): number {
  let a = (angulo + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Diferencia con signo entre dos ángulos, siempre por el camino corto. */
export function deltaAngulo(desde: number, hasta: number): number {
  return envolverAngulo(hasta - desde);
}

/** Gira `desde` hacia `hasta` sin pasarse de `maximo` radianes. */
export function girarHacia(desde: number, hasta: number, maximo: number): number {
  const delta = deltaAngulo(desde, hasta);
  if (Math.abs(delta) <= maximo) return envolverAngulo(hasta);
  return envolverAngulo(desde + signo(delta) * maximo);
}

/** Interpolación angular por el camino corto. */
export function mezclarAngulo(a: number, b: number, t: number): number {
  return envolverAngulo(a + deltaAngulo(a, b) * t);
}

/**
 * Cuantiza un ángulo a uno de los 8 sectores cardinales.
 * Los clásicos del género dibujaban las unidades en ocho orientaciones; conservarlo
 * mantiene la lectura de la silueta y evita rotaciones nerviosas en pantallas pequeñas.
 */
export function sectorDe8(angulo: number): number {
  const a = envolverAngulo(angulo) + Math.PI;
  return Math.round((a / TAU) * 8) % 8;
}

// --- Geometría útil para selección y colisión ---

export function circulosSeSolapan(
  ax: number,
  ay: number,
  radioA: number,
  bx: number,
  by: number,
  radioB: number,
): boolean {
  const r = radioA + radioB;
  return distanciaCuadrada(ax, ay, bx, by) <= r * r;
}

export function puntoEnRectangulo(
  px: number,
  py: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): boolean {
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}

/** Punto más cercano dentro de un rectángulo alineado a los ejes. */
export function puntoMasCercanoEnRect(
  px: number,
  py: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  salida: { x: number; y: number },
): void {
  salida.x = limitar(px, minX, maxX);
  salida.y = limitar(py, minY, maxY);
}

// --- Ruido determinista (para terreno y decoración, no para lógica de juego) ---

/** Hash entero de 2 dimensiones. Rápido, estable y sin estado. */
export function hash2(x: number, y: number, semilla = 0): number {
  let h = x * 374761393 + y * 668265263 + semilla * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor con interpolación suave. Rango [0, 1]. */
export function ruidoValor(x: number, y: number, semilla = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const a = hash2(xi, yi, semilla);
  const b = hash2(xi + 1, yi, semilla);
  const c = hash2(xi, yi + 1, semilla);
  const d = hash2(xi + 1, yi + 1, semilla);

  return mezclar(mezclar(a, b, u), mezclar(c, d, u), v);
}

/** Ruido fractal (varias octavas de ruido de valor). Rango [0, 1]. */
export function ruidoFractal(
  x: number,
  y: number,
  octavas = 4,
  persistencia = 0.5,
  lacunaridad = 2,
  semilla = 0,
): number {
  let amplitud = 1;
  let frecuencia = 1;
  let suma = 0;
  let normalizador = 0;

  for (let i = 0; i < octavas; i++) {
    suma += ruidoValor(x * frecuencia, y * frecuencia, semilla + i * 131) * amplitud;
    normalizador += amplitud;
    amplitud *= persistencia;
    frecuencia *= lacunaridad;
  }

  return suma / normalizador;
}
