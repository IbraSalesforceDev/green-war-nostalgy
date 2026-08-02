import * as THREE from 'three';
import type { CalidadRender } from './renderizador';

/**
 * Fábrica de texturas procedurales.
 *
 * Todo lo que se ve en el terreno, el agua y la vegetación se dibuja aquí con
 * aritmética: ni un solo byte descargado. Las razones son tres y todas prácticas:
 * no hay red en el entorno de ejecución, no queremos arrastrar licencias ajenas y
 * un generador cabe en unos kilobytes mientras que un juego de texturas de calidad
 * ocuparía decenas de megas.
 *
 * Todo el ruido que se usa aquí es *tileable*: la retícula de valores se envuelve
 * con el módulo del periodo, así que las texturas repiten sin costura visible.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   CAPA_HIERBA / CAPA_TIERRA / CAPA_ROCA / CAPA_ARENA  índices de capa del atlas
 *   NUM_CAPAS_TERRENO                                    tamaño del atlas
 *   RUGOSIDAD_CAPA                                       rugosidad PBR por capa
 *
 *   crearAtlasTerreno(calidad): AtlasTerreno
 *       Devuelve dos DataArrayTexture (WebGL2, sampler2DArray):
 *         · albedo: rgb = color en sRGB, a = altura del material (mezcla por altura)
 *         · normal: rgb = normal tangencial, a = oclusión ambiental de detalle
 *   crearTexturaMacro(calidad): THREE.DataTexture
 *       Ruido de muy baja frecuencia para romper la repetición a gran escala.
 *   crearTexturaOlas(calidad): THREE.DataTexture
 *       Mapa de normales de oleaje, pensado para desplazarse en dos direcciones.
 *   crearSpriteVegetacion(clase, calidad): THREE.DataTexture
 *       Recorte con alfa de una mata de hierba, un helecho o un ramo de flores.
 *   liberarCacheTexturas(): void
 *       Suelta todo lo cacheado. Llamar solo al destruir la escena entera.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// --- Índices de capa del atlas de terreno ---

export const CAPA_HIERBA = 0;
export const CAPA_TIERRA = 1;
export const CAPA_ROCA = 2;
export const CAPA_ARENA = 3;
export const NUM_CAPAS_TERRENO = 4;

/** Rugosidad PBR de cada capa. La roca pulida por la lluvia brilla algo más. */
export const RUGOSIDAD_CAPA: readonly number[] = [0.96, 0.93, 0.78, 0.9];

export type ClaseVegetacion = 'hierba' | 'helecho' | 'flor';

export interface AtlasTerreno {
  albedo: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  resolucion: number;
  liberar(): void;
}

// --- Ruido tileable -----------------------------------------------------------

function envolver(valor: number, periodo: number): number {
  const m = valor % periodo;
  return m < 0 ? m + periodo : m;
}

