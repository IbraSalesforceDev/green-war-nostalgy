import * as THREE from 'three';
import { ALTURA_ESCALON, SUBDIVISIONES_CASILLA, TAM_CASILLA } from '../sim/constantes';
import { TipoCasilla } from '../sim/tipos';
import type { MapaJuego } from '../sim/mapa';
import { limitar01, pasoSuave, ruidoFractal } from '../core/math';
import type { CalidadRender } from './renderizador';
import { calidadPara } from './renderizador';
import {
  CAPA_ARENA,
  CAPA_HIERBA,
  CAPA_ROCA,
  CAPA_TIERRA,
  NUM_CAPAS_TERRENO,
  RUGOSIDAD_CAPA,
  crearAtlasTerreno,
  crearTexturaMacro,
} from './texturas';

/**
 * Malla del terreno.
 *
 * Una sola geometría fusionada con todo el suelo y todas las paredes de acantilado,
 * dibujada con un único material: **una llamada de dibujado para 9.216 casillas**.
 * En un móvil el número de llamadas pesa mucho más que el de triángulos, así que
 * fusionarlo todo es la optimización que más rinde de todas.
 *
 * ── Por qué no hay colores por vértice ────────────────────────────────────────
 * La versión anterior pintaba cada casilla de un color plano. El resultado era una
 * manta de retales: cada casilla se leía como un rombo distinto y el mapa entero
 * parecía un tablero. Aquí el terreno se resuelve con un atlas de cuatro capas
 * (hierba, tierra, roca, arena) y **pesos por vértice**, de modo que dos casillas
 * vecinas de tipos distintos se funden en un degradado de dos o tres casillas de
 * ancho en lugar de cortarse a cuchillo.
 *
 * Tres trucos hacen el resto del trabajo:
 *
 *   1. Los pesos se muestrean *entre* los centros de casilla (interpolación
 *      bilineal), así que ningún borde de casilla coincide con un borde de mezcla.
 *   2. La mezcla no es lineal sino **por altura de material**: cada capa del atlas
 *      lleva su relieve en el canal alfa y gana quien sobresale. Es lo que hace que
 *      la hierba asome entre los guijarros de la tierra en vez de dar un gris sucio
 *      a medio camino.
 *   3. Una textura macro de periodo casi tan largo como el mapa modula los pesos y
 *      el tinte, lo que rompe a la vez la repetición del atlas y la regularidad de
 *      las transiciones.
 *
 * ── Relieve ───────────────────────────────────────────────────────────────────
 * Las alturas de juego son escalones enteros (`niveles`), y eso no se toca: la
 * simulación cuenta con ello. Encima se suman dos campos continuos:
 *
 *   · **micro-relieve**: ondulación de ±4 cm que quita el aspecto de mesa de
 *     billar. Se anula cerca de cualquier cambio de nivel, de modo que el borde
 *     superior de un acantilado sigue siendo exacto y las paredes casan sin grietas.
 *   · **hundimiento**: el lecho de las zonas de agua se excava por debajo del nivel
 *     0 en pendiente suave. Es lo que da playas, bajíos y fondos visibles, y lo que
 *     permite que el plano de agua corte el terreno en una orilla irregular.
 *
 * Ambos campos son funciones puras de la posición del mundo, así que dos vértices
 * duplicados en la misma coordenada obtienen exactamente el mismo valor y la malla
 * nunca se abre.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   construirTerreno(mapa, calidad?): TerrenoConstruido
 *     · malla / geometria / material
 *     · actualizar(dt): reservado (el terreno no anima nada hoy)
 *     · liberar(): suelta geometría y material (las texturas son de caché global,
 *       se sueltan con `liberarCacheTexturas()`)
 *
 *   construirRelieve(mapa): Relieve     campos continuos del terreno
 *   NIVEL_AGUA                          cota del plano de agua, en unidades de mundo
 *
 * NOTA DE CABLEADO: `calidad` es opcional solo para no romper el `main.ts` actual,
 * que aún llama `construirTerreno(mapa)`. Pásale siempre `renderizador.calidad`.
 * ──────────────────────────────────────────────────────────────────────────────
 */

// --- Ajustes de aspecto -------------------------------------------------------

/** Amplitud del micro-relieve del suelo, en unidades de mundo. */
const AMPLITUD_MICRO = 0.038;

/** Hundimiento del lecho por tipo de casilla, antes de suavizar. */
const HUNDIMIENTO_BAJIO = 0.24;
const HUNDIMIENTO_PROFUNDO = 0.62;

