import * as THREE from 'three';
import { TAM_CASILLA } from '../sim/constantes';
import { TipoCasilla } from '../sim/tipos';
import type { MapaJuego } from '../sim/mapa';
import { hash2, ruidoFractal } from '../core/math';
import type { CalidadRender } from './renderizador';
import { calidadPara } from './renderizador';
import { construirRelieve } from './terreno';
import { crearSpriteVegetacion, type ClaseVegetacion } from './texturas';

/**
 * Cubierta vegetal: matas de hierba, helechos y flores.
 *
 * Es el detalle que separa un prado de una alfombra verde. Se resuelve con tres
 * `InstancedMesh` —una por clase de planta—, o sea **tres llamadas de dibujado para
 * varios miles de plantas**, con el balanceo del viento calculado en el sombreador
 * de vértices y sin tocar la CPU en ningún fotograma.
 *
 * Decisiones que merecen explicación:
 *
 *   · **Dos cuadros cruzados en aspa** en lugar de una cartelera orientada a la
 *     cámara. La cámara de un RTS gira, y una cartelera obliga a reconstruir todas
 *     las matrices al girar; el aspa se ve razonable desde cualquier ángulo y no
 *     cuesta nada. Son cuatro triángulos por planta.
 *   · **Normal hacia arriba** en todos los vértices. Físicamente es mentira, pero
 *     hace que la hierba reciba la misma luz que el suelo sobre el que crece; con
 *     la normal real del cuadro, la mitad de las matas quedarían negras.
 *   · **Recorte por distancia en el sombreador**: las instancias lejanas se escalan
 *     a cero desde su base y desaparecen sin un solo cálculo en la CPU. El umbral
 *     lo marca `calidad.distanciaVegetacion`.
 *   · La densidad se decide una sola vez, al construir, según el nivel del
 *     dispositivo: en gama baja hay una décima parte de plantas que en gama alta.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearVegetacion(mapa, calidad?): Vegetacion
 *     · raiz: THREE.Group con las tres mallas instanciadas
 *     · objetos: THREE.InstancedMesh[]   (una por clase)
 *     · total: número de plantas colocadas
 *     · actualizar(dt): avanza el viento
 *     · liberar(): suelta geometrías y materiales
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface Vegetacion {
  raiz: THREE.Group;
  objetos: THREE.InstancedMesh[];
  total: number;
  actualizar(dt: number): void;
  liberar(): void;
}

interface AjusteClase {
  clase: ClaseVegetacion;
  /** Reparto sobre el total de plantas. */
  cuota: number;
  escalaMin: number;
  escalaMax: number;
  /** Fuerza del balanceo. Una flor alta se dobla más que una mata rasa. */
  viento: number;
}

const CLASES: AjusteClase[] = [
  { clase: 'hierba', cuota: 0.62, escalaMin: 0.32, escalaMax: 0.58, viento: 0.1 },
  { clase: 'helecho', cuota: 0.24, escalaMin: 0.46, escalaMax: 0.82, viento: 0.07 },
  { clase: 'flor', cuota: 0.14, escalaMin: 0.26, escalaMax: 0.46, viento: 0.13 },
];

/** Plantas por casilla de hierba, según la potencia del aparato. */
function densidadPara(calidad: CalidadRender): number {
  if (calidad.nivel === 'alto') return 1.5;
  if (calidad.nivel === 'medio') return 0.85;
  return 0.28;
}

