import * as THREE from 'three';
import type { CalidadRender } from './renderizador';
import { DIRECCION_SOL } from './iluminacion';
import { crearTexturaMacro } from './texturas';

/**
 * Cielo, sol y niebla atmosférica.
 *
 * Un color de fondo liso delata a un motor de aficionado desde el primer segundo:
 * el ojo espera que el aire tenga profundidad. Aquí el cielo es una cúpula con
 * degradado cenit-horizonte, halo solar coherente con la luz direccional y nubes
 * procedurales que se desplazan muy despacio.
 *
 * Dos decisiones de implementación que importan:
 *
 *   · La cúpula **viaja con la cámara** (se recoloca en `onBeforeRender`), así que
 *     nunca se sale de los planos de recorte por más que el jugador se aleje, y no
 *     hace falta un `far` desmesurado que destroce la precisión del búfer de
 *     profundidad.
 *   · Se dibuja sin prueba ni escritura de profundidad y con `renderOrder` negativo:
 *     es lo primero que se pinta y todo lo demás cae encima. Cuesta un relleno de
 *     pantalla y ni un triángulo de más en el resto de la escena.
 *
 * La niebla lineal se instala en la escena con el mismo color que el horizonte de
 * la cúpula. Si esos dos colores no casan, el terreno lejano se recorta contra el
 * cielo como una calcomanía y se pierde toda la sensación de distancia.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   COLOR_HORIZONTE / COLOR_CENIT / COLOR_NIEBLA   paleta (sRGB) compartida
 *
 *   crearCielo(escena, calidad): Cielo
 *     · raiz: THREE.Object3D  la cúpula
 *     · actualizar(dt): mueve las nubes
 *     · liberar(): saca la cúpula de la escena, quita la niebla y libera recursos
 * ──────────────────────────────────────────────────────────────────────────────
 */

export const COLOR_HORIZONTE = 0xb6cadb;
export const COLOR_CENIT = 0x3d76bd;
export const COLOR_NIEBLA = 0xa7bed2;

/** Radio de la cúpula. Entre el `near` máximo (~3.7) y el `far` mínimo (~204). */
const RADIO_CUPULA = 110;

export interface Cielo {
  raiz: THREE.Object3D;
  actualizar(dt: number): void;
  liberar(): void;
}

export function crearCielo(escena: THREE.Scene, calidad: CalidadRender): Cielo {
  const nubes = crearTexturaMacro(calidad);

  const uniformes = {
    tiempo: { value: 0 },
    dirSol: { value: DIRECCION_SOL.clone() },
    // `new THREE.Color(hex)` ya interpreta el hexadecimal como sRGB y lo convierte
    // al espacio lineal de trabajo: no hay que reconvertirlo a mano.
    colorCenit: { value: new THREE.Color(COLOR_CENIT) },
    colorHorizonte: { value: new THREE.Color(COLOR_HORIZONTE) },
    colorTierra: { value: new THREE.Color(0x5b5647) },
    colorSol: { value: new THREE.Color(0xffd9a0) },
    mapaNubes: { value: nubes },
    densidadNubes: { value: calidad.nivel === 'bajo' ? 0.55 : 0.85 },
  };

  const material = new THREE.ShaderMaterial({
    name: 'cielo',
    uniforms: uniformes,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDireccion;
      void main() {
        // La cúpula está centrada en la cámara, así que la posición local ya es la
        // dirección de mirada. Sale gratis y evita una matriz inversa por píxel.
        vDireccion = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float tiempo;
      uniform vec3 dirSol;
      uniform vec3 colorCenit;
      uniform vec3 colorHorizonte;
      uniform vec3 colorTierra;
      uniform vec3 colorSol;
      uniform sampler2D mapaNubes;
      uniform float densidadNubes;
      varying vec3 vDireccion;

      void main() {
        vec3 d = normalize(vDireccion);
        float altura = d.y;

        // Degradado atmosférico. El exponente bajo concentra el cambio cerca del
        // horizonte, que es donde de verdad ocurre en un cielo real.
        vec3 color = mix(colorHorizonte, colorCenit, pow(clamp(altura, 0.0, 1.0), 0.62));
        // Por debajo del horizonte, bruma de tierra: cierra la escena sin un corte.
        color = mix(colorTierra, color, smoothstep(-0.22, 0.015, altura));

        float cosSol = max(dot(d, dirSol), 0.0);

        // Nubes: tres octavas del ruido macro proyectadas sobre un plano alto.
        vec2 p = d.xz / max(abs(altura) + 0.06, 0.09);
        float n = texture(mapaNubes, p * 0.021 + vec2(tiempo * 0.0022, tiempo * 0.0008)).r * 0.55
                + texture(mapaNubes, p * 0.049 - vec2(tiempo * 0.0041, 0.0)).g * 0.30
                + texture(mapaNubes, p * 0.115 + vec2(tiempo * 0.0068, tiempo * 0.0021)).b * 0.15;

        float cobertura = smoothstep(0.44, 0.70, n) * smoothstep(0.015, 0.20, altura) * densidadNubes;
        // La cara de la nube que mira al sol se enciende; la contraria queda gris
        // azulada. Sin ese contraste las nubes parecen manchas de humo.
        vec3 tonoNube = mix(vec3(0.30, 0.33, 0.40), vec3(1.35, 1.30, 1.20), smoothstep(0.46, 0.82, n));
        tonoNube += colorSol * pow(cosSol, 3.0) * 0.35;
        color = mix(color, tonoNube, cobertura);

        // Halo y disco solar, después de las nubes: el sol las atraviesa.
        color += colorSol * pow(cosSol, 5.0) * 0.30 * (1.0 - cobertura * 0.7);
        color += colorSol * smoothstep(0.9994, 0.99975, cosSol) * 9.0 * (1.0 - cobertura * 0.9);

        gl_FragColor = vec4(color, 1.0);

        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const geometria = new THREE.SphereGeometry(RADIO_CUPULA, 32, 16);
  const cupula = new THREE.Mesh(geometria, material);
  cupula.name = 'cielo';
  cupula.frustumCulled = false;
  cupula.matrixAutoUpdate = false;
  cupula.renderOrder = -1000;
  cupula.onBeforeRender = (_renderizador, _escena, camara) => {
    cupula.position.copy(camara.position);
    cupula.updateMatrix();
    cupula.matrixWorld.copy(cupula.matrix);
  };

  escena.add(cupula);

  // Fondo de emergencia: si la cúpula no llegara a dibujarse, el borde del mundo
  // seguiría siendo del color del horizonte y no de un negro delator.
  const fondoPrevio = escena.background;
  const nieblaPrevia = escena.fog;
  escena.background = new THREE.Color(COLOR_HORIZONTE);
  escena.fog = new THREE.Fog(COLOR_NIEBLA, 52, 215);

  let reloj = 0;

  return {
    raiz: cupula,
    actualizar(dt: number): void {
      reloj += dt;
      uniformes.tiempo.value = reloj;
    },
    liberar(): void {
      escena.remove(cupula);
      geometria.dispose();
      material.dispose();
      escena.background = fondoPrevio;
      escena.fog = nieblaPrevia;
    },
  };
}