/**
 * Cota del plano de agua.
 * Va justo por debajo del suelo llano de nivel 0: así el agua solo aparece donde el
 * lecho se ha excavado, y la línea de orilla la dibuja la intersección real entre
 * el plano y la pendiente de la playa, no una decisión casilla a casilla.
 */
export const NIVEL_AGUA = -0.065;

/** Repeticiones del atlas por unidad de mundo. */
const ESCALA_UV_SUELO = 0.30;
const ESCALA_UV_PARED = 0.55;

/** Saliente máximo de la roca de las paredes, en unidades de mundo. */
const SALIENTE_PARED = 0.13;

// --- Campos continuos del terreno --------------------------------------------

export interface Relieve {
  /** Altura de la superficie en un punto continuo del mundo (incluye el escalón). */
  alturaEn(x: number, z: number): number;
  /** Ondulación fina del suelo, sin el escalón ni el hundimiento. */
  microEn(x: number, z: number): number;
  /** Cuánto se ha excavado el lecho por debajo de su nivel. Siempre ≥ 0. */
  hundimientoEn(x: number, z: number): number;
  /** Profundidad de agua en un punto: 0 si está en seco. */
  caladoEn(x: number, z: number): number;
  /** Normal de la superficie sin contar los escalones. */
  normalEn(x: number, z: number, salida: THREE.Vector3): void;
  /** Pesos de las cuatro capas del atlas, ya normalizados. */
  pesosEn(x: number, z: number, salida: Float32Array): void;
  /** Oclusión ambiental horneada, 1 = a plena luz. */
  oclusionEn(x: number, z: number): number;
  /** Variación tonal suave de gran escala, en [0, 1]. */
  matizEn(x: number, z: number): number;
}

/**
 * Pesos base de cada tipo de casilla sobre las cuatro capas del atlas.
 * Ninguno es puro a propósito: una pizca de la capa vecina en cada tipo es lo que
 * evita que las mezclas parezcan calcomanías recortadas.
 */
function pesosBase(tipo: TipoCasilla, destino: Float32Array, base: number): void {
  let h = 0;
  let t = 0;
  let r = 0;
  let a = 0;
  switch (tipo) {
    case TipoCasilla.HIERBA:
      h = 1;
      t = 0.06;
      break;
    case TipoCasilla.BOSQUE:
      // Bajo los árboles la hierba es más rala y asoma el mantillo.
      h = 1;
      t = 0.3;
      break;
    case TipoCasilla.TIERRA:
      h = 0.14;
      t = 1;
      a = 0.12;
      break;
    case TipoCasilla.CAMINO:
      h = 0.06;
      t = 0.9;
      r = 0.12;
      a = 0.4;
      break;
    case TipoCasilla.ROCA:
      h = 0.04;
      t = 0.22;
      r = 1;
      break;
    case TipoCasilla.ACANTILADO:
      // La *cara* del acantilado es roca, pero su meseta superior sigue siendo
      // pradera con la piedra asomando en el borde. Pintarla entera de gris
      // dibujaría un contorno gris alrededor de cada colina.
      h = 1;
      t = 0.12;
      r = 0.26;
      break;
    case TipoCasilla.AGUA_BAJA:
      t = 0.2;
      a = 1;
      break;
    case TipoCasilla.AGUA_PROFUNDA:
      t = 0.62;
      r = 0.3;
      a = 0.45;
      break;
    default:
      h = 1;
      break;
  }
  destino[base] = h;
  destino[base + 1] = t;
  destino[base + 2] = r;
  destino[base + 3] = a;
}

interface CamposCasilla {
  pesos: Float32Array;
  hundimiento: Float32Array;
  oclusion: Float32Array;
  libre: Float32Array;
  matiz: Float32Array;
}

