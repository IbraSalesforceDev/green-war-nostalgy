import * as THREE from 'three';
import type { CalidadRender } from '../renderizador';

/**
 * Sistema de partículas en GPU.
 *
 * Dos `THREE.Points` — uno con mezcla aditiva (chispas, destellos, magia) y otro con
 * mezcla normal (sangre, polvo, humo, hojas) — cada uno con un único búfer de
 * atributos por partícula. La física entera (posición, color, tamaño, desvanecido)
 * se resuelve en el sombreador de vértices como una función cerrada del tiempo
 * transcurrido desde el nacimiento: no hay ninguna partícula individual que la CPU
 * tenga que «simular» fotograma a fotograma, así que emitir mil partículas cuesta
 * exactamente lo mismo que emitir diez.
 *
 * ── Por qué una función cerrada y no integración paso a paso ───────────────────
 * Con arrastre exponencial `v(t) = v0·e^(-k·t)`, la posición es la integral:
 *
 *     x(t) = x0 + v0/k · (1 − e^(−k·t))          (si k > 0)
 *     x(t) = x0 + v0·t                            (si k = 0, sin arrastre)
 *
 * y con gravedad constante se suma la parábola de siempre, `−½·g·t²`. Ambas se
 * evalúan directamente a partir de `t`, sin acumular nada: la GPU puede recolocar
 * una partícula en cualquier fotograma sin depender del anterior, que es justo lo
 * que hace falta para animar miles de ellas en un único `drawArrays`.
 *
 * ── Reutilización en anillo ─────────────────────────────────────────────────────
 * Cada partícula ocupa una ranura fija del búfer. `emitir()` avanza un cursor y
 * sobrescribe la ranura más antigua; si el presupuesto se agota a media batalla, la
 * partícula más vieja desaparece para dejar sitio a la más nueva, que es preferible
 * a negarse a mostrar el impacto que acaba de ocurrir.
 *
 * ── Por qué `THREE.PointsMaterial` y no un `ShaderMaterial` desde cero ─────────
 * Extendiendo el material estándar con `onBeforeCompile` (el mismo truco que usan
 * `terreno.ts` y `vegetacion.ts`) el sombreador conserva gratis la conversión de
 * espacio de color y el mapeo tonal que aplica el resto de la escena. Un
 * `ShaderMaterial` en blanco no lleva esos «extras» a menos que se escriban a mano,
 * y sin ellos las partículas saldrían con un tono perceptiblemente distinto al del
 * terreno o las unidades.
 *
 * ── API pública ───────────────────────────────────────────────────────────────
 *   crearSistemaParticulas(escena, calidad): SistemaParticulas
 *     · raiz: THREE.Group con los dos `Points`
 *     · emitir(emisor, opciones): dispara `opciones.cantidad` partículas
 *     · actualizar(dt): avanza el reloj y sube al GPU solo lo que ha cambiado
 *     · liberar(): suelta geometrías, materiales y la textura compartida
 *
 *   EMISOR_*  media docena larga de presets listos para usar desde `impactos.ts`
 *   y `proyectiles.ts`; cada uno fija el aspecto (color, tamaño, gravedad, arrastre,
 *   mezcla aditiva o no) y dEja que quien emite decida el «dónde» y el «cuánto».
 * ──────────────────────────────────────────────────────────────────────────────
 */

export interface EmisorParticulas {
  /** Mezcla aditiva (brilla, se suma a lo que hay detrás) o normal (cubre). */
  aditivo: boolean;
  colorInicio: number;
  colorFin: number;
  tamanoInicio: number;
  tamanoFin: number;
  /** Aceleración hacia abajo en unidades de mundo/s². Negativa = flota hacia arriba. */
  gravedad: number;
  /** Frenado exponencial de la velocidad inicial. 0 = vuelo balístico sin frenar. */
  arrastre: number;
  /** Fracción final de la vida en la que la partícula se desvanece a cero alfa. */
  desvanecido: number;
}