function hashRejilla(x: number, y: number, semilla: number): number {
  let h = x * 374761393 + y * 668265263 + semilla * 1442695041;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Ruido de valor que se repite exactamente cada `periodo` unidades. */
function valorTileable(x: number, y: number, periodo: number, semilla: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = envolver(xi, periodo);
  const y0 = envolver(yi, periodo);
  const x1 = envolver(xi + 1, periodo);
  const y1 = envolver(yi + 1, periodo);

  const a = hashRejilla(x0, y0, semilla);
  const b = hashRejilla(x1, y0, semilla);
  const c = hashRejilla(x0, y1, semilla);
  const d = hashRejilla(x1, y1, semilla);

  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return ab + (cd - ab) * v;
}

/**
 * Ruido fractal tileable.
 * `periodo` es el número de celdas de la primera octava dentro de una repetición
 * completa; cada octava duplica la frecuencia y el periodo a la vez, que es lo que
 * mantiene la costura invisible.
 */
function fbmTileable(
  x: number,
  y: number,
  periodo: number,
  octavas: number,
  semilla: number,
  persistencia = 0.5,
): number {
  let amplitud = 1;
  let frecuencia = 1;
  let suma = 0;
  let norma = 0;
  for (let o = 0; o < octavas; o++) {
    suma += valorTileable(x * frecuencia, y * frecuencia, periodo * frecuencia, semilla + o * 61) * amplitud;
    norma += amplitud;
    amplitud *= persistencia;
    frecuencia *= 2;
  }
  return suma / norma;
}

/** Ruido de crestas: da vetas y grietas donde el fractal normal da manchas. */
function fbmCrestas(x: number, y: number, periodo: number, octavas: number, semilla: number): number {
  let amplitud = 1;
  let frecuencia = 1;
  let suma = 0;
  let norma = 0;
  for (let o = 0; o < octavas; o++) {
    const v = valorTileable(x * frecuencia, y * frecuencia, periodo * frecuencia, semilla + o * 97);
    suma += (1 - Math.abs(v * 2 - 1)) * amplitud;
    norma += amplitud;
    amplitud *= 0.55;
    frecuencia *= 2;
  }
  return suma / norma;
}

function limitar01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function suavizar(borde0: number, borde1: number, v: number): number {
  const t = limitar01((v - borde0) / (borde1 - borde0));
  return t * t * (3 - 2 * t);
}

function mezclar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// --- Generadores de capa ------------------------------------------------------

interface CapaCruda {
  /** Color en sRGB, 3 canales por texel. */
  color: Float32Array;
  /** Altura del material en [0, 1]. Alimenta la mezcla por altura del terreno. */
  altura: Float32Array;
}

function nuevaCapa(n: number): CapaCruda {
  return { color: new Float32Array(n * n * 3), altura: new Float32Array(n * n) };
}

/**
 * Hierba de pradera.
 * Tres escalas superpuestas: matas grandes que dan las manchas de luz y sombra,
 * hebras finas orientadas que evitan el aspecto de moqueta, y calvas secas
 * ocasionales para que el verde no sea uniforme.
 */
function generarHierba(n: number): CapaCruda {
  const capa = nuevaCapa(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;

      const matas = fbmTileable(u * 6, v * 6, 6, 4, 11);
      const finas = fbmTileable(u * 26, v * 26, 26, 3, 29);
      // Ruido estirado: las celdas son cinco veces más largas que anchas, y eso
      // se lee como hebras y no como manchas.
      const hebras = fbmTileable(u * 48, v * 10, 48, 2, 47);
      const seco = suavizar(0.58, 0.8, fbmTileable(u * 3, v * 3, 3, 3, 71));

      const luz = limitar01(matas * 0.5 + hebras * 0.34 + finas * 0.16);

      // Paleta de hierba: de verde musgo profundo a verde tierno iluminado.
      let r = mezclar(38, 122, luz * luz * 0.8 + luz * 0.2);
      let g = mezclar(64, 158, luz);
      let b = mezclar(28, 66, luz * 0.85);

      // Calvas secas: pajizas, no marrones; el marrón las confundiría con tierra.
      r = mezclar(r, 158, seco * 0.75);
      g = mezclar(g, 146, seco * 0.6);
      b = mezclar(b, 84, seco * 0.6);

      const k = (j * n + i) * 3;
      capa.color[k] = r;
      capa.color[k + 1] = g;
      capa.color[k + 2] = b;
      capa.altura[j * n + i] = limitar01(matas * 0.45 + hebras * 0.4 + finas * 0.15);
    }
  }
  return capa;
}

