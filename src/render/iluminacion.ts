import * as THREE from 'three';
import type { CalidadRender } from './renderizador';

/**
 * Iluminación de la escena.
 *
 * Tres luces y nada más, que es el esquema mínimo capaz de esculpir un modelo
 * sencillo: un sol direccional cálido que proyecta las sombras y fija la hora del
 * día, un relleno frío desde el lado contrario para que las caras en sombra no se
 * conviertan en manchas negras, y una hemisférica que simula el rebote del cielo
 * por arriba y de la tierra por abajo.
 *
 * La cascada de sombras es de un solo nivel a propósito. Un RTS mira siempre desde
 * la misma altura y con el mismo ángulo, así que basta con arrastrar un único
 * volumen de sombra detrás del punto al que mira la cámara: cuesta lo mismo que una
 * cascada de tres y no tiene sus costuras. Lo que sí hace falta es *encajar el
 * volumen a la rejilla de téxeles del mapa de sombras*; sin eso, al desplazar la
 * cámara los bordes de sombra hierven de forma muy visible.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   DIRECCION_SOL   vector unitario del suelo hacia el sol (lo comparten cielo y agua)
 *   COLOR_SOL / COLOR_RELLENO / COLOR_CIELO_LUZ / COLOR_SUELO_LUZ  paleta de luces
 *
 *   crearIluminacion(escena, calidad): Iluminacion
 *     · raiz: THREE.Group añadido a la escena con las tres luces
 *     · sol: THREE.DirectionalLight (lo usan el cielo y el agua para el especular)
 *     · actualizar(dt): respiración lentísima de la intensidad (nubes altas pasando)
 *     · enfocarSombras(x, z): recentra el volumen de sombra sobre un punto del mundo
 *     · liberar(): suelta los mapas de sombra y saca las luces de la escena
 * ──────────────────────────────────────────────────────────────────────────────
 */

/**
 * Dirección del sol, del suelo hacia la luz.
 * Viene del oeste-noroeste y bastante alto: las sombras caen hacia el sudeste,
 * cruzadas respecto al azimut de la cámara (45°), que es lo que hace que los
 * edificios proyecten sombra *hacia un lado* y no hacia el observador.
 */
export const DIRECCION_SOL = new THREE.Vector3(-0.58, 0.68, 0.45).normalize();

export const COLOR_SOL = 0xffe7c2;
export const COLOR_RELLENO = 0x86b0e6;
export const COLOR_CIELO_LUZ = 0xa6cdf5;
export const COLOR_SUELO_LUZ = 0x4c3d29;

/** Distancia a la que se coloca el sol. Solo afecta al encuadre de la sombra. */
const DISTANCIA_SOL = 95;

export interface Iluminacion {
  raiz: THREE.Group;
  sol: THREE.DirectionalLight;
  actualizar(dt: number): void;
  enfocarSombras(x: number, z: number): void;
  liberar(): void;
}

export function crearIluminacion(escena: THREE.Scene, calidad: CalidadRender): Iluminacion {
  const raiz = new THREE.Group();
  raiz.name = 'iluminacion';

  const sol = new THREE.DirectionalLight(COLOR_SOL, 2.75);
  sol.name = 'sol';
  sol.position.copy(DIRECCION_SOL).multiplyScalar(DISTANCIA_SOL);

  // Radio del volumen de sombra en casillas. Cuanto más ajustado, más resolución
  // efectiva; se dimensiona con la calidad para que el téxel mida más o menos lo
  // mismo en todos los dispositivos.
  const radioSombra = calidad.resolucionSombras >= 2048 ? 38 : 28;
  const conSombras = calidad.resolucionSombras > 0;

  if (conSombras) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(calidad.resolucionSombras, calidad.resolucionSombras);
    const c = sol.shadow.camera;
    c.near = 1;
    c.far = DISTANCIA_SOL * 2.2;
    c.left = -radioSombra;
    c.right = radioSombra;
    c.top = radioSombra;
    c.bottom = -radioSombra;
    c.updateProjectionMatrix();
    // El sesgo normal es el que quita el moteado de las superficies inclinadas sin
    // despegar la sombra de los pies de las unidades.
    sol.shadow.bias = -0.0004;
    sol.shadow.normalBias = 0.03;
    // Un radio de desenfoque pequeño: la sombra dura lee mejor la hora del día.
    sol.shadow.radius = 1.6;
  }

  raiz.add(sol);
  raiz.add(sol.target);

  // Relleno frío desde el lado opuesto. No proyecta sombra: su trabajo es rescatar
  // información en las zonas que el sol no toca, y una segunda sombra las ensuciaría.
  const relleno = new THREE.DirectionalLight(COLOR_RELLENO, 0.6);
  relleno.name = 'relleno';
  relleno.position.set(-DIRECCION_SOL.x * 60, 34, -DIRECCION_SOL.z * 60);
  raiz.add(relleno);

  const hemisferica = new THREE.HemisphereLight(COLOR_CIELO_LUZ, COLOR_SUELO_LUZ, 0.85);
  hemisferica.name = 'hemisferica';
  raiz.add(hemisferica);

  escena.add(raiz);

  // Tamaño del téxel del mapa de sombras proyectado en el mundo. Encajar el centro
  // del volumen a esta rejilla es lo que impide que los bordes hiervan al mover la
  // cámara.
  const tamTexel = conSombras ? (radioSombra * 2) / calidad.resolucionSombras : 0;

  const intensidadBase = sol.intensity;
  let reloj = 0;

  return {
    raiz,
    sol,

    actualizar(dt: number): void {
      reloj += dt;
      // Respiración de dos periodos incompatibles: nunca se repite igual y evita
      // que el cielo se lea como un bucle.
      const respiracion = Math.sin(reloj * 0.07) * 0.5 + Math.sin(reloj * 0.031 + 1.7) * 0.5;
      sol.intensity = intensidadBase * (1 + respiracion * 0.035);
    },

    enfocarSombras(x: number, z: number): void {
      if (!conSombras) return;
      let cx = x;
      let cz = z;
      if (tamTexel > 0) {
        cx = Math.round(x / tamTexel) * tamTexel;
        cz = Math.round(z / tamTexel) * tamTexel;
      }
      sol.target.position.set(cx, 0, cz);
      sol.position.set(
        cx + DIRECCION_SOL.x * DISTANCIA_SOL,
        DIRECCION_SOL.y * DISTANCIA_SOL,
        cz + DIRECCION_SOL.z * DISTANCIA_SOL,
      );
      sol.target.updateMatrixWorld();
      sol.updateMatrixWorld();
    },

    liberar(): void {
      sol.shadow.dispose();
      sol.dispose();
      relleno.dispose();
      hemisferica.dispose();
      escena.remove(raiz);
    },
  };
}