export interface OpcionesEmision {
  x: number;
  y: number;
  z: number;
  cantidad: number;
  /** Magnitud media de la velocidad de salida, en unidades de mundo por segundo. */
  velocidad: number;
  /** Dispersión angular aproximada alrededor de la dirección preferente. */
  dispersion: number;
  /** Dirección preferente de salida; por defecto, hacia arriba. */
  dirX?: number;
  dirY?: number;
  dirZ?: number;
  vidaMin: number;
  vidaMax: number;
  /** Multiplicador puntual de los tamaños del emisor (unidades pequeñas, chispas menores). */
  escala?: number;
}

export interface SistemaParticulas {
  readonly raiz: THREE.Group;
  emitir(emisor: EmisorParticulas, opciones: OpcionesEmision): void;
  actualizar(dt: number): void;
  liberar(): void;
}

// --- Presets de emisor ---------------------------------------------------------

export const EMISOR_CHISPA_GOLPE: EmisorParticulas = {
  aditivo: true,
  colorInicio: 0xfff2c0,
  colorFin: 0xff5a1e,
  tamanoInicio: 0.1,
  tamanoFin: 0.02,
  gravedad: 2.6,
  arrastre: 3.0,
  desvanecido: 0.55,
};

export const EMISOR_IMPACTO_FLECHA: EmisorParticulas = {
  aditivo: true,
  colorInicio: 0xffe9b0,
  colorFin: 0xaa3010,
  tamanoInicio: 0.07,
  tamanoFin: 0.015,
  gravedad: 2.2,
  arrastre: 2.4,
  desvanecido: 0.5,
};

export const EMISOR_SANGRE: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0x9a1c1c,
  colorFin: 0x350606,
  tamanoInicio: 0.11,
  tamanoFin: 0.05,
  gravedad: 9.0,
  arrastre: 1.2,
  desvanecido: 0.3,
};

export const EMISOR_ASTILLA: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0xb9a06c,
  colorFin: 0x6b5a3c,
  tamanoInicio: 0.07,
  tamanoFin: 0.03,
  gravedad: 7.5,
  arrastre: 1.6,
  desvanecido: 0.4,
};

export const EMISOR_POLVO_IMPACTO: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0xc7bba0,
  colorFin: 0x8d8267,
  tamanoInicio: 0.16,
  tamanoFin: 0.5,
  gravedad: 0.35,
  arrastre: 1.1,
  desvanecido: 0.65,
};

export const EMISOR_POLVO_OBRA: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0xd6c9a6,
  colorFin: 0x968a6c,
  tamanoInicio: 0.3,
  tamanoFin: 1.1,
  gravedad: 0.2,
  arrastre: 0.7,
  desvanecido: 0.7,
};

export const EMISOR_HUMO: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0x4a4640,
  colorFin: 0x201d1a,
  tamanoInicio: 0.26,
  tamanoFin: 0.9,
  // Negativa: el humo asciende en vez de caer.
  gravedad: -1.1,
  arrastre: 0.9,
  desvanecido: 0.75,
};

export const EMISOR_DESTELLO_ORO: EmisorParticulas = {
  aditivo: true,
  colorInicio: 0xfff2b0,
  colorFin: 0xd8952c,
  tamanoInicio: 0.16,
  tamanoFin: 0.02,
  gravedad: -0.4,
  arrastre: 2.0,
  desvanecido: 0.7,
};

export const EMISOR_HOJA: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0x5f8f34,
  colorFin: 0x33531c,
  tamanoInicio: 0.09,
  tamanoFin: 0.08,
  gravedad: 1.0,
  arrastre: 2.6,
  desvanecido: 0.3,
};

export const EMISOR_ESTELA_FLECHA: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0xf4ecd8,
  colorFin: 0xe4d8b8,
  tamanoInicio: 0.045,
  tamanoFin: 0.01,
  gravedad: 0,
  arrastre: 0.4,
  desvanecido: 0.85,
};