/** Tierra batida: mantillo oscuro, guijarros dispersos y grietas de sequía. */
function generarTierra(n: number): CapaCruda {
  const capa = nuevaCapa(n);
  const celdas = 14;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;

      const mancha = fbmTileable(u * 5, v * 5, 5, 5, 5);
      const grano = fbmTileable(u * 40, v * 40, 40, 2, 13);
      const grietas = suavizar(0.72, 0.96, fbmCrestas(u * 7, v * 7, 7, 3, 23));

      // Guijarros: rejilla de celdas con el centro desplazado por hash.
      const cu = u * celdas;
      const cv = v * celdas;
      const ci = Math.floor(cu);
      const cj = Math.floor(cv);
      let guijarro = 0;
      let guijarroTono = 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const gx = envolver(ci + di, celdas);
          const gy = envolver(cj + dj, celdas);
          const hx = hashRejilla(gx, gy, 101);
          const hy = hashRejilla(gx, gy, 202);
          const hr = hashRejilla(gx, gy, 303);
          if (hr < 0.45) continue;
          const px = ci + di + hx;
          const py = cj + dj + hy;
          const radio = 0.16 + hr * 0.2;
          const d = Math.hypot(cu - px, cv - py) / radio;
          const m = 1 - suavizar(0.7, 1, d);
          if (m > guijarro) {
            guijarro = m;
            guijarroTono = hashRejilla(gx, gy, 404);
          }
        }
      }

      const luz = limitar01(mancha * 0.72 + grano * 0.28);
      let r = mezclar(58, 138, luz);
      let g = mezclar(42, 108, luz);
      let b = mezclar(30, 76, luz);

      // Guijarro: gris cálido, más claro que la tierra que lo rodea.
      const tonoP = 96 + guijarroTono * 66;
      r = mezclar(r, tonoP, guijarro * 0.85);
      g = mezclar(g, tonoP * 0.96, guijarro * 0.85);
      b = mezclar(b, tonoP * 0.88, guijarro * 0.85);

      // Las grietas son sombra pura: oscurecen y hunden.
      const oscuro = grietas * 0.45;
      r *= 1 - oscuro;
      g *= 1 - oscuro;
      b *= 1 - oscuro;

      const k = (j * n + i) * 3;
      capa.color[k] = r;
      capa.color[k + 1] = g;
      capa.color[k + 2] = b;
      capa.altura[j * n + i] = limitar01(mancha * 0.3 + grano * 0.15 + guijarro * 0.6 - grietas * 0.35);
    }
  }
  return capa;
}

/**
 * Roca estratificada.
 * Las bandas van en el eje V. En las paredes de acantilado la V es la altura del
 * mundo, así que los estratos salen horizontales, que es exactamente lo que da a
 * un risco su lectura de roca sedimentaria y no de bloque de plastilina.
 */
function generarRoca(n: number): CapaCruda {
  const capa = nuevaCapa(n);
  const bandas = 7;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;

      // La ondulación de los estratos: sin ella serían rayas de cebra.
      const onda = (fbmTileable(u * 4, v * 4, 4, 3, 31) - 0.5) * 0.55;
      const s = v * bandas + onda;
      const banda = s - Math.floor(s);
      const indiceBanda = envolver(Math.floor(s), bandas);
      const tonoBanda = hashRejilla(indiceBanda, 0, 55);

      // Perfil de estrato: borde inferior marcado, cuerpo claro, arista superior.
      const perfil = suavizar(0, 0.14, banda) * (1 - suavizar(0.78, 1, banda));

      const rugoso = fbmTileable(u * 22, v * 22, 22, 4, 67);
      const vetas = fbmCrestas(u * 11, v * 11, 11, 3, 83);
      const grietas = suavizar(0.76, 0.99, vetas);

      const luz = limitar01(perfil * 0.5 + rugoso * 0.38 + tonoBanda * 0.22);
      // Gris con temperatura variable: unas bandas tiran a ocre, otras a pizarra.
      const calido = tonoBanda;
      let r = mezclar(58, 152, luz) * mezclar(0.92, 1.08, calido);
      let g = mezclar(56, 143, luz) * mezclar(0.96, 1.0, calido);
      let b = mezclar(54, 131, luz) * mezclar(1.06, 0.88, calido);

      const oscuro = grietas * 0.55 + (1 - perfil) * 0.12;
      r *= 1 - oscuro;
      g *= 1 - oscuro;
      b *= 1 - oscuro;

      const k = (j * n + i) * 3;
      capa.color[k] = r;
      capa.color[k + 1] = g;
      capa.color[k + 2] = b;
      capa.altura[j * n + i] = limitar01(perfil * 0.55 + rugoso * 0.35 - grietas * 0.55 + 0.15);
    }
  }
  return capa;
}

