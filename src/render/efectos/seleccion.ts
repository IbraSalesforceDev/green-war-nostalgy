import * as THREE from 'three';
import { bus } from '../../core/events';
import { Bando, Clase, ENTIDAD_NULA, indiceDe } from '../../sim/tipos';
import type { Mundo } from '../../sim/mundo';
import type { SesionJuego } from '../../estado/sesion';
import type { CalidadRender } from '../renderizador';

/**
 * Selección, resaltado, marcador de órdenes y barras de vida flotantes.
 *
 * Cuatro piezas independientes que comparten un mismo principio: son lectura de
 * estado, nunca simulación. Todo lo que dibujan sale de `mundo` (posiciones, vida,
 * bando) y de `sesion` (qué hay seleccionado, qué hay bajo el cursor); ninguna de
 * las dos cambia por culpa de este módulo.
 *
 * ── Anillo de selección ceñido al relieve ───────────────────────────────────────
 * Un disco plano flotando sobre una ladera se separa visualmente del suelo y
 * delata el truco. Cada anillo muestrea `mapa.alturaEnMundo` en cada uno de sus
 * vértices y se reconstruye —solo su búfer de posiciones, no la malla— en cada
 * fotograma: barato (unas pocas decenas de vértices por unidad seleccionada) y
 * exacto en cualquier pendiente.
 *
 * ── Barras de vida sin gastar un `draw call` por unidad ────────────────────────
 * Con un ejército grande, una barra por `THREE.Sprite` (dos sprites: fondo y
 * relleno) multiplicaría los `draw calls` por el doble del número de heridos. En
 * su lugar hay dos `InstancedMesh` —uno para el fondo, uno para el relleno— y cada
 * barra es una instancia con su propio centro, tamaño, color y fracción de vida,
 * todo resuelto en el sombreador de vértices reconstruyendo los ejes de cámara a
 * partir de `viewMatrix`: el mismo truco de *billboard* que usa un sistema de
 * partículas, aplicado a un cuadro en vez de a un punto. Resultado: cientos de
 * barras, dos llamadas de dibujo.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearSistemaSeleccion(escena, mundo, sesion, calidad): SistemaSeleccion
 *     · raiz: THREE.Group con anillos, marcador y barras
 *     · actualizar(dt, alfa): sincroniza todo con el mundo y la sesión de este fotograma
 *     · liberar(): se da de baja del bus y suelta toda la geometría
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface SistemaSeleccion {
  readonly raiz: THREE.Group;
  actualizar(dt: number, alfa: number): void;
  liberar(): void;
}

const COLOR_BANDO_SELECCION: Record<number, number> = {
  [Bando.NEUTRAL]: 0xd8b23a,
  [Bando.HUMANOS]: 0x4da6ff,
  [Bando.ORCOS]: 0xff5a40,
};

const SEGMENTOS_ANILLO = 22;
const DESPLAZAMIENTO_ANILLO = 0.025;

/** Cuántas barras de vida y marcadores de orden caben a la vez, según la calidad. */
function capacidadesPara(calidad: CalidadRender): { barras: number; marcadores: number } {
  if (calidad.nivel === 'alto') return { barras: 128, marcadores: 12 };
  if (calidad.nivel === 'medio') return { barras: 80, marcadores: 10 };
  return { barras: 40, marcadores: 6 };
}

// --- Anillo ceñido al terreno ---------------------------------------------------

interface AnilloTerreno {
  malla: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Reescribe las posiciones de la franja centrada en (x, z). */
  reubicar(mundo: Mundo, x: number, z: number, radioInterior: number, radioExterior: number): void;
}