function calcularCampos(mapa: MapaJuego): CamposCasilla {
  const n = mapa.numCasillas;
  const pesos = new Float32Array(n * NUM_CAPAS_TERRENO);
  const hundimiento = new Float32Array(n);
  const oclusion = new Float32Array(n);
  const libre = new Float32Array(n);
  const matiz = new Float32Array(n);

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      const tipo = mapa.casillas[i] as TipoCasilla;
      const nivel = mapa.niveles[i];

      pesosBase(tipo, pesos, i * NUM_CAPAS_TERRENO);
      // Cuanto más alto, más pelada la roca: las cumbres pierden la hierba.
      pesos[i * NUM_CAPAS_TERRENO + CAPA_ROCA] += nivel * 0.14;

      matiz[i] = mapa.variacion[i] / 255;

      // Hundimiento del lecho. Solo en cota 0 y lejos de cualquier pared: si una
      // pared de acantilado cayera sobre un lecho excavado quedaría un escalón
      // suelto entre el pie del muro y el fondo.
      let excavable = nivel === 0;
      if (excavable) {
        for (let dz = -1; dz <= 1 && excavable; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (mapa.nivelEn(cx + dx, cz + dz) > 0) {
              excavable = false;
              break;
            }
          }
        }
      }
      if (excavable) {
        if (tipo === TipoCasilla.AGUA_PROFUNDA) hundimiento[i] = HUNDIMIENTO_PROFUNDO;
        else if (tipo === TipoCasilla.AGUA_BAJA) hundimiento[i] = HUNDIMIENTO_BAJIO;
      }

      // Micro-relieve permitido solo donde las nueve casillas comparten nivel.
      let plano = true;
      for (let dz = -1; dz <= 1 && plano; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mapa.nivelEn(cx + dx, cz + dz) !== nivel) {
            plano = false;
            break;
          }
        }
      }
      libre[i] = plano ? 1 : 0;

      // Oclusión: lo que tiene vecinos más altos alrededor recibe menos luz rebotada.
      // Es lo que hunde el pie de los acantilados en penumbra y hace que la silueta
      // del relieve se lea aunque el sol dé de plano.
      let tapado = 0;
      let total = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dz === 0) continue;
          const peso = 1 / (1 + dx * dx + dz * dz);
          total += peso;
          const dif = mapa.nivelEn(cx + dx, cz + dz) - nivel;
          if (dif > 0) tapado += peso * Math.min(1, dif);
        }
      }
      oclusion[i] = 1 - limitar01(tapado / total) * 0.9;
    }
  }

  // Arena en el contorno del agua: una playa no empieza donde termina el agua, se
  // adelanta un par de casillas.
  const arenaExtra = new Float32Array(n);
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      if (mapa.niveles[i] !== 0) continue;
      if (mapa.esAgua(cx, cz)) continue;
      let cerca = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (mapa.esAgua(cx + dx, cz + dz)) {
            const d = Math.max(Math.abs(dx), Math.abs(dz));
            cerca = Math.max(cerca, d <= 1 ? 1 : 0.45);
          }
        }
      }
      arenaExtra[i] = cerca;
    }
  }
  for (let i = 0; i < n; i++) {
    if (arenaExtra[i] > 0) {
      pesos[i * NUM_CAPAS_TERRENO + CAPA_ARENA] += arenaExtra[i] * 1.15;
      pesos[i * NUM_CAPAS_TERRENO + CAPA_HIERBA] *= 1 - arenaExtra[i] * 0.65;
    }
  }

  // Suavizado. Dos pasadas de 3×3 bastan para que ninguna transición se lea como
  // el borde de una casilla, y no tantas como para borrar los caminos estrechos.
  desenfocar(pesos, mapa, NUM_CAPAS_TERRENO, 2);
  desenfocar(hundimiento, mapa, 1, 2);
  desenfocar(oclusion, mapa, 1, 1);
  desenfocar(matiz, mapa, 1, 1);

  // Normalización final de los pesos.
  for (let i = 0; i < n; i++) {
    const b = i * NUM_CAPAS_TERRENO;
    const suma = pesos[b] + pesos[b + 1] + pesos[b + 2] + pesos[b + 3];
    const inv = suma > 1e-5 ? 1 / suma : 0;
    pesos[b] *= inv;
    pesos[b + 1] *= inv;
    pesos[b + 2] *= inv;
    pesos[b + 3] *= inv;
  }

  return { pesos, hundimiento, oclusion, libre, matiz };
}

/** Desenfoque separable de 3×3 sobre un campo por casilla. */
function desenfocar(campo: Float32Array, mapa: MapaJuego, comps: number, pasadas: number): void {
  const temporal = new Float32Array(campo.length);
  for (let p = 0; p < pasadas; p++) {
    for (let cz = 0; cz < mapa.alto; cz++) {
      for (let cx = 0; cx < mapa.ancho; cx++) {
        const destino = mapa.indice(cx, cz) * comps;
        for (let c = 0; c < comps; c++) {
          let suma = 0;
          let peso = 0;
          for (let d = -1; d <= 1; d++) {
            const x = Math.min(mapa.ancho - 1, Math.max(0, cx + d));
            const w = d === 0 ? 2 : 1;
            suma += campo[(mapa.indice(x, cz)) * comps + c] * w;
            peso += w;
          }
          temporal[destino + c] = suma / peso;
        }
      }
    }
    for (let cz = 0; cz < mapa.alto; cz++) {
      for (let cx = 0; cx < mapa.ancho; cx++) {
        const destino = mapa.indice(cx, cz) * comps;
        for (let c = 0; c < comps; c++) {
          let suma = 0;
          let peso = 0;
          for (let d = -1; d <= 1; d++) {
            const z = Math.min(mapa.alto - 1, Math.max(0, cz + d));
            const w = d === 0 ? 2 : 1;
            suma += temporal[(mapa.indice(cx, z)) * comps + c] * w;
            peso += w;
          }
          campo[destino + c] = suma / peso;
        }
      }
    }
  }
}