/** Arena de orilla: ondulaciones del oleaje y grano fino. */
function generarArena(n: number): CapaCruda {
  const capa = nuevaCapa(n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;

      const deriva = (fbmTileable(u * 4, v * 4, 4, 3, 137) - 0.5) * 1.6;
      const rizos = 0.5 + 0.5 * Math.sin((u * 18 + v * 5 + deriva) * Math.PI * 2);
      const grano = fbmTileable(u * 56, v * 56, 56, 2, 151);
      const mancha = fbmTileable(u * 5, v * 5, 5, 3, 163);
      const conchas = suavizar(0.88, 0.97, fbmTileable(u * 30, v * 30, 30, 1, 177));

      const luz = limitar01(rizos * 0.34 + grano * 0.24 + mancha * 0.42);
      let r = mezclar(140, 214, luz);
      let g = mezclar(120, 196, luz);
      let b = mezclar(88, 156, luz);

      r = mezclar(r, 236, conchas * 0.7);
      g = mezclar(g, 230, conchas * 0.7);
      b = mezclar(b, 214, conchas * 0.7);

      const k = (j * n + i) * 3;
      capa.color[k] = r;
      capa.color[k + 1] = g;
      capa.color[k + 2] = b;
      capa.altura[j * n + i] = limitar01(rizos * 0.55 + grano * 0.25 + mancha * 0.2);
    }
  }
  return capa;
}

// --- Derivación de normales y oclusión ---------------------------------------

/**
 * Convierte un campo de alturas en un mapa de normales tangenciales con la
 * oclusión guardada en el canal alfa.
 *
 * La oclusión sale de comparar cada texel con una versión desenfocada del relieve:
 * lo que está por debajo de su entorno recibe menos luz rebotada. Es una
 * aproximación grosera de la realidad, pero es la que hace que los guijarros
 * parezcan apoyados en el suelo en vez de pegados como calcomanías.
 */
function alturaANormalYOclusion(altura: Float32Array, n: number, fuerza: number): Uint8Array {
  const desenfoque = new Float32Array(n * n);
  const radio = Math.max(1, Math.round(n / 48));
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let suma = 0;
      let cuenta = 0;
      for (let dj = -radio; dj <= radio; dj++) {
        const y = envolver(j + dj, n);
        for (let di = -radio; di <= radio; di++) {
          const x = envolver(i + di, n);
          suma += altura[y * n + x];
          cuenta++;
        }
      }
      desenfoque[j * n + i] = suma / cuenta;
    }
  }

  const salida = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    const jm = envolver(j - 1, n);
    const jp = envolver(j + 1, n);
    for (let i = 0; i < n; i++) {
      const im = envolver(i - 1, n);
      const ip = envolver(i + 1, n);

      const hL = altura[j * n + im];
      const hR = altura[j * n + ip];
      const hD = altura[jm * n + i];
      const hU = altura[jp * n + i];

      const dx = (hL - hR) * fuerza;
      const dy = (hD - hU) * fuerza;
      const largo = Math.hypot(dx, dy, 1);

      const k = (j * n + i) * 4;
      salida[k] = Math.round(((dx / largo) * 0.5 + 0.5) * 255);
      salida[k + 1] = Math.round(((dy / largo) * 0.5 + 0.5) * 255);
      salida[k + 2] = Math.round(((1 / largo) * 0.5 + 0.5) * 255);

      const relativa = altura[j * n + i] - desenfoque[j * n + i];
      const ao = limitar01(0.78 + relativa * 2.4);
      salida[k + 3] = Math.round(ao * 255);
    }
  }
  return salida;
}

// --- Atlas de terreno ---------------------------------------------------------

let atlasCache: AtlasTerreno | null = null;

