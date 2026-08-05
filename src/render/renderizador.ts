import * as THREE from 'three';
import { ESCALA_RENDER_MAX, ESCALA_RENDER_MIN, FPS_OBJETIVO } from '../sim/constantes';
import { limitar } from '../core/math';

/**
 * Clasificación del dispositivo.
 *
 * Un RTS tiene que verse bien en un portátil de 2019 y en un móvil de gama media a la
 * vez. En lugar de esparcir comprobaciones por todo el código, se decide una sola vez
 * aquí y cada subsistema consulta el nivel para elegir su presupuesto.
 */
export type NivelDispositivo = 'bajo' | 'medio' | 'alto';

export interface CalidadRender {
  nivel: NivelDispositivo;
  /** Resolución de los mapas de sombra. 0 = sin sombras dinámicas. */
  resolucionSombras: number;
  /** Antialiasing por hardware (MSAA). En móvil sale caro. */
  antialiasing: boolean;
  /** Densidad máxima de píxeles. Los móviles mienten con devicePixelRatio 3 o 4. */
  pixelRatioMaximo: number;
  /** Permitir la cadena de post-procesado. */
  postProceso: boolean;
  /** Número de partículas simultáneas permitido. */
  presupuestoParticulas: number;
  /** Distancia en casillas a la que la vegetación deja de dibujarse. */
  distanciaVegetacion: number;
  /** Anisotropía de las texturas del terreno. */
  anisotropia: number;
}

/** Deduce la potencia del dispositivo con las pistas que da el navegador. */
export function detectarNivel(gl: WebGL2RenderingContext | WebGLRenderingContext): NivelDispositivo {
  const preferencia = nivelPreferidoManualmente();
  if (preferencia) return preferencia;

  const esTactil = matchMedia('(pointer: coarse)').matches;
  const nucleos = navigator.hardwareConcurrency ?? 4;
  const memoria = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const maxTextura = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  let puntos = 0;
  if (nucleos >= 8) puntos += 2;
  else if (nucleos >= 6) puntos += 1;
  if (memoria >= 8) puntos += 2;
  else if (memoria >= 4) puntos += 1;
  if (maxTextura >= 16384) puntos += 1;
  // En un móvil, la GPU siempre rinde menos de lo que sugieren los núcleos de CPU.
  if (esTactil) puntos -= 2;

  if (puntos >= 4) return 'alto';
  if (puntos >= 1) return 'medio';
  return 'bajo';
}

/**
 * Lee la calidad que el jugador haya fijado a mano en el menú de opciones
 * (`ui/menus.ts`, misma clave de `localStorage`). 'auto' o cualquier fallo de
 * lectura deja el resultado en manos de la detección automática de arriba: el
 * cambio de calidad manual se aplica al recargar, no reconstruye el motor de
 * render a mitad de partida.
 */
function nivelPreferidoManualmente(): NivelDispositivo | null {
  try {
    const crudo = localStorage.getItem('gwn-hud-opciones');
    if (!crudo) return null;
    const opciones = JSON.parse(crudo) as { calidadGrafica?: string };
    if (opciones.calidadGrafica === 'bajo' || opciones.calidadGrafica === 'medio' || opciones.calidadGrafica === 'alto') {
      return opciones.calidadGrafica;
    }
    return null;
  } catch {
    return null;
  }
}

export function calidadPara(nivel: NivelDispositivo): CalidadRender {
  switch (nivel) {
    case 'alto':
      return {
        nivel,
        resolucionSombras: 2048,
        antialiasing: true,
        pixelRatioMaximo: 2,
        postProceso: true,
        presupuestoParticulas: 2400,
        distanciaVegetacion: 60,
        anisotropia: 8,
      };
    case 'medio':
      return {
        nivel,
        resolucionSombras: 1024,
        antialiasing: false,
        pixelRatioMaximo: 1.5,
        postProceso: true,
        presupuestoParticulas: 1000,
        distanciaVegetacion: 42,
        anisotropia: 4,
      };
    default:
      return {
        nivel,
        resolucionSombras: 0,
        antialiasing: false,
        pixelRatioMaximo: 1,
        postProceso: false,
        presupuestoParticulas: 350,
        distanciaVegetacion: 28,
        anisotropia: 1,
      };
  }
}

/**
 * Envoltorio del renderizador de Three.js.
 *
 * Además de la configuración de color y sombras, gestiona la resolución dinámica:
 * cuando los fotogramas empiezan a costar de más, baja la resolución interna antes
 * de que el jugador note una caída de fps. Perder nitidez es mucho menos molesto que
 * perder fluidez, y en una pantalla de móvil apenas se aprecia.
 */
export class Renderizador {
  readonly nucleo: THREE.WebGLRenderer;
  readonly lienzo: HTMLCanvasElement;
  readonly calidad: CalidadRender;

  /** Escala de resolución actual, entre ESCALA_RENDER_MIN y ESCALA_RENDER_MAX. */
  escala = ESCALA_RENDER_MAX;