function crearAnilloTerreno(color: number, opacidad: number): AnilloTerreno {
  const cuenta = (SEGMENTOS_ANILLO + 1) * 2;
  const posiciones = new Float32Array(cuenta * 3);
  const indices: number[] = [];
  for (let s = 0; s < SEGMENTOS_ANILLO; s++) {
    const a = s * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
  const normales = new Float32Array(cuenta * 3);
  for (let i = 1; i < normales.length; i += 3) normales[i] = 1;
  geometria.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
  geometria.setIndex(indices);

  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: opacidad,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });

  const malla = new THREE.Mesh(geometria, material);
  malla.matrixAutoUpdate = false;
  malla.visible = false;

  return {
    malla,
    material,
    reubicar(mundo, x, z, radioInterior, radioExterior): void {
      const pos = geometria.attributes.position as THREE.BufferAttribute;
      for (let s = 0; s <= SEGMENTOS_ANILLO; s++) {
        const ang = (s / SEGMENTOS_ANILLO) * Math.PI * 2;
        const cos = Math.cos(ang);
        const sin = Math.sin(ang);

        const xi = x + cos * radioInterior;
        const zi = z + sin * radioInterior;
        const xo = x + cos * radioExterior;
        const zo = z + sin * radioExterior;

        const base = s * 2;
        pos.setXYZ(base, xi, mundo.mapa.alturaEnMundo(xi, zi) + DESPLAZAMIENTO_ANILLO, zi);
        pos.setXYZ(base + 1, xo, mundo.mapa.alturaEnMundo(xo, zo) + DESPLAZAMIENTO_ANILLO, zo);
      }
      pos.needsUpdate = true;
    },
  };
}

// --- Marcador de orden -----------------------------------------------------------

interface MarcadorOrden {
  malla: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  activo: boolean;
  nacimiento: number;
}

const DURACION_MARCADOR = 0.55;
const COLOR_ORDEN_MOVER = 0x6bcf5a;
const COLOR_ORDEN_ATACAR = 0xe0503c;

function crearGeometriaMarcador(): THREE.BufferGeometry {
  // Un anillo plano centrado en el origen local; se posiciona y escala por instancia.
  const geometria = new THREE.RingGeometry(0.55, 0.72, 24);
  geometria.rotateX(-Math.PI / 2);
  return geometria;
}

// --- Barras de vida (billboard por instancia) ------------------------------------

interface SistemaBarras {
  fondo: THREE.InstancedMesh;
  relleno: THREE.InstancedMesh;
  centro: Float32Array;
  tamano: Float32Array;
  color: Float32Array;
  fraccion: Float32Array;
  slotDeIndice: Map<number, number>;
  libres: number[];
}