export const EMISOR_ESTELA_MAGICA: EmisorParticulas = {
  aditivo: true,
  colorInicio: 0xc79bff,
  colorFin: 0x5a2fae,
  tamanoInicio: 0.09,
  tamanoFin: 0.02,
  gravedad: 0,
  arrastre: 0.5,
  desvanecido: 0.6,
};

export const EMISOR_ESTELA_ROCA: EmisorParticulas = {
  aditivo: false,
  colorInicio: 0x9c9686,
  colorFin: 0x716b5c,
  tamanoInicio: 0.1,
  tamanoFin: 0.22,
  gravedad: 0.5,
  arrastre: 1.2,
  desvanecido: 0.6,
};

// --- Textura compartida ---------------------------------------------------------

let texturaCache: THREE.DataTexture | null = null;

/** Punto suave con caída radial: un disco de luz, no un cuadrado recortado. */
function crearTexturaParticula(): THREE.DataTexture {
  if (texturaCache) return texturaCache;
  const n = 32;
  const datos = new Uint8Array(n * n * 4);
  const centro = (n - 1) / 2;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(i - centro, j - centro) / centro;
      const cobertura = Math.max(0, 1 - d);
      // Perfil suavizado: núcleo lleno y borde que se apaga en curva, no en rampa.
      const alfa = cobertura * cobertura * (3 - 2 * cobertura);
      const k = (j * n + i) * 4;
      datos[k] = 255;
      datos[k + 1] = 255;
      datos[k + 2] = 255;
      datos[k + 3] = Math.round(alfa * 255);
    }
  }
  const textura = new THREE.DataTexture(datos, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  textura.colorSpace = THREE.NoColorSpace;
  textura.needsUpdate = true;
  texturaCache = textura;
  return textura;
}

// --- Pool interno -----------------------------------------------------------

interface Pool {
  capacidad: number;
  cursor: number;
  sucio: boolean;
  puntos: THREE.Points;
  geometria: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  posicion: Float32Array;
  velocidad: Float32Array;
  colorInicio: Float32Array;
  colorFin: Float32Array;
  parametros: Float32Array;
  datos: Float32Array;
  uniformes: { uTiempo: { value: number } };
}