  private anchoCss = 1;
  private altoCss = 1;
  private acumuladorAjuste = 0;
  private muestrasMs: number[] = [];

  constructor(lienzo: HTMLCanvasElement) {
    this.lienzo = lienzo;

    // Pedimos contexto WebGL 2 explícitamente: los shaders del terreno lo dan por hecho.
    const contexto = lienzo.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      // 'high-performance' pide la GPU dedicada en portátiles con gráfica doble.
      powerPreference: 'high-performance',
      // Sin esto, algunos navegadores móviles descartan el búfer antes de que podamos leerlo.
      preserveDrawingBuffer: false,
    });

    if (!contexto) {
      throw new Error('Este navegador no soporta WebGL 2, necesario para el terreno y la niebla.');
    }

    this.calidad = calidadPara(detectarNivel(contexto));

    this.nucleo = new THREE.WebGLRenderer({
      canvas: lienzo,
      context: contexto,
      antialias: this.calidad.antialiasing,
    });

    // Espacio de color: trabajamos en lineal y presentamos en sRGB. Sin esto los
    // degradados del terreno se ven lavados y las sombras, sucias.
    this.nucleo.outputColorSpace = THREE.SRGBColorSpace;

    // ACES comprime los altos con elegancia: el sol en el metal deja de ser un
    // recorte blanco plano y pasa a tener color. Es la mitad del aspecto de gama alta.
    this.nucleo.toneMapping = THREE.ACESFilmicToneMapping;
    this.nucleo.toneMappingExposure = 1.05;

    this.nucleo.shadowMap.enabled = this.calidad.resolucionSombras > 0;
    this.nucleo.shadowMap.type = THREE.PCFSoftShadowMap;

    this.nucleo.setClearColor(0x0a0805, 1);
    this.nucleo.info.autoReset = false;

    this.redimensionar();
  }

  /** Píxeles por unidad CSS, ya recortado según la calidad y la escala dinámica. */
  private get densidad(): number {
    return Math.min(devicePixelRatio || 1, this.calidad.pixelRatioMaximo) * this.escala;
  }

  redimensionar(): void {
    const ancho = this.lienzo.clientWidth || window.innerWidth;
    const alto = this.lienzo.clientHeight || window.innerHeight;
    this.anchoCss = ancho;
    this.altoCss = alto;
    this.nucleo.setPixelRatio(this.densidad);
    // `false` evita que Three toque los estilos CSS del lienzo: el tamaño en pantalla
    // lo manda el layout, no el renderizador.
    this.nucleo.setSize(ancho, alto, false);
  }

  get relacionAspecto(): number {
    return this.anchoCss / Math.max(1, this.altoCss);
  }

  get ancho(): number {
    return this.anchoCss;
  }

  get alto(): number {
    return this.altoCss;
  }

  /**
   * Ajusta la resolución interna según el coste de los últimos fotogramas.
   *
   * Se toman muestras durante medio segundo y se usa la mediana, no la media: un solo
   * fotograma malo (una recolección de basura, un cambio de pestaña) no debe provocar
   * un cambio de resolución visible.
   */
  ajustarResolucion(msFotograma: number, dt: number): void {
    this.muestrasMs.push(msFotograma);
    if (this.muestrasMs.length > 30) this.muestrasMs.shift();

    this.acumuladorAjuste += dt;
    if (this.acumuladorAjuste < 0.5 || this.muestrasMs.length < 10) return;
    this.acumuladorAjuste = 0;

    const ordenadas = [...this.muestrasMs].sort((a, b) => a - b);
    const mediana = ordenadas[Math.floor(ordenadas.length / 2)]!;
    const presupuesto = 1000 / FPS_OBJETIVO;

    let nueva = this.escala;
    if (mediana > presupuesto * 1.25) {
      nueva -= 0.1;
    } else if (mediana < presupuesto * 0.7) {
      // Subimos más despacio de lo que bajamos, para no oscilar en el umbral.
      nueva += 0.05;
    }

    nueva = limitar(nueva, ESCALA_RENDER_MIN, ESCALA_RENDER_MAX);
    if (Math.abs(nueva - this.escala) > 0.001) {
      this.escala = nueva;
      this.nucleo.setPixelRatio(this.densidad);
      this.nucleo.setSize(this.anchoCss, this.altoCss, false);
    }
  }

  /** Estadísticas del último fotograma, para el panel de depuración. */
  instantanea(): { llamadas: number; triangulos: number; texturas: number; programas: number } {
    const info = this.nucleo.info;
    return {
      llamadas: info.render.calls,
      triangulos: info.render.triangles,
      texturas: info.memory.textures,
      programas: info.programs?.length ?? 0,
    };
  }

  reiniciarEstadisticas(): void {
    this.nucleo.info.reset();
  }

  liberar(): void {
    this.nucleo.dispose();
  }
}
