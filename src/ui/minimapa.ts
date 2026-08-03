import type { CamaraJuego } from '../render/camara';
import type { Mundo } from '../sim/mundo';
import { Bando, Clase, Vision } from '../sim/tipos';

/**
 * Minimapa: terreno cacheado + niebla de guerra + puntos + rectángulo de cámara.
 *
 * El terreno no cambia casi nunca (una vez que el mapa está generado, solo un
 * puñado de casillas mudan de tipo al construir sobre tierra), así que se pinta
 * una única vez en un `<canvas>` fuera de pantalla, a razón de un texel por
 * casilla. Cada repintado real solo escala esa caché sobre el lienzo visible y
 * dibuja encima la niebla, los puntos y el rectángulo de la cámara.
 *
 * Ese segundo repintado tampoco corre a 60 Hz: la niebla y las posiciones no
 * necesitan esa frecuencia para leerse bien, así que se limita a 10 Hz con un
 * acumulador de tiempo. `actualizar` puede (y en `Hud` lo hace) llamarse cada
 * fotograma sin que eso cueste nada de más.
 */
export interface Minimapa {
  readonly raiz: HTMLElement;
  actualizar(mundo: Mundo, camara: CamaraJuego | null, dt: number): void;
  alPulsar(cb: (x: number, z: number) => void): void;
  liberar(): void;
}

/** Cuántas veces por segundo se repintan niebla, puntos y cámara. */
const HERCIOS_REPINTADO = 10;
const PERIODO_REPINTADO = 1 / HERCIOS_REPINTADO;

const COLOR_TERRENO: Record<number, [number, number, number]> = {
  0: [90, 110, 58], // HIERBA
  1: [107, 88, 58], // TIERRA
  2: [126, 108, 74], // CAMINO
  3: [90, 84, 76], // ROCA
  4: [58, 96, 122], // AGUA_BAJA
  5: [30, 58, 92], // AGUA_PROFUNDA
  6: [46, 74, 40], // BOSQUE
  7: [56, 50, 44], // ACANTILADO
};

const COLOR_PUNTO_BANDO: Record<number, string> = {
  [Bando.NEUTRAL]: '#c9b98a',
  [Bando.HUMANOS]: '#5c9bea',
  [Bando.ORCOS]: '#e0503a',
};