/**
 * Envuelve los campos por casilla en funciones continuas del mundo.
 *
 * El muestreo bilineal se hace *entre centros de casilla*, no entre esquinas: así
 * el valor en la esquina de una casilla es el promedio de las cuatro que la rodean
 * y ninguna discontinuidad cae sobre un borde de la rejilla.
 */
export function construirRelieve(mapa: MapaJuego): Relieve {
  const campos = calcularCampos(mapa);
  const { pesos, hundimiento, oclusion, libre, matiz } = campos;

  const muestrear = (campo: Float32Array, comps: number, c: number, x: number, z: number): number => {
    const fx = x / TAM_CASILLA - 0.5;
    const fz = z / TAM_CASILLA - 0.5;
    let x0 = Math.floor(fx);
    let z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const x1 = Math.min(mapa.ancho - 1, Math.max(0, x0 + 1));
    const z1 = Math.min(mapa.alto - 1, Math.max(0, z0 + 1));
    x0 = Math.min(mapa.ancho - 1, Math.max(0, x0));
    z0 = Math.min(mapa.alto - 1, Math.max(0, z0));

    const a = campo[(z0 * mapa.ancho + x0) * comps + c];
    const b = campo[(z0 * mapa.ancho + x1) * comps + c];
    const d = campo[(z1 * mapa.ancho + x0) * comps + c];
    const e = campo[(z1 * mapa.ancho + x1) * comps + c];
    const ab = a + (b - a) * tx;
    const de = d + (e - d) * tx;
    return ab + (de - ab) * tz;
  };

  const micro = (x: number, z: number): number => {
    const permiso = muestrear(libre, 1, 0, x, z);
    if (permiso <= 0.001) return 0;
    const n = ruidoFractal(x * 0.58, z * 0.58, 3, 0.55, 2.1, 913);
    return (n - 0.5) * 2 * AMPLITUD_MICRO * permiso;
  };

  const hundido = (x: number, z: number): number => muestrear(hundimiento, 1, 0, x, z);

  const desplazamiento = (x: number, z: number): number => micro(x, z) - hundido(x, z);

  const nivelDe = (x: number, z: number): number => {
    const cx = Math.min(mapa.ancho - 1, Math.max(0, Math.floor(x / TAM_CASILLA)));
    const cz = Math.min(mapa.alto - 1, Math.max(0, Math.floor(z / TAM_CASILLA)));
    return mapa.niveles[mapa.indice(cx, cz)] * ALTURA_ESCALON;
  };

  const paso = TAM_CASILLA / (SUBDIVISIONES_CASILLA * 2);

  return {
    alturaEn: (x, z) => nivelDe(x, z) + desplazamiento(x, z),
    microEn: micro,
    hundimientoEn: hundido,
    caladoEn: (x, z) => Math.max(0, NIVEL_AGUA - (nivelDe(x, z) + desplazamiento(x, z))),
    normalEn(x, z, salida) {
      const dx = (desplazamiento(x + paso, z) - desplazamiento(x - paso, z)) / (2 * paso);
      const dz = (desplazamiento(x, z + paso) - desplazamiento(x, z - paso)) / (2 * paso);
      salida.set(-dx, 1, -dz).normalize();
    },
    pesosEn(x, z, salida) {
      let suma = 0;
      for (let c = 0; c < NUM_CAPAS_TERRENO; c++) {
        const v = Math.max(0, muestrear(pesos, NUM_CAPAS_TERRENO, c, x, z));
        salida[c] = v;
        suma += v;
      }
      const inv = suma > 1e-5 ? 1 / suma : 0;
      for (let c = 0; c < NUM_CAPAS_TERRENO; c++) salida[c] *= inv;
    },
    oclusionEn: (x, z) => muestrear(oclusion, 1, 0, x, z),
    matizEn: (x, z) => muestrear(matiz, 1, 0, x, z),
  };
}

// --- Construcción de la malla -------------------------------------------------

export interface TerrenoConstruido {
  malla: THREE.Object3D;
  geometria: THREE.BufferGeometry;
  material: THREE.Material;
  actualizar(dt: number): void;
  liberar(): void;
}