export function crearVegetacion(
  mapa: MapaJuego,
  calidad: CalidadRender = calidadPara('medio'),
): Vegetacion {
  const relieve = construirRelieve(mapa);
  const densidad = densidadPara(calidad);

  // --- Siembra ---
  interface Planta {
    x: number;
    z: number;
    y: number;
    giro: number;
    escala: number;
    tono: number;
    clase: number;
  }
  const plantas: Planta[][] = [[], [], []];

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      const tipo = mapa.casillas[i] as TipoCasilla;
      if (tipo !== TipoCasilla.HIERBA && tipo !== TipoCasilla.BOSQUE) continue;
      if (mapa.rampas[i] === 1) continue;

      // Manchas de vegetación: la hierba no crece repartida a regla, crece a
      // rodales. El ruido decide dónde el prado es espeso y dónde está pelado.
      const espesura = ruidoFractal(cx * 0.16, cz * 0.16, 3, 0.55, 2, 733);
      const cuantas = densidad * (0.25 + espesura * 1.6);
      const entera = Math.floor(cuantas);
      const resto = cuantas - entera;
      const total = entera + (hash2(cx, cz, 41) < resto ? 1 : 0);
      if (total <= 0) continue;

      // Los ramos de flores se agrupan en claros concretos, no salpicados.
      const floral = ruidoFractal(cx * 0.09 + 40, cz * 0.09 + 40, 2, 0.5, 2, 811);

      for (let k = 0; k < total; k++) {
        // Semillas bien separadas por planta: con `cx * 7 + k` los índices de
        // casillas vecinas colisionan y la siembra sale en hileras diagonales.
        const s0 = k * 9173;
        const hx = hash2(cx, cz, s0 + 101);
        const hz = hash2(cx, cz, s0 + 2111);
        const hc = hash2(cx, cz, s0 + 3307);
        const hs = hash2(cx, cz, s0 + 4401);
        const hg = hash2(cx, cz, s0 + 5503);

        const x = (cx + 0.08 + hx * 0.84) * TAM_CASILLA;
        const z = (cz + 0.08 + hz * 0.84) * TAM_CASILLA;

        let clase = 0;
        if (hc > 0.62 + floral * 0.2) clase = 1;
        if (floral > 0.62 && hc < 0.22) clase = 2;

        const ajuste = CLASES[clase];
        plantas[clase].push({
          x,
          z,
          // Un par de centímetros enterrada: si la base queda justo en la cota del
          // suelo, el más leve desnivel deja ver la planta flotando.
          y: relieve.alturaEn(x, z) - 0.02,
          giro: hg * Math.PI * 2,
          escala: ajuste.escalaMin + hs * (ajuste.escalaMax - ajuste.escalaMin),
          tono: hash2(cx, cz, s0 + 6601),
          clase,
        });
      }
    }
  }

  // --- Mallas instanciadas ---
  const raiz = new THREE.Group();
  raiz.name = 'vegetacion';

  const objetos: THREE.InstancedMesh[] = [];
  const materiales: THREE.MeshStandardMaterial[] = [];
  const geometrias: THREE.BufferGeometry[] = [];
  const uniformesPorClase: Array<{ tiempo: { value: number } }> = [];

  const matriz = new THREE.Matrix4();
  const cuaternio = new THREE.Quaternion();
  const eje = new THREE.Vector3(0, 1, 0);
  const posicion = new THREE.Vector3();
  const escalaVec = new THREE.Vector3();
  const color = new THREE.Color();

  let colocadas = 0;

  for (let c = 0; c < CLASES.length; c++) {
    const lista = plantas[c];
    if (lista.length === 0) continue;
    const ajuste = CLASES[c];

    const geometria = crearAspa();
    const textura = crearSpriteVegetacion(ajuste.clase, calidad);

    const uniformes = {
      tiempo: { value: 0 },
      distanciaCorte: { value: calidad.distanciaVegetacion },
      fuerzaViento: { value: ajuste.viento },
    };

    const material = new THREE.MeshStandardMaterial({
      name: `vegetacion-${ajuste.clase}`,
      map: textura,
      // Recorte por alfa en vez de mezcla: se dibuja como opaco, escribe
      // profundidad y no hay que ordenar miles de instancias por distancia.
      alphaTest: 0.35,
      transparent: false,
      side: THREE.DoubleSide,
      roughness: 0.93,
      metalness: 0,
    });

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniformes);
      shader.vertexShader = `
        uniform float tiempo;
        uniform float distanciaCorte;
        uniform float fuerzaViento;
      ` + shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec3 anclaMundo = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

         // Nivel de detalle: lo que queda lejos se encoge hasta desaparecer desde
         // su propia base, sin saltos y sin tocar la CPU.
         float lejania = distance(cameraPosition, anclaMundo);
         float visible = 1.0 - smoothstep(distanciaCorte * 0.78, distanciaCorte, lejania);

         // La base del recorte está en v = 1 y la punta en v = 0.
         float altura = 1.0 - uv.y;
         float fase = anclaMundo.x * 0.7 + anclaMundo.z * 0.55;
         float racha = sin(tiempo * 1.55 + fase) * 0.62 + sin(tiempo * 2.7 + fase * 1.9) * 0.38;
         transformed.x += racha * altura * altura * fuerzaViento;
         transformed *= visible;`,
      );
    };

    material.customProgramCacheKey = () => 'vegetacion';

    const malla = new THREE.InstancedMesh(geometria, material, lista.length);
    malla.name = `vegetacion-${ajuste.clase}`;
    malla.castShadow = false;
    malla.receiveShadow = calidad.resolucionSombras > 0;
    malla.frustumCulled = false;
    malla.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    for (let k = 0; k < lista.length; k++) {
      const planta = lista[k];
      posicion.set(planta.x, planta.y, planta.z);
      cuaternio.setFromAxisAngle(eje, planta.giro);
      escalaVec.setScalar(planta.escala);
      matriz.compose(posicion, cuaternio, escalaVec);
      malla.setMatrixAt(k, matriz);

      // Variación de tono planta a planta: sin ella, mil copias del mismo recorte
      // se leen como un patrón repetido por más que cambien de tamaño.
      const verdor = 0.82 + planta.tono * 0.36;
      color.setRGB(verdor * (0.94 + planta.tono * 0.12), verdor, verdor * 0.88);
      malla.setColorAt(k, color);
    }
    malla.instanceMatrix.needsUpdate = true;
    if (malla.instanceColor) malla.instanceColor.needsUpdate = true;
    malla.computeBoundingSphere();

    raiz.add(malla);
    objetos.push(malla);
    materiales.push(material);
    geometrias.push(geometria);
    uniformesPorClase.push(uniformes);
    colocadas += lista.length;
  }

  let reloj = 0;

  return {
    raiz,
    objetos,
    total: colocadas,
    actualizar(dt: number): void {
      reloj += dt;
      for (const u of uniformesPorClase) u.tiempo.value = reloj;
    },
    liberar(): void {
      for (const malla of objetos) malla.dispose();
      for (const material of materiales) material.dispose();
      for (const geometria of geometrias) geometria.dispose();
      raiz.clear();
    },
  };
}

/**
 * Dos cuadros cruzados en aspa, con la base en el origen y una unidad de alto.
 * La V de la textura vale 1 en la base porque los recortes de `texturas.ts` se
 * rasterizan con la planta apoyada en la última fila del búfer.
 */
function crearAspa(): THREE.BufferGeometry {
  const posiciones = [
    -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0,
    0, 0, -0.5, 0, 0, 0.5, 0, 1, 0.5, 0, 1, -0.5,
  ];
  const uvs = [
    0, 1, 1, 1, 1, 0, 0, 0,
    0, 1, 1, 1, 1, 0, 0, 0,
  ];
  const normales: number[] = [];
  for (let i = 0; i < 8; i++) normales.push(0, 1, 0);
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  geometria.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometria.setIndex(indices);
  return geometria;
}