export function crearAtlasTerreno(calidad: CalidadRender): AtlasTerreno {
  if (atlasCache) return atlasCache;

  const n = calidad.nivel === 'alto' ? 256 : calidad.nivel === 'medio' ? 192 : 128;

  const capas: CapaCruda[] = [
    generarHierba(n),
    generarTierra(n),
    generarRoca(n),
    generarArena(n),
  ];
  const fuerzas = [2.2, 3.4, 4.6, 2.0];

  const datosAlbedo = new Uint8Array(n * n * 4 * NUM_CAPAS_TERRENO);
  const datosNormal = new Uint8Array(n * n * 4 * NUM_CAPAS_TERRENO);

  for (let c = 0; c < NUM_CAPAS_TERRENO; c++) {
    const capa = capas[c];
    const base = c * n * n * 4;
    for (let p = 0; p < n * n; p++) {
      const k = base + p * 4;
      datosAlbedo[k] = Math.min(255, Math.max(0, Math.round(capa.color[p * 3])));
      datosAlbedo[k + 1] = Math.min(255, Math.max(0, Math.round(capa.color[p * 3 + 1])));
      datosAlbedo[k + 2] = Math.min(255, Math.max(0, Math.round(capa.color[p * 3 + 2])));
      // El alfa lleva la altura del material: es lo que permite que la hierba
      // asome por las juntas de la tierra en vez de fundirse con ella en gris.
      datosAlbedo[k + 3] = Math.round(limitar01(capa.altura[p]) * 255);
    }
    const normal = alturaANormalYOclusion(capa.altura, n, fuerzas[c]);
    datosNormal.set(normal, base);
  }

  const albedo = new THREE.DataArrayTexture(datosAlbedo, n, n, NUM_CAPAS_TERRENO);
  albedo.format = THREE.RGBAFormat;
  albedo.type = THREE.UnsignedByteType;
  albedo.colorSpace = THREE.SRGBColorSpace;
  configurarTiling(albedo, calidad);

  const normal = new THREE.DataArrayTexture(datosNormal, n, n, NUM_CAPAS_TERRENO);
  normal.format = THREE.RGBAFormat;
  normal.type = THREE.UnsignedByteType;
  normal.colorSpace = THREE.NoColorSpace;
  configurarTiling(normal, calidad);

  atlasCache = {
    albedo,
    normal,
    resolucion: n,
    liberar() {
      albedo.dispose();
      normal.dispose();
      if (atlasCache && atlasCache.albedo === albedo) atlasCache = null;
    },
  };
  return atlasCache;
}

function configurarTiling(textura: THREE.Texture, calidad: CalidadRender): void {
  textura.wrapS = THREE.RepeatWrapping;
  textura.wrapT = THREE.RepeatWrapping;
  textura.magFilter = THREE.LinearFilter;
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.generateMipmaps = true;
  textura.anisotropy = calidad.anisotropia;
  textura.needsUpdate = true;
}

// --- Ruido macroscópico -------------------------------------------------------

let macroCache: THREE.DataTexture | null = null;

/**
 * Ruido de gran escala.
 * Se muestrea con una repetición de casi cien casillas, de modo que a lo largo del
 * mapa entero no llega a repetirse una vez. Es el antídoto contra el efecto
 * «papel pintado» que delata cualquier terreno con textura de mosaico.
 */
export function crearTexturaMacro(calidad: CalidadRender): THREE.DataTexture {
  if (macroCache) return macroCache;
  const n = calidad.nivel === 'bajo' ? 128 : 256;
  const datos = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;
      const a = fbmTileable(u * 3, v * 3, 3, 4, 401);
      const b = fbmTileable(u * 6, v * 6, 6, 4, 419, 0.6);
      const c = fbmTileable(u * 12, v * 12, 12, 3, 433);
      const k = (j * n + i) * 4;
      datos[k] = Math.round(limitar01(a) * 255);
      datos[k + 1] = Math.round(limitar01(b) * 255);
      datos[k + 2] = Math.round(limitar01(c) * 255);
      datos[k + 3] = 255;
    }
  }
  const textura = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.colorSpace = THREE.NoColorSpace;
  configurarTiling(textura, calidad);
  macroCache = textura;
  return textura;
}

// --- Oleaje -------------------------------------------------------------------