interface Lados {
  dx: number;
  dz: number;
  /** Extremo inicial y final de la arista compartida, en coordenadas locales [0, 1]. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Normal exterior. */
  nx: number;
  nz: number;
  /** Vecino a lo largo de la arista, para saber si el saliente puede continuar. */
  tx: number;
  tz: number;
}

const LADOS: Lados[] = [
  { dx: 0, dz: -1, ax: 0, az: 0, bx: 1, bz: 0, nx: 0, nz: -1, tx: 1, tz: 0 },
  { dx: 1, dz: 0, ax: 1, az: 0, bx: 1, bz: 1, nx: 1, nz: 0, tx: 0, tz: 1 },
  { dx: 0, dz: 1, ax: 1, az: 1, bx: 0, bz: 1, nx: 0, nz: 1, tx: -1, tz: 0 },
  { dx: -1, dz: 0, ax: 0, az: 1, bx: 0, bz: 0, nx: -1, nz: 0, tx: 0, tz: -1 },
];

export function construirTerreno(
  mapa: MapaJuego,
  calidad: CalidadRender = calidadPara('medio'),
): TerrenoConstruido {
  const relieve = construirRelieve(mapa);
  const sub = Math.max(1, SUBDIVISIONES_CASILLA);

  const posiciones: number[] = [];
  const normales: number[] = [];
  const pesosVert: number[] = [];
  const extras: number[] = [];
  const indices: number[] = [];

  const normal = new THREE.Vector3();
  const pesos = new Float32Array(NUM_CAPAS_TERRENO);

  let siguiente = 0;

  const empujar = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    w0: number,
    w1: number,
    w2: number,
    w3: number,
    ao: number,
    matiz: number,
  ): number => {
    posiciones.push(x, y, z);
    normales.push(nx, ny, nz);
    pesosVert.push(w0, w1, w2, w3);
    extras.push(ao, matiz);
    return siguiente++;
  };

  // --- Caras superiores ---
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      const base = mapa.niveles[i] * ALTURA_ESCALON;
      const primero = siguiente;

      for (let j = 0; j <= sub; j++) {
        const z = (cz + j / sub) * TAM_CASILLA;
        for (let k = 0; k <= sub; k++) {
          const x = (cx + k / sub) * TAM_CASILLA;
          const y = base + relieve.microEn(x, z) - relieve.hundimientoEn(x, z);
          relieve.normalEn(x, z, normal);
          relieve.pesosEn(x, z, pesos);
          empujar(
            x,
            y,
            z,
            normal.x,
            normal.y,
            normal.z,
            pesos[0],
            pesos[1],
            pesos[2],
            pesos[3],
            relieve.oclusionEn(x, z),
            relieve.matizEn(x, z),
          );
        }
      }

      const fila = sub + 1;
      for (let j = 0; j < sub; j++) {
        for (let k = 0; k < sub; k++) {
          const a = primero + j * fila + k;
          const b = a + 1;
          const c = a + fila + 1;
          const d = a + fila;
          indices.push(a, c, b, a, d, c);
        }
      }
    }
  }

  // --- Paredes de acantilado ---
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const nivel = mapa.nivelEn(cx, cz);
      const alturaBase = nivel * ALTURA_ESCALON;
      const oclusionCima = relieve.oclusionEn((cx + 0.5) * TAM_CASILLA, (cz + 0.5) * TAM_CASILLA);

      for (const lado of LADOS) {
        const vx = cx + lado.dx;
        const vz = cz + lado.dz;
        const nivelVecino = mapa.dentro(vx, vz) ? mapa.nivelEn(vx, vz) : 0;
        if (nivelVecino >= nivel) continue;

        const alturaVecino = nivelVecino * ALTURA_ESCALON;
        const caida = alturaBase - alturaVecino;

        // ¿Continúa la misma pared en las casillas de al lado? Si es que sí, el
        // saliente de roca puede cruzar la junta; si no, hay que apagarlo en ese
        // extremo o se abriría una grieta en la esquina.
        const continuaInicio = mismaPared(mapa, cx - lado.tx, cz - lado.tz, lado, nivel, nivelVecino);
        const continuaFinal = mismaPared(mapa, cx + lado.tx, cz + lado.tz, lado, nivel, nivelVecino);

        const segH = 2;
        const segV = Math.max(2, Math.round((caida / ALTURA_ESCALON) * 2));
        const primero = siguiente;

        for (let j = 0; j <= segV; j++) {
          // fv = 0 arriba, 1 abajo.
          const fv = j / segV;
          for (let k = 0; k <= segH; k++) {
            const t = k / segH;
            const x = (cx + lado.ax + (lado.bx - lado.ax) * t) * TAM_CASILLA;
            const z = (cz + lado.az + (lado.bz - lado.az) * t) * TAM_CASILLA;
            const desplazado = relieve.microEn(x, z) - relieve.hundimientoEn(x, z);
            const yArriba = alturaBase + desplazado;
            const yAbajo = alturaVecino + desplazado;
            let y = yArriba + (yAbajo - yArriba) * fv;

            // Saliente: la roca se abomba hacia fuera según se baja, nunca arriba.
            const rugosidad = ruidoFractal((x + z) * 1.35, y * 2.4, 2, 0.5, 2, 271);
            // Perfil de la pared: nace pegada a la cornisa, se abomba en el tercio
            // superior —la ceja de roca que da sombra al muro— y vuelve a meterse
            // hacia dentro al llegar al pie.
            let fade = pasoSuave(0, 0.34, fv) * (1 - pasoSuave(0.55, 1, fv) * 0.55);
            if (!continuaInicio) fade *= pasoSuave(0, 0.3, t);
            if (!continuaFinal) fade *= pasoSuave(0, 0.3, 1 - t);
            const saliente = (0.3 + rugosidad * 0.7) * SALIENTE_PARED * fade;
            if (j === segV) y -= 0.03; // el pie se entierra: nada de muros flotando

            // Pesos: roca con algo de tierra, y la hierba desbordando la cornisa.
            const flecoHierba = 0.45 + ruidoFractal(x * 2.1, z * 2.1, 2, 0.5, 2, 517) * 1.35;
            const cornisa = flecoHierba * (1 - pasoSuave(0.03, 0.16 + flecoHierba * 0.26, fv));
            const w0 = cornisa;
            const w1 = 0.18 + fv * 0.22;
            const w2 = 1;
            const w3 = 0.04;
            const suma = w0 + w1 + w2 + w3;

            // Oclusión: penumbra en la base del muro, luz en la cornisa.
            const ao = oclusionCima * (0.28 + 0.72 * pasoSuave(0.95, 0.15, fv));

            empujar(
              x + lado.nx * saliente,
              y,
              z + lado.nz * saliente,
              lado.nx,
              0,
              lado.nz,
              w0 / suma,
              w1 / suma,
              w2 / suma,
              w3 / suma,
              ao,
              relieve.matizEn(x, z),
            );
          }
        }

        const fila = segH + 1;
        for (let j = 0; j < segV; j++) {
          for (let k = 0; k < segH; k++) {
            const a = primero + j * fila + k;
            const b = a + 1;
            const c = a + fila + 1;
            const d = a + fila;
            indices.push(a, b, c, a, c, d);
          }
        }
      }
    }
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  geometria.setAttribute('pesos', new THREE.Float32BufferAttribute(pesosVert, 4));
  geometria.setAttribute('extra', new THREE.Float32BufferAttribute(extras, 2));
  geometria.setIndex(indices);
  geometria.computeBoundingSphere();
  geometria.computeBoundingBox();

  const material = crearMaterialTerreno(calidad);

  const malla = new THREE.Mesh(geometria, material);
  malla.name = 'terreno';
  malla.receiveShadow = true;
  // Los acantilados proyectando sombra sobre la llanura son media lectura del
  // relieve; en gama baja no hay sombras que valgan, así que ni se intenta.
  malla.castShadow = calidad.resolucionSombras > 0;
  malla.matrixAutoUpdate = false;
  malla.updateMatrix();

  return {
    malla,
    geometria,
    material,
    actualizar(dt: number): void {
      void dt;
    },
    liberar(): void {
      geometria.dispose();
      material.dispose();
    },
  };
}

