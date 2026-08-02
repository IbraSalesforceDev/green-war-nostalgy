import * as THREE from 'three';
import { ALTURA_ESCALON, TAM_CASILLA } from '../sim/constantes';
import { TipoCasilla } from '../sim/tipos';
import type { MapaJuego } from '../sim/mapa';
import { hash2 } from '../core/math';

/**
 * Malla del terreno.
 *
 * Construye una sola geometría con todo el suelo y todas las caras de acantilado.
 * Una sola llamada de dibujado para 9.216 casillas: en un móvil, el número de
 * llamadas pesa más que el número de triángulos, así que fusionarlo todo es la
 * optimización que más rinde.
 *
 * El color va en los vértices en vez de en una textura. Permite mezclar hierba,
 * tierra y roca sin costuras y sin gastar memoria de texturas, que es justo el
 * recurso escaso en gama baja.
 */

/** Paleta base por tipo de casilla, en espacio lineal. */
const COLORES: Record<TipoCasilla, [number, number, number]> = {
  [TipoCasilla.HIERBA]: [0.24, 0.38, 0.16],
  [TipoCasilla.TIERRA]: [0.36, 0.27, 0.16],
  [TipoCasilla.CAMINO]: [0.42, 0.36, 0.26],
  [TipoCasilla.ROCA]: [0.3, 0.29, 0.27],
  [TipoCasilla.AGUA_BAJA]: [0.16, 0.28, 0.3],
  [TipoCasilla.AGUA_PROFUNDA]: [0.08, 0.16, 0.22],
  [TipoCasilla.BOSQUE]: [0.16, 0.28, 0.12],
  [TipoCasilla.ACANTILADO]: [0.33, 0.3, 0.25],
};

const COLOR_PARED_ACANTILADO: [number, number, number] = [0.27, 0.24, 0.2];

export interface TerrenoConstruido {
  malla: THREE.Mesh;
  geometria: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  liberar(): void;
}

export function construirTerreno(mapa: MapaJuego): TerrenoConstruido {
  const posiciones: number[] = [];
  const normales: number[] = [];
  const colores: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let baseVertice = 0;

  const empujarVertice = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    r: number,
    g: number,
    b: number,
    u: number,
    v: number,
  ): void => {
    posiciones.push(x, y, z);
    normales.push(nx, ny, nz);
    colores.push(r, g, b);
    uvs.push(u, v);
  };

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      const tipo = mapa.casillas[i] as TipoCasilla;
      const altura = mapa.niveles[i] * ALTURA_ESCALON;

      const base = COLORES[tipo] ?? COLORES[TipoCasilla.HIERBA];

      // Variación por casilla: sin ella un prado grande se ve como una lámina plana
      // de plástico verde. Un ±8 % de luminosidad basta para que parezca terreno.
      const ruido = hash2(cx, cz, 17) * 0.16 - 0.08;
      const r = Math.max(0, base[0] * (1 + ruido));
      const g = Math.max(0, base[1] * (1 + ruido));
      const b = Math.max(0, base[2] * (1 + ruido));

      const x0 = cx * TAM_CASILLA;
      const z0 = cz * TAM_CASILLA;
      const x1 = x0 + TAM_CASILLA;
      const z1 = z0 + TAM_CASILLA;

      // Cara superior
      empujarVertice(x0, altura, z0, 0, 1, 0, r, g, b, 0, 0);
      empujarVertice(x1, altura, z0, 0, 1, 0, r, g, b, 1, 0);
      empujarVertice(x1, altura, z1, 0, 1, 0, r, g, b, 1, 1);
      empujarVertice(x0, altura, z1, 0, 1, 0, r, g, b, 0, 1);
      indices.push(
        baseVertice, baseVertice + 2, baseVertice + 1,
        baseVertice, baseVertice + 3, baseVertice + 2,
      );
      baseVertice += 4;

      // Paredes hacia los vecinos más bajos.
      baseVertice = anadirParedes(
        mapa, cx, cz, altura, x0, z0, x1, z1,
        empujarVertice, indices, baseVertice,
      );
    }
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  geometria.setAttribute('color', new THREE.Float32BufferAttribute(colores, 3));
  geometria.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometria.setIndex(indices);
  geometria.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.94,
    metalness: 0,
    flatShading: false,
  });

  const malla = new THREE.Mesh(geometria, material);
  malla.name = 'terreno';
  malla.receiveShadow = true;
  malla.castShadow = false;
  malla.matrixAutoUpdate = false;
  malla.updateMatrix();

  return {
    malla,
    geometria,
    material,
    liberar() {
      geometria.dispose();
      material.dispose();
    },
  };
}

/** Genera las cuatro caras verticales de una casilla hacia sus vecinos más bajos. */
function anadirParedes(
  mapa: MapaJuego,
  cx: number,
  cz: number,
  altura: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  empujar: (
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    r: number, g: number, b: number,
    u: number, v: number,
  ) => void,
  indices: number[],
  baseVertice: number,
): number {
  const nivel = mapa.nivelEn(cx, cz);
  const [pr, pg, pb] = COLOR_PARED_ACANTILADO;

  const vecinos: Array<{
    dx: number;
    dz: number;
    ax: number; az: number;
    bx: number; bz: number;
    nx: number; nz: number;
  }> = [
    { dx: 0, dz: -1, ax: x0, az: z0, bx: x1, bz: z0, nx: 0, nz: -1 },
    { dx: 1, dz: 0, ax: x1, az: z0, bx: x1, bz: z1, nx: 1, nz: 0 },
    { dx: 0, dz: 1, ax: x1, az: z1, bx: x0, bz: z1, nx: 0, nz: 1 },
    { dx: -1, dz: 0, ax: x0, az: z1, bx: x0, bz: z0, nx: -1, nz: 0 },
  ];

  for (const vecino of vecinos) {
    const nivelVecino = mapa.dentro(cx + vecino.dx, cz + vecino.dz)
      ? mapa.nivelEn(cx + vecino.dx, cz + vecino.dz)
      : 0;
    if (nivelVecino >= nivel) continue;

    const alturaVecino = nivelVecino * ALTURA_ESCALON;
    const caida = altura - alturaVecino;

    // Un leve oscurecimiento por altura da lectura de volumen sin depender de la luz.
    const sombra = 1 - Math.min(0.25, caida * 0.12);

    empujar(vecino.ax, altura, vecino.az, vecino.nx, 0, vecino.nz, pr * sombra, pg * sombra, pb * sombra, 0, caida);
    empujar(vecino.bx, altura, vecino.bz, vecino.nx, 0, vecino.nz, pr * sombra, pg * sombra, pb * sombra, 1, caida);
    empujar(vecino.bx, alturaVecino, vecino.bz, vecino.nx, 0, vecino.nz, pr * sombra * 0.7, pg * sombra * 0.7, pb * sombra * 0.7, 1, 0);
    empujar(vecino.ax, alturaVecino, vecino.az, vecino.nx, 0, vecino.nz, pr * sombra * 0.7, pg * sombra * 0.7, pb * sombra * 0.7, 0, 0);

    indices.push(
      baseVertice, baseVertice + 1, baseVertice + 2,
      baseVertice, baseVertice + 2, baseVertice + 3,
    );
    baseVertice += 4;
  }

  return baseVertice;
}