let olasCache: THREE.DataTexture | null = null;

/** Mapa de normales del oleaje de superficie. Dos capas desplazadas lo animan. */
export function crearTexturaOlas(calidad: CalidadRender): THREE.DataTexture {
  if (olasCache) return olasCache;
  const n = calidad.nivel === 'bajo' ? 128 : 256;
  const altura = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = i / n;
      const v = j / n;
      // Dos trenes de onda cruzados más ruido: ni rejilla ni papilla.
      const onda1 = 0.5 + 0.5 * Math.sin((u * 4 + v * 2) * Math.PI * 2 + fbmTileable(u * 4, v * 4, 4, 2, 601) * 3);
      const onda2 = 0.5 + 0.5 * Math.sin((u * 3 - v * 5) * Math.PI * 2 + fbmTileable(u * 6, v * 6, 6, 2, 613) * 3);
      const rizo = fbmTileable(u * 16, v * 16, 16, 3, 631);
      altura[j * n + i] = limitar01(onda1 * 0.4 + onda2 * 0.35 + rizo * 0.25);
    }
  }
  const datos = alturaANormalYOclusion(altura, n, 2.6);
  const textura = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.colorSpace = THREE.NoColorSpace;
  configurarTiling(textura, calidad);
  olasCache = textura;
  return textura;
}

// --- Recortes de vegetación ---------------------------------------------------

const spritesCache = new Map<string, THREE.DataTexture>();

/**
 * Dibuja un recorte de vegetación con alfa.
 *
 * Se rasteriza a mano en un búfer en vez de usar el canvas 2D del navegador: así
 * el resultado es idéntico en todos los dispositivos y no depende de cómo suavice
 * las curvas cada motor gráfico.
 */