/** ¿La casilla vecina genera exactamente la misma pared en el mismo lado? */
function mismaPared(
  mapa: MapaJuego,
  cx: number,
  cz: number,
  lado: Lados,
  nivel: number,
  nivelVecino: number,
): boolean {
  if (!mapa.dentro(cx, cz)) return false;
  if (mapa.nivelEn(cx, cz) !== nivel) return false;
  const ox = cx + lado.dx;
  const oz = cz + lado.dz;
  const nivelOtro = mapa.dentro(ox, oz) ? mapa.nivelEn(ox, oz) : 0;
  return nivelOtro === nivelVecino;
}

// --- Material -----------------------------------------------------------------

function crearMaterialTerreno(calidad: CalidadRender): THREE.MeshStandardMaterial {
  const atlas = crearAtlasTerreno(calidad);
  const macro = crearTexturaMacro(calidad);
  const conNormales = calidad.nivel !== 'bajo';

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    name: 'terreno',
  });

  const uniformes = {
    mapaAlbedo: { value: atlas.albedo },
    mapaNormal: { value: atlas.normal },
    mapaMacro: { value: macro },
    rugosidadCapa: {
      value: new THREE.Vector4(
        RUGOSIDAD_CAPA[CAPA_HIERBA],
        RUGOSIDAD_CAPA[CAPA_TIERRA],
        RUGOSIDAD_CAPA[CAPA_ROCA],
        RUGOSIDAD_CAPA[CAPA_ARENA],
      ),
    },
    // Una repetición cada ~94 casillas: en un mapa de 96 no llega a repetirse.
    escalaMacro: { value: 1 / 94 },
    // Periodo de la deriva: 13 casillas, cuatro veces el del mosaico.
    escalaDeriva: { value: 1 / 13 },
    fuerzaNormal: { value: conNormales ? 1.15 : 0 },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformes);

    shader.vertexShader = `
      attribute vec4 pesos;
      attribute vec2 extra;
      varying vec4 vPesos;
      varying vec2 vExtra;
      varying vec3 vMundo;
      varying vec3 vNormalMundo;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vPesos = pesos;
       vExtra = extra;
       vMundo = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vNormalMundo = normalize(mat3(modelMatrix) * objectNormal);`,
    );

    shader.fragmentShader = `
      precision highp sampler2DArray;
      uniform sampler2DArray mapaAlbedo;
      uniform sampler2DArray mapaNormal;
      uniform sampler2D mapaMacro;
      uniform vec4 rugosidadCapa;
      uniform float escalaMacro;
      uniform float escalaDeriva;
      uniform float fuerzaNormal;
      varying vec4 vPesos;
      varying vec2 vExtra;
      varying vec3 vMundo;
      varying vec3 vNormalMundo;
      vec4 mezclaCapas;
      vec2 uvTerreno;
      vec3 ejeT;
      vec3 ejeB;
      vec3 ejeN;
    ` + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `
        // Marco tangente deducido de la propia normal: en las caras horizontales la
        // U corre con la X y la V con la Z; en las paredes la V es la altura del
        // mundo, que es lo que pone los estratos de la roca en horizontal.
        ejeN = normalize(vNormalMundo);
        float esSuelo = step(0.5, abs(ejeN.y));
        ejeT = esSuelo > 0.5 ? vec3(1.0, 0.0, 0.0) : normalize(vec3(-ejeN.z, 0.0, ejeN.x));
        ejeB = cross(ejeT, ejeN);
        uvTerreno = esSuelo > 0.5
          ? vMundo.xz * ${ESCALA_UV_SUELO.toFixed(4)}
          : vec2(dot(vMundo.xz, ejeT.xz), vMundo.y) * ${ESCALA_UV_PARED.toFixed(4)};

        vec3 macro = texture(mapaMacro, vMundo.xz * escalaMacro).rgb;

        // Deformación del dominio. El mosaico del atlas se repite cada tres
        // casillas y, alineado en rejilla, el ojo lo caza de inmediato; empujando
        // las coordenadas con un ruido de periodo mucho mayor, la repetición sigue
        // ahí pero deja de estar alineada y desaparece como patrón.
        vec3 deriva = texture(mapaMacro, vMundo.xz * escalaDeriva).rgb;
        uvTerreno += (deriva.rg - 0.5) * 0.85;

        // El macro empuja los pesos: sin él las transiciones serían óvalos suaves y
        // regulares, que es tan artificial como el corte a cuchillo.
        vec4 w = vPesos;
        w.x *= 0.42 + macro.r * 1.45;
        w.y *= 0.50 + macro.g * 1.20;
        w.z *= 0.62 + macro.b * 0.85;
        w.w *= 0.70 + macro.g * 0.65;
        w = max(w, vec4(0.0));
        w /= max(dot(w, vec4(1.0)), 1e-4);

        vec4 c0 = texture(mapaAlbedo, vec3(uvTerreno, 0.0));
        vec4 c1 = texture(mapaAlbedo, vec3(uvTerreno, 1.0));
        vec4 c2 = texture(mapaAlbedo, vec3(uvTerreno, 2.0));
        vec4 c3 = texture(mapaAlbedo, vec3(uvTerreno, 3.0));

        // Mezcla por altura de material: gana quien sobresale, y el reparto se
        // aprieta alrededor del líder. Es la diferencia entre una transición con
        // dientes creíbles y un degradado de aerógrafo.
        vec4 alturasMat = vec4(c0.a, c1.a, c2.a, c3.a);
        vec4 b = w * (0.26 + alturasMat * 1.25);
        float pico = max(max(b.x, b.y), max(b.z, b.w));
        b = max(b - (pico - 0.30), 0.0);
        b /= max(dot(b, vec4(1.0)), 1e-4);
        mezclaCapas = b;

        vec3 albedoT = c0.rgb * b.x + c1.rgb * b.y + c2.rgb * b.z + c3.rgb * b.w;

        // Tinte de gran escala: manchas de terreno más seco y más húmedo que no se
        // repiten en todo el mapa.
        albedoT *= mix(vec3(0.80, 0.85, 0.93), vec3(1.16, 1.11, 0.95), macro.r);
        albedoT *= 1.0 + (vExtra.y - 0.5) * 0.16;
        albedoT *= mix(1.0, vExtra.x, 0.95);

        diffuseColor.rgb *= albedoT;
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = dot(mezclaCapas, rugosidadCapa) * (0.88 + macro.b * 0.2);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        conNormales
          ? `
        vec4 n0 = texture(mapaNormal, vec3(uvTerreno, 0.0));
        vec4 n1 = texture(mapaNormal, vec3(uvTerreno, 1.0));
        vec4 n2 = texture(mapaNormal, vec3(uvTerreno, 2.0));
        vec4 n3 = texture(mapaNormal, vec3(uvTerreno, 3.0));
        vec3 nm = n0.rgb * mezclaCapas.x + n1.rgb * mezclaCapas.y
                + n2.rgb * mezclaCapas.z + n3.rgb * mezclaCapas.w;
        vec3 tn = nm * 2.0 - 1.0;
        tn.xy *= fuerzaNormal;
        vec3 nMundo = normalize(ejeT * tn.x + ejeB * tn.y + ejeN * tn.z);
        normal = normalize((viewMatrix * vec4(nMundo, 0.0)).xyz);

        float aoDetalle = dot(vec4(n0.a, n1.a, n2.a, n3.a), mezclaCapas);
        diffuseColor.rgb *= mix(1.0, aoDetalle, 0.8);
        `
          : '',
      );
  };

  // Cambia el programa respecto al material estándar: sin una clave propia, three
  // podría reutilizar el programa de otro material y el terreno saldría liso.
  material.customProgramCacheKey = () => `terreno-${conNormales ? 'n' : 'p'}`;

  return material;
}

/**
 * DEFECTO CONOCIDO, sin resolver — diagnosticado 2026-08-03, pendiente de arreglo.
 *
 * La malla tiene 556 aristas «abiertas» (sin pareja) estrictamente dentro del
 * mapa, no en su perímetro. Reproducible con http://localhost:5173/?semilla=555555.
 *
 * Se ha aislado el patrón: aparecen en esquinas CÓNCAVAS del acantilado, donde una
 * casilla baja tiene DOS vecinos cardinales más altos a la vez (p. ej. niveles
 *   2 2 .
 *   2 1 1
 *   . 1 1
 * con la casilla central en (1,1) del recorte). Las dos paredes que deberían
 * encontrarse en el vértice compartido de esa esquina no coinciden en posición.
 *
 * Se ha descartado como causa el pie enterrado de las paredes (el descenso de
 * -0.03 al pie, intencionado, ver comentario «el pie se entierra» más arriba):
 * ese hueco es un solape, no una grieta, y no debería verse. El hueco real
 * detectado tiene otra naturaleza y aparece en el borde SUPERIOR de la pared
 * (fv=0, altura = nivel * ALTURA_ESCALON exacta), que en teoría debería coincidir
 * bit a bit con el borde de la cara superior de la casilla vecina.
 *
 * Herramienta de diagnóstico: cargar el juego, recorrer `geometria.index` en
 * tripletes, contar cuántos triángulos referencian cada arista por posición
 * (redondeada a 3 decimales) de sus dos vértices; una arista con recuento 1 y
 * cuyas coordenadas caen dentro del mapa (no en el perímetro sellado) es un
 * hueco real. Se puede repetir con Playwright + `tools/capturar.mjs` como base.
 *
 * No se ha aplicado ningún parche a ciegas: la función que genera las paredes
 * (`construirTerreno`, sección «Paredes de acantilado», y `mismaPared`) es densa
 * y modificarla sin terminar de entender el caso de esquina cóncava con dos
 * paredes convergentes se arriesgaba a cambiar el aspecto de todo el acantilado
 * para peor. Queda para quien retome este módulo.
 */
