import * as THREE from 'three';
import { TAM_CASILLA, SUBDIVISIONES_CASILLA } from '../sim/constantes';
import type { MapaJuego } from '../sim/mapa';
import type { CalidadRender } from './renderizador';
import { calidadPara } from './renderizador';
import { NIVEL_AGUA, construirRelieve } from './terreno';
import { crearTexturaOlas } from './texturas';
import { COLOR_HORIZONTE } from './cielo';

/**
 * Lámina de agua.
 *
 * El agua de los clásicos era una casilla azul con tres fotogramas de animación.
 * Aquí es una superficie real: un plano a cota fija que **corta el terreno**, de
 * modo que la línea de orilla no la decide la rejilla sino la intersección entre
 * el plano y la pendiente de la playa que talla `terreno.ts`. De ahí salen gratis
 * las calas irregulares, los bajíos con el fondo visible y los islotes.
 *
 * Lo que aporta cada pieza del sombreador:
 *
 *   · **Olas por desplazamiento de vértices**: tres senos incompatibles entre sí,
 *     amortiguados hacia la orilla. Sin la amortiguación el agua «respiraría»
 *     sobre la arena y se vería la lámina despegarse del suelo.
 *   · **Normales de oleaje** (`crearTexturaOlas`) en dos capas que se desplazan a
 *     distinta velocidad y en distinta dirección: es lo que rompe el patrón y da
 *     el centelleo del sol sobre el rizado.
 *   · **Tinte por profundidad y transparencia por profundidad**: el bajío deja ver
 *     la arena, el fondo se cierra en verde botella. Es el rasgo que más dice
 *     «agua» y el que ningún color plano puede imitar.
 *   · **Espuma de orilla** con una banda que avanza y retrocede sobre la línea de
 *     agua, más intensa cuanto menos calado hay.
 *   · **Fresnel**: a rasante el agua refleja el cielo y deja de ser transparente.
 *
 * Todo va sobre `MeshStandardMaterial`, no sobre un `ShaderMaterial` desde cero:
 * así el especular del sol, la hemisférica y las sombras del terreno siguen
 * funcionando, que es justo lo que hace que parezca caro.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearAgua(mapa, calidad?): Agua
 *     · raiz: THREE.Object3D   malla fusionada (una sola llamada de dibujado)
 *     · material: THREE.MeshStandardMaterial
 *     · hayAgua: boolean       false si el mapa no tiene ni una casilla de agua
 *     · actualizar(dt): avanza el oleaje
 *     · liberar(): suelta geometría y material
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface Agua {
  raiz: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  hayAgua: boolean;
  actualizar(dt: number): void;
  liberar(): void;
}

/** Calado por debajo del cual el agua deja de dibujarse. */
const CALADO_MINIMO = 0.002;

