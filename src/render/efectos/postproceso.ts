import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { CalidadRender } from '../renderizador';

/**
 * Cadena de post-procesado.
 *
 * Tres pasadas y nada más, cada una sutil a propósito: el error más común de un
 * post-proceso amateur es el exceso, no el defecto. Un resplandor que se nota como
 * "efecto" en vez de leerse como "ese metal reflejó el sol" ya se ha pasado de
 * intensidad.
 *
 *   1. `UnrealBloomPass`, con un umbral alto: solo lo verdaderamente brillante
 *      (el filo de un arma al sol, una hoguera) sangra luz sobre lo que tiene al
 *      lado. El terreno y la hierba, que ya están bien expuestos, no deben tocarlo.
 *   2. Una pasada propia de gradación: viñeta suave (oscurece las esquinas para
 *      llevar el ojo al centro) y una LUT de tono cálido y algo desaturado —la
 *      paleta de fantasía clásica— aplicada como una simple curva por canal
 *      calculada en el propio shader, sin necesitar cargar ninguna textura de LUT.
 *   3. `OutputPass`, que es quien de verdad aplica el mapeo tonal y la conversión a
 *      sRGB de salida cuando se renderiza a través de un compositor: sin esta
 *      pasada al final, `renderer.toneMapping` y `outputColorSpace` no se aplican
 *      sobre el resultado compuesto y todo lo anterior queda en espacio lineal.
 *
 * Se desactiva del todo si `calidad.postProceso` es falso: en ese caso ni siquiera
 * se instancia el compositor, así que el coste en gama baja es exactamente cero.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearPostProceso(renderizador, escena, camara, calidad): PostProceso
 *     · activo: si la cadena está realmente en uso
 *     · renderizar(): dibuja el fotograma (por el compositor, o directo si !activo)
 *     · redimensionar(ancho, alto): reajusta los render targets
 *     · liberar(): suelta el compositor y sus render targets
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface PostProceso {
  readonly activo: boolean;
  renderizar(): void;
  redimensionar(ancho: number, alto: number): void;
  liberar(): void;
}

/** Gradación de color: viñeta + tono cálido, en un único shader barato. */
const SombreadorGradacion = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    intensidadVineta: { value: 0.32 },
    calidez: { value: 0.06 },
    saturacion: { value: 0.92 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float intensidadVineta;
    uniform float calidez;
    uniform float saturacion;
    varying vec2 vUv;

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);

      // Tono cálido: empuja rojo/amarillo arriba y azul abajo, muy suavemente.
      color.r += calidez * 0.6;
      color.g += calidez * 0.25;
      color.b -= calidez * 0.5;

      // Desaturación parcial hacia la luminancia percibida (Rec. 709).
      float luminancia = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luminancia), color.rgb, saturacion);

      // Viñeta: oscurece hacia las esquinas con una caída suave (smoothstep),
      // no lineal, para que no se note como un círculo dibujado encima.
      vec2 centrado = vUv - 0.5;
      float distancia = length(centrado) * 1.4142;
      float vineta = smoothstep(1.0, 0.35, distancia);
      color.rgb *= mix(1.0 - intensidadVineta, 1.0, vineta);

      gl_FragColor = color;
    }
  `,
};

export function crearPostProceso(
  renderizador: THREE.WebGLRenderer,
  escena: THREE.Scene,
  camara: THREE.Camera,
  calidad: CalidadRender,
): PostProceso {
  if (!calidad.postProceso) {
    return {
      activo: false,
      renderizar(): void {
        renderizador.render(escena, camara);
      },
      redimensionar(): void {},
      liberar(): void {},
    };
  }

  const tamano = new THREE.Vector2();
  renderizador.getSize(tamano);

  const compositor = new EffectComposer(renderizador);
  compositor.addPass(new RenderPass(escena, camara));

  const bloom = new UnrealBloomPass(tamano.clone(), 0.42, 0.75, 0.86);
  compositor.addPass(bloom);

  const gradacion = new ShaderPass(SombreadorGradacion);
  compositor.addPass(gradacion);

  compositor.addPass(new OutputPass());

  return {
    activo: true,

    renderizar(): void {
      compositor.render();
    },

    redimensionar(ancho: number, alto: number): void {
      compositor.setSize(ancho, alto);
      bloom.resolution.set(ancho, alto);
    },

    liberar(): void {
      compositor.dispose();
    },
  };
}