function crearPool(capacidad: number, aditivo: boolean, textura: THREE.Texture): Pool {
  const geometria = new THREE.BufferGeometry();

  const posicion = new Float32Array(capacidad * 3);
  const velocidad = new Float32Array(capacidad * 3);
  const colorInicio = new Float32Array(capacidad * 3);
  const colorFin = new Float32Array(capacidad * 3);
  const parametros = new Float32Array(capacidad * 4);
  // datos: x=nacimiento, y=duracion, z=desvanecido, w=semilla.
  const datos = new Float32Array(capacidad * 4);
  // Nacen "ya muertas": duracion=1 y nacimiento muy negativo, así t excede 1 y no dibujan nada.
  for (let i = 0; i < capacidad; i++) {
    datos[i * 4] = -1e6;
    datos[i * 4 + 1] = 1;
  }

  geometria.setAttribute('position', new THREE.BufferAttribute(posicion, 3).setUsage(THREE.DynamicDrawUsage));
  geometria.setAttribute('aVelocidad', new THREE.BufferAttribute(velocidad, 3).setUsage(THREE.DynamicDrawUsage));
  geometria.setAttribute('aColorInicio', new THREE.BufferAttribute(colorInicio, 3).setUsage(THREE.DynamicDrawUsage));
  geometria.setAttribute('aColorFin', new THREE.BufferAttribute(colorFin, 3).setUsage(THREE.DynamicDrawUsage));
  geometria.setAttribute('aParams', new THREE.BufferAttribute(parametros, 4).setUsage(THREE.DynamicDrawUsage));
  geometria.setAttribute('aDatos', new THREE.BufferAttribute(datos, 4).setUsage(THREE.DynamicDrawUsage));

  const uniformes = { uTiempo: { value: 0 } };

  const material = new THREE.PointsMaterial({
    size: 1,
    map: textura,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    blending: aditivo ? THREE.AdditiveBlending : THREE.NormalBlending,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniformes);

    shader.vertexShader =
      `
      attribute vec3 aVelocidad;
      attribute vec3 aColorInicio;
      attribute vec3 aColorFin;
      attribute vec4 aParams;
      attribute vec4 aDatos;
      uniform float uTiempo;
      varying vec4 vColor;
    ` +
      shader.vertexShader
        .replace(
          '#include <begin_vertex>',
          `
        #include <begin_vertex>
        float edad = uTiempo - aDatos.x;
        float vida = max(aDatos.y, 1e-4);
        float t = clamp(edad / vida, 0.0, 1.0);
        float k = aParams.w;
        vec3 desplazamiento = (k > 1e-4)
          ? aVelocidad / k * (1.0 - exp(-k * edad))
          : aVelocidad * edad;
        desplazamiento.y -= 0.5 * aParams.z * edad * edad;
        transformed = position + desplazamiento;

        float desvanecido = aDatos.z;
        float alfa = smoothstep(0.0, 0.05, t);
        float iniDesvanecido = max(0.0, 1.0 - desvanecido);
        if (t > iniDesvanecido) alfa *= 1.0 - smoothstep(iniDesvanecido, 1.0, t);
        bool viva = edad >= 0.0 && edad <= vida;
        vColor = vec4(mix(aColorInicio, aColorFin, t), viva ? alfa : 0.0);
        float vTamano = mix(aParams.x, aParams.y, t);
        `,
        )
        .replace('gl_PointSize = size;', 'gl_PointSize = size * vTamano;');

    shader.fragmentShader =
      `varying vec4 vColor;\n` +
      shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor *= vColor;`,
      );
  };
  // Clave de programa propia: sin esto three podría reciclar el programa de otro
  // material de puntos y el shader saldría sin nuestras variantes.
  material.customProgramCacheKey = () => `particulas-${aditivo ? 'a' : 'n'}`;

  const puntos = new THREE.Points(geometria, material);
  puntos.frustumCulled = false;
  // El sombreador coloca cada partícula por su cuenta a partir de `position` (el
  // origen) más el desplazamiento físico: el objeto en sí se queda quieto en (0,0,0).
  puntos.matrixAutoUpdate = false;

  return {
    capacidad,
    cursor: 0,
    sucio: false,
    puntos,
    geometria,
    material,
    posicion,
    velocidad,
    colorInicio,
    colorFin,
    parametros,
    datos,
    uniformes,
  };
}

function escribirEnPool(
  pool: Pool,
  emisor: EmisorParticulas,
  opciones: OpcionesEmision,
  tiempoActual: number,
  colorTmpA: THREE.Color,
  colorTmpB: THREE.Color,
): void {
  colorTmpA.setHex(emisor.colorInicio);
  colorTmpB.setHex(emisor.colorFin);

  const dirBaseX = opciones.dirX ?? 0;
  const dirBaseY = opciones.dirY ?? 1;
  const dirBaseZ = opciones.dirZ ?? 0;
  const normaBase = Math.hypot(dirBaseX, dirBaseY, dirBaseZ) || 1;
  const nx = dirBaseX / normaBase;
  const ny = dirBaseY / normaBase;
  const nz = dirBaseZ / normaBase;
  const escala = opciones.escala ?? 1;

  for (let n = 0; n < opciones.cantidad; n++) {
    const slot = pool.cursor;
    pool.cursor = (pool.cursor + 1) % pool.capacidad;

    const b3 = slot * 3;
    pool.posicion[b3] = opciones.x;
    pool.posicion[b3 + 1] = opciones.y;
    pool.posicion[b3 + 2] = opciones.z;

    // Jitter angular barato: desplaza la dirección base y renormaliza. No es un cono
    // exacto, pero para un efecto de partículas de combate es indistinguible y no
    // exige trigonometría por partícula.
    const disp = opciones.dispersion;
    let vx = nx + (Math.random() - 0.5) * disp;
    let vy = ny + (Math.random() - 0.5) * disp * 0.7;
    let vz = nz + (Math.random() - 0.5) * disp;
    const largo = Math.hypot(vx, vy, vz) || 1;
    const mag = opciones.velocidad * (0.72 + Math.random() * 0.56);
    vx = (vx / largo) * mag;
    vy = (vy / largo) * mag;
    vz = (vz / largo) * mag;

    pool.velocidad[b3] = vx;
    pool.velocidad[b3 + 1] = vy;
    pool.velocidad[b3 + 2] = vz;

    pool.colorInicio[b3] = colorTmpA.r;
    pool.colorInicio[b3 + 1] = colorTmpA.g;
    pool.colorInicio[b3 + 2] = colorTmpA.b;
    pool.colorFin[b3] = colorTmpB.r;
    pool.colorFin[b3 + 1] = colorTmpB.g;
    pool.colorFin[b3 + 2] = colorTmpB.b;

    const b4 = slot * 4;
    pool.parametros[b4] = emisor.tamanoInicio * escala;
    pool.parametros[b4 + 1] = emisor.tamanoFin * escala;
    pool.parametros[b4 + 2] = emisor.gravedad;
    pool.parametros[b4 + 3] = emisor.arrastre;

    pool.datos[b4] = tiempoActual;
    pool.datos[b4 + 1] = opciones.vidaMin + Math.random() * Math.max(0, opciones.vidaMax - opciones.vidaMin);
    pool.datos[b4 + 2] = emisor.desvanecido;
    pool.datos[b4 + 3] = Math.random();
  }

  pool.sucio = true;
}

export function crearSistemaParticulas(escena: THREE.Scene, calidad: CalidadRender): SistemaParticulas {
  const raiz = new THREE.Group();
  raiz.name = 'efectos-particulas';
  escena.add(raiz);

  const textura = crearTexturaParticula();

  const presupuesto = calidad.presupuestoParticulas;
  const capacidadAditivo = Math.max(24, Math.round(presupuesto * 0.32));
  const capacidadNormal = Math.max(24, presupuesto - capacidadAditivo);

  const poolAditivo = crearPool(capacidadAditivo, true, textura);
  const poolNormal = crearPool(capacidadNormal, false, textura);
  raiz.add(poolAditivo.puntos, poolNormal.puntos);

  // Reutilizados en cada llamada a `emitir`: cero asignaciones por partícula.
  const colorTmpA = new THREE.Color();
  const colorTmpB = new THREE.Color();

  let reloj = 0;

  function marcarActualizado(pool: Pool): void {
    pool.geometria.attributes.position!.needsUpdate = true;
    pool.geometria.attributes.aVelocidad!.needsUpdate = true;
    pool.geometria.attributes.aColorInicio!.needsUpdate = true;
    pool.geometria.attributes.aColorFin!.needsUpdate = true;
    pool.geometria.attributes.aParams!.needsUpdate = true;
    pool.geometria.attributes.aDatos!.needsUpdate = true;
    pool.sucio = false;
  }

  return {
    raiz,

    emitir(emisor: EmisorParticulas, opciones: OpcionesEmision): void {
      if (opciones.cantidad <= 0) return;
      const pool = emisor.aditivo ? poolAditivo : poolNormal;
      escribirEnPool(pool, emisor, opciones, reloj, colorTmpA, colorTmpB);
    },

    actualizar(dt: number): void {
      reloj += dt;
      poolAditivo.uniformes.uTiempo.value = reloj;
      poolNormal.uniformes.uTiempo.value = reloj;
      if (poolAditivo.sucio) marcarActualizado(poolAditivo);
      if (poolNormal.sucio) marcarActualizado(poolNormal);
    },

    liberar(): void {
      poolAditivo.geometria.dispose();
      poolAditivo.material.dispose();
      poolNormal.geometria.dispose();
      poolNormal.material.dispose();
      raiz.clear();
      escena.remove(raiz);
    },
  };
}