export function crearAgua(mapa: MapaJuego, calidad: CalidadRender = calidadPara('medio')): Agua {
  const relieve = construirRelieve(mapa);
  const sub = Math.max(1, SUBDIVISIONES_CASILLA);

  const posiciones: number[] = [];
  const normales: number[] = [];
  const calados: number[] = [];
  const indices: number[] = [];

  const calado = new Float32Array((sub + 1) * (sub + 1));
  let siguiente = 0;

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      // Se incluye un anillo de cortesía alrededor del agua: la orilla necesita
      // superficie por donde desvanecerse aunque esa casilla ya sea tierra.
      if (!cercaDelAgua(mapa, cx, cz)) continue;

      let maximo = 0;
      for (let j = 0; j <= sub; j++) {
        const z = (cz + j / sub) * TAM_CASILLA;
        for (let k = 0; k <= sub; k++) {
          const x = (cx + k / sub) * TAM_CASILLA;
          const c = Math.max(0, NIVEL_AGUA - relieve.alturaEn(x, z));
          calado[j * (sub + 1) + k] = c;
          if (c > maximo) maximo = c;
        }
      }
      if (maximo <= CALADO_MINIMO) continue;

      const primero = siguiente;
      for (let j = 0; j <= sub; j++) {
        const z = (cz + j / sub) * TAM_CASILLA;
        for (let k = 0; k <= sub; k++) {
          const x = (cx + k / sub) * TAM_CASILLA;
          posiciones.push(x, NIVEL_AGUA, z);
          normales.push(0, 1, 0);
          calados.push(calado[j * (sub + 1) + k]);
          siguiente++;
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

  const geometria = new THREE.BufferGeometry();
  geometria.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geometria.setAttribute('normal', new THREE.Float32BufferAttribute(normales, 3));
  geometria.setAttribute('calado', new THREE.Float32BufferAttribute(calados, 1));
  geometria.setIndex(indices);
  geometria.computeBoundingSphere();

  const olas = crearTexturaOlas(calidad);

  const uniformes = {
    tiempo: { value: 0 },
    mapaOlas: { value: olas },
    colorSomero: { value: new THREE.Color(0x4d9c93) },
    colorProfundo: { value: new THREE.Color(0x0d3244) },
    colorEspuma: { value: new THREE.Color(0xe8f4f2) },
    colorCielo: { value: new THREE.Color(COLOR_HORIZONTE) },
    escalaOlas: { value: calidad.nivel === 'bajo' ? 0.22 : 0.32 },
  };

  const material = new THREE.MeshStandardMaterial({
    name: 'agua',
    color: 0xffffff,
    roughness: 0.08,
    metalness: 0.02,
    transparent: true,
    // Sin escritura de profundidad: bajo el agua solo hay lecho, ya dibujado, y así
    // nada de lo que flote encima se recorta contra la lámina.
    depthWrite: false,
    side: THREE.FrontSide,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformes);

    shader.vertexShader = `
      attribute float calado;
      uniform float tiempo;
      varying float vCalado;
      varying vec3 vMundoAgua;
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vCalado = calado;
       // Tres trenes de onda de periodos incompatibles: nunca se ve el bucle.
       float ondulacion =
           sin(transformed.x * 1.7 + tiempo * 1.30) * 0.50
         + sin(transformed.z * 2.3 - tiempo * 1.05) * 0.32
         + sin((transformed.x + transformed.z) * 3.1 + tiempo * 2.10) * 0.18;
       // La ola muere en la orilla: si no, la lámina se despegaría de la arena.
       transformed.y += ondulacion * 0.030 * smoothstep(0.0, 0.24, calado);
       vMundoAgua = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );

    shader.fragmentShader = `
      uniform float tiempo;
      uniform sampler2D mapaOlas;
      uniform vec3 colorSomero;
      uniform vec3 colorProfundo;
      uniform vec3 colorEspuma;
      uniform vec3 colorCielo;
      uniform float escalaOlas;
      varying float vCalado;
      varying vec3 vMundoAgua;
      vec3 normalAgua;
      float espumaAgua;
    ` + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `
        vec2 uvA = vMundoAgua.xz * escalaOlas + vec2(tiempo * 0.014, tiempo * 0.009);
        vec2 uvB = vMundoAgua.xz * escalaOlas * 2.1 - vec2(tiempo * 0.021, -tiempo * 0.016);
        vec3 o1 = texture2D(mapaOlas, uvA).xyz * 2.0 - 1.0;
        vec3 o2 = texture2D(mapaOlas, uvB).xyz * 2.0 - 1.0;
        vec3 tn = normalize(vec3(o1.xy * 0.75 + o2.xy * 0.55, 1.0));
        // El plano de agua es horizontal: la tangente es X y la bitangente Z.
        normalAgua = normalize(vec3(tn.x, tn.z, tn.y));

        // Espuma: una banda que avanza sobre la línea de agua. La fase depende del
        // propio calado, así que la orilla «lame» el terreno siguiendo su forma.
        float orilla = 1.0 - smoothstep(0.0, 0.17, vCalado);
        float rizo = 0.5 + 0.5 * sin(vCalado * 48.0 - tiempo * 2.4 + (o1.x + o2.y) * 3.2);
        espumaAgua = clamp(orilla * (0.30 + 0.70 * rizo), 0.0, 1.0);
        espumaAgua *= smoothstep(0.003, 0.022, vCalado);
        espumaAgua = pow(espumaAgua, 1.25);

        vec3 tono = mix(colorSomero, colorProfundo, smoothstep(0.02, 0.55, vCalado));
        diffuseColor.rgb *= mix(tono, colorEspuma, espumaAgua);

        // Transparencia por profundidad: el bajío deja ver la arena del fondo.
        float alfa = mix(0.30, 0.94, smoothstep(0.0, 0.34, vCalado));
        alfa = max(alfa, espumaAgua * 0.9);
        diffuseColor.a *= alfa * smoothstep(0.0, 0.022, vCalado);
        `,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = mix(0.055, 0.68, espumaAgua);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `normal = normalize((viewMatrix * vec4(normalAgua, 0.0)).xyz);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
         // Fresnel: a rasante el agua es un espejo del cielo y deja de ser
         // transparente. Sin esto la lámina parece un cristal tintado.
         vec3 haciaCamara = normalize(cameraPosition - vMundoAgua);
         float fresnel = pow(1.0 - clamp(dot(haciaCamara, normalAgua), 0.0, 1.0), 4.0);
         gl_FragColor.rgb += colorCielo * fresnel * 0.60 * (1.0 - espumaAgua);
         gl_FragColor.a = clamp(gl_FragColor.a + fresnel * 0.40, 0.0, 1.0);`,
      );
  };

  material.customProgramCacheKey = () => 'agua';

  const malla = new THREE.Mesh(geometria, material);
  malla.name = 'agua';
  malla.receiveShadow = calidad.resolucionSombras > 0;
  malla.castShadow = false;
  malla.matrixAutoUpdate = false;
  malla.updateMatrix();
  // Después del terreno y antes que la vegetación transparente.
  malla.renderOrder = 1;

  let reloj = 0;

  return {
    raiz: malla,
    material,
    hayAgua: indices.length > 0,
    actualizar(dt: number): void {
      reloj += dt;
      uniformes.tiempo.value = reloj;
    },
    liberar(): void {
      geometria.dispose();
      material.dispose();
    },
  };
}

/** ¿Hay agua en esta casilla o en alguna de sus ocho vecinas? */
function cercaDelAgua(mapa: MapaJuego, cx: number, cz: number): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (mapa.esAgua(cx + dx, cz + dz)) return true;
    }
  }
  return false;
}