export function crearMinimapa(bandoJugador: Bando): Minimapa {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-panel gwn-minimapa';
  raiz.setAttribute('aria-label', 'Minimapa');

  const lienzo = document.createElement('canvas');
  lienzo.width = 256;
  lienzo.height = 256;
  raiz.appendChild(lienzo);
  const ctx = lienzo.getContext('2d')!;

  // Caché de terreno fuera de pantalla, un texel por casilla del mapa.
  let cacheTerreno: HTMLCanvasElement | null = null;
  let anchoMapaCacheado = 0;
  let altoMapaCacheado = 0;

  let escucha: (x: number, z: number) => void = () => {};
  let acumulado = PERIODO_REPINTADO; // fuerza un primer repintado inmediato

  function reconstruirCacheTerreno(mundo: Mundo): void {
    const mapa = mundo.mapa;
    anchoMapaCacheado = mapa.ancho;
    altoMapaCacheado = mapa.alto;

    const off = document.createElement('canvas');
    off.width = mapa.ancho;
    off.height = mapa.alto;
    const offCtx = off.getContext('2d')!;
    const imagen = offCtx.createImageData(mapa.ancho, mapa.alto);

    for (let cz = 0; cz < mapa.alto; cz++) {
      for (let cx = 0; cx < mapa.ancho; cx++) {
        const i = cz * mapa.ancho + cx;
        const tipo = mapa.casillas[i]!;
        const color = COLOR_TERRENO[tipo] ?? COLOR_TERRENO[0]!;
        // Una pizca de la variación pseudoaleatoria de la casilla rompe el aspecto
        // de trama plana sin necesitar ninguna consulta adicional.
        const variacion = ((mapa.variacion[i]! / 255) * 14 - 7) | 0;
        const p = i * 4;
        imagen.data[p] = clamp8(color[0] + variacion);
        imagen.data[p + 1] = clamp8(color[1] + variacion);
        imagen.data[p + 2] = clamp8(color[2] + variacion);
        imagen.data[p + 3] = 255;
      }
    }
    offCtx.putImageData(imagen, 0, 0);
    cacheTerreno = off;
  }

  function clamp8(v: number): number {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function repintar(mundo: Mundo, camara: CamaraJuego | null): void {
    const mapa = mundo.mapa;
    if (!cacheTerreno || anchoMapaCacheado !== mapa.ancho || altoMapaCacheado !== mapa.alto) {
      reconstruirCacheTerreno(mundo);
    }

    const w = lienzo.width;
    const h = lienzo.height;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cacheTerreno!, 0, 0, w, h);

    // --- Niebla de guerra del bando del jugador ---
    const vision = mapa.vision[bandoJugador];
    if (vision) {
      const celdaW = w / mapa.ancho;
      const celdaH = h / mapa.alto;
      // Recorrer casilla a casilla en el lienzo visible (256x256) es barato: como
      // mucho unos pocos miles de rectángulos, y solo diez veces por segundo.
      for (let cz = 0; cz < mapa.alto; cz++) {
        const fila = cz * mapa.ancho;
        for (let cx = 0; cx < mapa.ancho; cx++) {
          const v = vision[fila + cx];
          if (v === Vision.VISIBLE) continue;
          ctx.fillStyle = v === Vision.OCULTO ? 'rgba(4,3,2,0.94)' : 'rgba(4,3,2,0.55)';
          ctx.fillRect(cx * celdaW, cz * celdaH, celdaW + 0.6, celdaH + 0.6);
        }
      }
    }

    // --- Unidades y edificios ---
    const escalaX = w / (mapa.ancho * 1); // TAM_CASILLA = 1, casillas == unidades de mundo
    const escalaZ = h / (mapa.alto * 1);
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] !== 1) continue;
      const clase = mundo.clase[i];
      if (clase !== Clase.UNIDAD && clase !== Clase.EDIFICIO) continue;

      const esPropio = bando(mundo, i) === bandoJugador;
      if (!esPropio) {
        const cx = mundo.mapa.aCasilla(mundo.x[i]!);
        const cz = mundo.mapa.aCasilla(mundo.z[i]!);
        const visto = mapa.visionEn(bandoJugador, cx, cz);
        // Las unidades enemigas solo se ven bajo vigilancia activa; los edificios,
        // además, se recuerdan donde se vieron por última vez, como en cualquier
        // RTS clásico. Lo propio siempre se conoce, esté o no a la vista ahora mismo.
        if (clase === Clase.UNIDAD && visto !== Vision.VISIBLE) continue;
        if (clase === Clase.EDIFICIO && visto === Vision.OCULTO) continue;
      }

      const px = mundo.x[i]! * escalaX;
      const pz = mundo.z[i]! * escalaZ;
      ctx.fillStyle = COLOR_PUNTO_BANDO[mundo.bando[i]!] ?? '#c9b98a';
      const radio = clase === Clase.EDIFICIO ? Math.max(2.2, mundo.huella[i]! * 0.9) : 1.6;
      ctx.beginPath();
      ctx.arc(px, pz, radio, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Rectángulo de la vista de cámara ---
    if (camara) {
      const anchoVisible = camara.anchoVisible;
      const altoVisible = anchoVisible / Math.max(0.1, camara.nucleo.aspect);
      const rx = (camara.objetivoX - anchoVisible / 2) * escalaX;
      const rz = (camara.objetivoZ - altoVisible / 2) * escalaZ;
      ctx.strokeStyle = 'rgba(255, 231, 166, 0.9)';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(rx, rz, anchoVisible * escalaX, altoVisible * escalaZ);
    }
  }

  function bando(mundo: Mundo, i: number): Bando {
    return mundo.bando[i]! as Bando;
  }

  lienzo.addEventListener('click', (evento) => {
    const rect = lienzo.getBoundingClientRect();
    const fx = (evento.clientX - rect.left) / rect.width;
    const fz = (evento.clientY - rect.top) / rect.height;
    escucha(fx * anchoMapaCacheado, fz * altoMapaCacheado);
  });

  return {
    raiz,

    actualizar(mundo: Mundo, camara: CamaraJuego | null, dt: number): void {
      acumulado += dt;
      if (acumulado < PERIODO_REPINTADO) return;
      acumulado = 0;
      repintar(mundo, camara);
    },

    alPulsar(cb: (x: number, z: number) => void): void {
      escucha = cb;
    },

    liberar(): void {
      raiz.remove();
    },
  };
}