function inyectarBillboardBarra(material: THREE.MeshBasicMaterial, conFraccion: boolean): void {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `
      attribute vec3 aCentro;
      attribute vec2 aTamano;
      ${conFraccion ? 'attribute float aFraccion;\nattribute vec3 aColor;\nvarying vec3 vColorBarra;' : ''}
    ` +
      shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        vec3 derechaCam = vec3(viewMatrix[0].x, viewMatrix[1].x, viewMatrix[2].x);
        vec3 arribaCam = vec3(viewMatrix[0].y, viewMatrix[1].y, viewMatrix[2].y);
        float fraccionBarra = ${conFraccion ? 'aFraccion' : '1.0'};
        vec3 posMundo = aCentro
          + derechaCam * (-aTamano.x * 0.5 + position.x * aTamano.x * fraccionBarra)
          + arribaCam * (position.y * aTamano.y);
        vec4 mvPosition = viewMatrix * vec4(posMundo, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        ${conFraccion ? 'vColorBarra = aColor;' : ''}
        `,
      );

    if (conFraccion) {
      shader.fragmentShader =
        `varying vec3 vColorBarra;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
           diffuseColor.rgb = vColorBarra;`,
        );
    }
  };
  material.customProgramCacheKey = () => `barra-vida-${conFraccion ? 'r' : 'f'}`;
}

function crearGeometriaBarra(): THREE.BufferGeometry {
  // Cuadro unidad con el pivote en el borde izquierdo (x en [0,1]): crece hacia la
  // derecha, que es justo lo que necesita el billboard para anclar el lado fijo.
  const posiciones = new Float32Array([0, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, 0, 0.5, 0]);
  const indices = [0, 1, 2, 0, 2, 3];
  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
  geometria.setIndex(indices);
  geometria.computeBoundingSphere();
  return geometria;
}

function crearSistemaBarras(raiz: THREE.Group, capacidad: number): SistemaBarras {
  const geometria = crearGeometriaBarra();

  const centro = new Float32Array(capacidad * 3);
  const tamano = new Float32Array(capacidad * 2);
  const color = new Float32Array(capacidad * 3);
  const fraccion = new Float32Array(capacidad);

  const geomFondo = geometria.clone();
  const atCentroFondo = new THREE.InstancedBufferAttribute(centro, 3);
  const atTamanoFondo = new THREE.InstancedBufferAttribute(tamano, 2);
  geomFondo.setAttribute('aCentro', atCentroFondo);
  geomFondo.setAttribute('aTamano', atTamanoFondo);

  const materialFondo = new THREE.MeshBasicMaterial({
    color: 0x0c0a08,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    depthTest: true,
  });
  inyectarBillboardBarra(materialFondo, false);

  const fondo = new THREE.InstancedMesh(geomFondo, materialFondo, capacidad);
  fondo.frustumCulled = false;
  fondo.matrixAutoUpdate = false;

  const geomRelleno = geometria.clone();
  const atCentroRelleno = new THREE.InstancedBufferAttribute(centro, 3);
  const atTamanoRelleno = new THREE.InstancedBufferAttribute(tamano, 2);
  const atFraccion = new THREE.InstancedBufferAttribute(fraccion, 1);
  const atColor = new THREE.InstancedBufferAttribute(color, 3);
  geomRelleno.setAttribute('aCentro', atCentroRelleno);
  geomRelleno.setAttribute('aTamano', atTamanoRelleno);
  geomRelleno.setAttribute('aFraccion', atFraccion);
  geomRelleno.setAttribute('aColor', atColor);

  const materialRelleno = new THREE.MeshBasicMaterial({
    transparent: false,
    depthWrite: false,
    depthTest: true,
  });
  inyectarBillboardBarra(materialRelleno, true);

  const relleno = new THREE.InstancedMesh(geomRelleno, materialRelleno, capacidad);
  relleno.frustumCulled = false;
  relleno.matrixAutoUpdate = false;

  // Todas arrancan con tamaño cero: una instancia degenerada no dibuja nada, así
  // que no hace falta ningún truco adicional para "ocultar" una ranura libre.
  raiz.add(fondo, relleno);

  const libres: number[] = [];
  for (let i = capacidad - 1; i >= 0; i--) libres.push(i);

  return { fondo, relleno, centro, tamano, color, fraccion, slotDeIndice: new Map(), libres };
}

// --- Sistema principal ------------------------------------------------------------

export function crearSistemaSeleccion(
  escena: THREE.Scene,
  mundo: Mundo,
  sesion: SesionJuego,
  calidad: CalidadRender,
): SistemaSeleccion {
  const raiz = new THREE.Group();
  raiz.name = 'efectos-seleccion';
  escena.add(raiz);

  const { barras: capacidadBarras, marcadores: capacidadMarcadores } = capacidadesPara(calidad);

  // --- Anillos de selección: uno por unidad seleccionada, reciclados por índice. ---
  const anillosPool: AnilloTerreno[] = [];
  const anilloDeIndice = new Map<number, AnilloTerreno>();
  const anillosLibres: AnilloTerreno[] = [];

  function obtenerAnillo(): AnilloTerreno {
    const reciclado = anillosLibres.pop();
    if (reciclado) return reciclado;
    const nuevo = crearAnilloTerreno(0xffffff, 0.85);
    anillosPool.push(nuevo);
    raiz.add(nuevo.malla);
    return nuevo;
  }

  // --- Anillo de resaltado bajo el cursor: uno solo, siempre reutilizado. ---
  const anilloResaltado = crearAnilloTerreno(0xffe9a8, 0.55);
  raiz.add(anilloResaltado.malla);

  // --- Marcadores de orden ---
  const geometriaMarcador = crearGeometriaMarcador();
  const marcadores: MarcadorOrden[] = [];
  for (let k = 0; k < capacidadMarcadores; k++) {
    const material = new THREE.MeshBasicMaterial({
      color: COLOR_ORDEN_MOVER,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    const malla = new THREE.Mesh(geometriaMarcador, material);
    malla.visible = false;
    malla.matrixAutoUpdate = false;
    raiz.add(malla);
    marcadores.push({ malla, material, activo: false, nacimiento: 0 });
  }
  let cursorMarcador = 0;

  const bajaOrden = bus.al('ordenEmitida', (datos) => {
    const marcador = marcadores[cursorMarcador];
    cursorMarcador = (cursorMarcador + 1) % capacidadMarcadores;
    marcador.activo = true;
    marcador.nacimiento = reloj;
    marcador.material.color.setHex(datos.tipo === 'atacar' ? COLOR_ORDEN_ATACAR : COLOR_ORDEN_MOVER);
    const y = mundo.mapa.alturaEnMundo(datos.x, datos.z) + 0.03;
    marcador.malla.position.set(datos.x, y, datos.z);
    marcador.malla.updateMatrix();
    marcador.malla.visible = true;
  });

  // --- Barras de vida ---
  const barras = crearSistemaBarras(raiz, capacidadBarras);

  const seleccionActual = new Set<number>();
  let reloj = 0;

  function liberarAnillo(indice: number): void {
    const anillo = anilloDeIndice.get(indice);
    if (!anillo) return;
    anillo.malla.visible = false;
    anilloDeIndice.delete(indice);
    anillosLibres.push(anillo);
  }

  function liberarBarra(indice: number): void {
    const slot = barras.slotDeIndice.get(indice);
    if (slot === undefined) return;
    barras.tamano[slot * 2] = 0;
    barras.tamano[slot * 2 + 1] = 0;
    barras.slotDeIndice.delete(indice);
    barras.libres.push(slot);
  }

  return {
    raiz,

    actualizar(dt: number, alfa: number): void {
      reloj += dt;

      // --- Selección: reconstruye el conjunto de índices válidos de este fotograma. ---
      seleccionActual.clear();
      for (const entidad of sesion.seleccion) {
        if (!mundo.esValida(entidad)) continue;
        seleccionActual.add(indiceDe(entidad));
      }

      // Retira los anillos de lo que ya no está seleccionado.
      for (const indice of [...anilloDeIndice.keys()]) {
        if (!seleccionActual.has(indice)) liberarAnillo(indice);
      }

      for (const indice of seleccionActual) {
        let anillo = anilloDeIndice.get(indice);
        if (!anillo) {
          anillo = obtenerAnillo();
          anillo.material.color.setHex(COLOR_BANDO_SELECCION[mundo.bando[indice]] ?? 0xffffff);
          anillo.malla.visible = true;
          anilloDeIndice.set(indice, anillo);
        }
        const x = mundo.xPrevio[indice] + (mundo.x[indice] - mundo.xPrevio[indice]) * alfa;
        const z = mundo.zPrevio[indice] + (mundo.z[indice] - mundo.zPrevio[indice]) * alfa;
        const radio = mundo.radio[indice];
        // Más grosor cuanto mayor es la unidad o el edificio: un ayuntamiento
        // seleccionado no debería llevar el mismo aro fino que un campesino.
        const grosor = 0.05 + radio * 0.06;
        anillo.reubicar(mundo, x, z, radio * 1.08, radio * 1.08 + grosor);
      }

      // --- Resaltado bajo el cursor ---
      const resaltada = sesion.entidadResaltada;
      if (resaltada !== ENTIDAD_NULA && mundo.esValida(resaltada)) {
        const i = indiceDe(resaltada);
        const x = mundo.xPrevio[i] + (mundo.x[i] - mundo.xPrevio[i]) * alfa;
        const z = mundo.zPrevio[i] + (mundo.z[i] - mundo.zPrevio[i]) * alfa;
        const radio = mundo.radio[i];
        anilloResaltado.reubicar(mundo, x, z, radio * 1.22, radio * 1.22 + 0.035);
        anilloResaltado.malla.visible = true;
      } else {
        anilloResaltado.malla.visible = false;
      }

      // --- Marcadores de orden: se contraen y se desvanecen. ---
      for (const marcador of marcadores) {
        if (!marcador.activo) continue;
        const t = (reloj - marcador.nacimiento) / DURACION_MARCADOR;
        if (t >= 1) {
          marcador.activo = false;
          marcador.malla.visible = false;
          continue;
        }
        const escala = 1.7 - t * 0.75;
        marcador.malla.scale.set(escala, 1, escala);
        marcador.material.opacity = (1 - t) * 0.9;
        marcador.malla.updateMatrix();
      }

      // --- Barras de vida: unidades y edificios heridos, o seleccionados. ---
      let sucioFondo = false;
      let sucioRelleno = false;

      for (let i = 1; i <= mundo.indiceMaximo; i++) {
        if (mundo.activos[i] !== 1) continue;
        const clase = mundo.clase[i];
        if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) continue;
        if (mundo.vida[i] <= 0) continue;

        const vidaMax = Math.max(1, mundo.vidaMaxima[i]);
        const herida = mundo.vida[i] < vidaMax - 0.01;
        const seleccionada = seleccionActual.has(i);
        const necesitaBarra = herida || seleccionada;

        if (!necesitaBarra) {
          if (barras.slotDeIndice.has(i)) {
            liberarBarra(i);
            sucioFondo = true;
            sucioRelleno = true;
          }
          continue;
        }

        let slot = barras.slotDeIndice.get(i);
        if (slot === undefined) {
          const libre = barras.libres.pop();
          if (libre === undefined) continue; // presupuesto de barras agotado
          slot = libre;
          barras.slotDeIndice.set(i, slot);
        }

        const x = mundo.xPrevio[i] + (mundo.x[i] - mundo.xPrevio[i]) * alfa;
        const z = mundo.zPrevio[i] + (mundo.z[i] - mundo.zPrevio[i]) * alfa;
        const radio = mundo.radio[i];
        const alturaCabeza = mundo.mapa.alturaEnMundo(x, z) + radio * 2.2 + 0.55;

        const b3 = slot * 3;
        barras.centro[b3] = x;
        barras.centro[b3 + 1] = alturaCabeza;
        barras.centro[b3 + 2] = z;

        const b2 = slot * 2;
        barras.tamano[b2] = Math.min(2.1, Math.max(0.55, radio * 1.3));
        barras.tamano[b2 + 1] = 0.1;

        const fraccionVida = Math.max(0, Math.min(1, mundo.vida[i] / vidaMax));
        barras.fraccion[slot] = fraccionVida;

        // Verde por encima de la mitad, ámbar y luego rojo según cae: la lectura
        // instantánea de "cuánto le queda" importa más que un degradado preciso.
        if (fraccionVida > 0.5) {
          const t = (fraccionVida - 0.5) * 2;
          barras.color[b3] = 0.85 - t * 0.55;
          barras.color[b3 + 1] = 0.75;
          barras.color[b3 + 2] = 0.12;
        } else {
          const t = fraccionVida * 2;
          barras.color[b3] = 0.85;
          barras.color[b3 + 1] = 0.16 + t * 0.6;
          barras.color[b3 + 2] = 0.1;
        }

        sucioFondo = true;
        sucioRelleno = true;
      }

      if (sucioFondo) {
        (barras.fondo.geometry.attributes.aCentro as THREE.InstancedBufferAttribute).needsUpdate = true;
        (barras.fondo.geometry.attributes.aTamano as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
      if (sucioRelleno) {
        (barras.relleno.geometry.attributes.aCentro as THREE.InstancedBufferAttribute).needsUpdate = true;
        (barras.relleno.geometry.attributes.aTamano as THREE.InstancedBufferAttribute).needsUpdate = true;
        (barras.relleno.geometry.attributes.aFraccion as THREE.InstancedBufferAttribute).needsUpdate = true;
        (barras.relleno.geometry.attributes.aColor as THREE.InstancedBufferAttribute).needsUpdate = true;
      }
    },

    liberar(): void {
      bajaOrden();
      for (const anillo of anillosPool) {
        anillo.malla.geometry.dispose();
        anillo.material.dispose();
      }
      anilloResaltado.malla.geometry.dispose();
      anilloResaltado.material.dispose();
      geometriaMarcador.dispose();
      for (const marcador of marcadores) marcador.material.dispose();
      barras.fondo.geometry.dispose();
      (barras.fondo.material as THREE.Material).dispose();
      barras.relleno.geometry.dispose();
      (barras.relleno.material as THREE.Material).dispose();
      raiz.clear();
      escena.remove(raiz);
    },
  };
}