export function crearSpriteVegetacion(
  clase: ClaseVegetacion,
  calidad: CalidadRender,
): THREE.DataTexture {
  const n = calidad.nivel === 'alto' ? 128 : 64;
  const clave = `${clase}:${n}`;
  const guardada = spritesCache.get(clave);
  if (guardada) return guardada;

  const datos = new Uint8Array(n * n * 4);

  const pintar = (
    px: number,
    py: number,
    radio: number,
    r: number,
    g: number,
    b: number,
    alfa: number,
  ): void => {
    const i0 = Math.max(0, Math.floor(px - radio - 1));
    const i1 = Math.min(n - 1, Math.ceil(px + radio + 1));
    const j0 = Math.max(0, Math.floor(py - radio - 1));
    const j1 = Math.min(n - 1, Math.ceil(py + radio + 1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i + 0.5 - px, j + 0.5 - py);
        const cobertura = limitar01((radio - d) / Math.max(0.6, radio * 0.6)) * alfa;
        if (cobertura <= 0) continue;
        const k = (j * n + i) * 4;
        const a = datos[k + 3] / 255;
        if (cobertura <= a) continue;
        datos[k] = Math.round(mezclar(datos[k], r, cobertura));
        datos[k + 1] = Math.round(mezclar(datos[k + 1], g, cobertura));
        datos[k + 2] = Math.round(mezclar(datos[k + 2], b, cobertura));
        datos[k + 3] = Math.round(cobertura * 255);
      }
    }
  };

  // La V de la textura crece hacia abajo en el búfer; la base de la planta va abajo.
  const alBufer = (t: number): number => (1 - t) * (n - 1);

  if (clase === 'hierba' || clase === 'helecho') {
    const esHelecho = clase === 'helecho';
    const briznas = esHelecho ? 9 : 16;
    for (let k = 0; k < briznas; k++) {
      const h = hashRejilla(k, esHelecho ? 3 : 7, 11);
      const h2 = hashRejilla(k, esHelecho ? 3 : 7, 23);
      const h3 = hashRejilla(k, esHelecho ? 3 : 7, 37);

      const baseX = mezclar(0.28, 0.72, h);
      const alto = mezclar(esHelecho ? 0.55 : 0.5, esHelecho ? 0.95 : 1, h2);
      const curva = (h3 - 0.5) * (esHelecho ? 0.5 : 0.72);
      const grosor = (esHelecho ? 0.055 : 0.04) * n * mezclar(0.7, 1.25, h3);

      const oscuro = esHelecho ? [26, 58, 24] : [30, 62, 22];
      const claro = esHelecho ? [86, 142, 58] : [126, 176, 66];

      const pasos = Math.round(n * 0.9);
      for (let s = 0; s <= pasos; s++) {
        const t = s / pasos;
        const x = (baseX + curva * t * t) * n;
        const y = alBufer(t * alto);
        const w = grosor * (1 - t * 0.92) + 0.5;
        const luz = t * 0.85 + h3 * 0.15;
        pintar(
          x,
          y,
          w,
          mezclar(oscuro[0], claro[0], luz),
          mezclar(oscuro[1], claro[1], luz),
          mezclar(oscuro[2], claro[2], luz),
          1,
        );
        // El helecho abre foliolos a los lados: silueta de fronda, no de brizna.
        if (esHelecho && t > 0.18 && t < 0.92 && s % Math.max(2, Math.round(pasos / 14)) === 0) {
          const largo = (0.14 + 0.1 * Math.sin(t * Math.PI)) * n;
          for (const signo of [-1, 1]) {
            for (let f = 1; f <= 6; f++) {
              const ft = f / 6;
              pintar(
                x + signo * largo * ft,
                y + largo * ft * 0.42,
                Math.max(0.7, w * (1 - ft) * 1.5),
                mezclar(oscuro[0], claro[0], luz * 0.9),
                mezclar(oscuro[1], claro[1], luz * 0.9),
                mezclar(oscuro[2], claro[2], luz * 0.9),
                1,
              );
            }
          }
        }
      }
    }
  } else {
    // Flores: tallo fino y corola de cinco pétalos.
    const ramos = 7;
    for (let k = 0; k < ramos; k++) {
      const h = hashRejilla(k, 5, 13);
      const h2 = hashRejilla(k, 5, 29);
      const h3 = hashRejilla(k, 5, 43);
      const baseX = mezclar(0.24, 0.76, h);
      const alto = mezclar(0.45, 0.88, h2);
      const curva = (h3 - 0.5) * 0.4;

      const pasos = Math.round(n * 0.8);
      for (let s = 0; s <= pasos; s++) {
        const t = s / pasos;
        const x = (baseX + curva * t * t) * n;
        const y = alBufer(t * alto);
        pintar(x, y, n * 0.012 + 0.5, 44, 84, 34, 1);
      }

      const cx = (baseX + curva) * n;
      const cy = alBufer(alto);
      const paleta = [
        [232, 208, 96],
        [226, 122, 148],
        [188, 156, 232],
        [244, 244, 236],
      ][Math.floor(h3 * 4) % 4];
      const radioPetalo = n * 0.055;
      for (let p = 0; p < 5; p++) {
        const ang = (p / 5) * Math.PI * 2 + h * 3;
        pintar(
          cx + Math.cos(ang) * radioPetalo,
          cy + Math.sin(ang) * radioPetalo,
          radioPetalo * 0.95,
          paleta[0],
          paleta[1],
          paleta[2],
          1,
        );
      }
      pintar(cx, cy, radioPetalo * 0.6, 236, 186, 72, 1);
    }
  }

  const textura = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.wrapS = THREE.ClampToEdgeWrapping;
  textura.wrapT = THREE.ClampToEdgeWrapping;
  textura.magFilter = THREE.LinearFilter;
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.generateMipmaps = true;
  textura.anisotropy = calidad.anisotropia;
  textura.needsUpdate = true;

  spritesCache.set(clave, textura);
  return textura;
}

// --- Limpieza -----------------------------------------------------------------

export function liberarCacheTexturas(): void {
  atlasCache?.liberar();
  atlasCache = null;
  macroCache?.dispose();
  macroCache = null;
  olasCache?.dispose();
  olasCache = null;
  for (const textura of spritesCache.values()) textura.dispose();
  spritesCache.clear();
}
