import * as THREE from 'three';
import { DEG_A_RAD, limitar } from '../core/math';
import {
  INCLINACION_CAMARA,
  MARGEN_BORDE_CAMARA,
  VELOCIDAD_CAMARA,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../sim/constantes';
import type { CamaraJuego } from '../render/camara';

/**
 * Mecánica de movimiento de cámara: todo lo que no es «qué gesto es este» (eso es
 * `gestos.ts`) ni «qué tecla es esta» (`teclado.ts`), sino cómo se traduce cualquiera
 * de ellos en `camara.desplazar/acercar/girar`.
 *
 * Tres cosas merecen explicación porque no son obvias mirando solo `camara.ts`:
 *
 * 1. Arrastre con anclaje de mundo, no con una escala fija de píxeles.
 *    Tanto el arrastre de un dedo como el del botón central del ratón llaman a
 *    `arrastrar()`, que ancla el punto de terreno bajo el cursor: calcula dónde
 *    estaba ese punto antes del movimiento y dónde quedaría si no se corrigiera nada,
 *    y desplaza el objetivo justo esa diferencia. El resultado es que el suelo se
 *    queda pegado al dedo de verdad, a cualquier zoom y con cualquier inclinación,
 *    en vez de acercarse a ojo con una constante de píxeles-por-casilla que solo
 *    sería correcta a una distancia de cámara concreta.
 *
 * 2. Zoom hacia el cursor pese al suavizado de `camara.ts`.
 *    `camara.acercar()` no mueve la cámara: solo cambia `distanciaDeseada`, un campo
 *    privado que `camara.actualizar(dt)` persigue con suavizado exponencial fotograma
 *    a fotograma. Comparar «el punto bajo el cursor antes y después de llamar a
 *    acercar()» con la cámara real no sirve de nada: la distancia real todavía no
 *    se ha movido ni un milímetro en ese mismo instante, así que la diferencia
 *    siempre daría cero.
 *    Este módulo lleva su propia sombra de la distancia deseada (`distanciaSombra`,
 *    actualizada solo por sus propias llamadas a `acercar()`) y con ella construye,
 *    con la misma fórmula esférica que usa `camara.aplicar()` puertas adentro
 *    —posición de cámara y la inclinación que depende de la distancia—, una cámara
 *    hipotética para el «después». Con eso sí se puede calcular la corrección real
 *    y aplicarla de inmediato a `objetivoXDeseado/ZDeseado` en vez de esperar a que
 *    el suavizado termine de converger.
 *    Aproximación asumida: el plano de referencia para esa cámara hipotética es
 *    `y = 0`, no el relieve real (`camara.mapa` es privado y no hace falta: el error
 *    que introduce es de segundo orden entre dos distancias muy próximas y con la
 *    inercia de una rueda o un pellizco disparando esto muchas veces por segundo,
 *    se corrige solo en el fotograma siguiente).
 *
 * 3. Inercia con decaimiento exponencial, no un contador de fotogramas.
 *    Al soltar el dedo, la velocidad del último tramo de arrastre se guarda y
 *    `actualizar(dt)` la va aplicando y atenuando con la misma familia de fórmulas
 *    que usa el resto del juego (`Math.exp`), así que la desaceleración es la misma
 *    a 30 que a 120 Hz.
 */

/** Cuánto se atenúa la velocidad de inercia por segundo. Mayor = frena antes. */
const AMORTIGUACION_INERCIA = 3.4;

/** Por debajo de esta velocidad (casillas/seg) la inercia se da por terminada. */
const VELOCIDAD_MINIMA_INERCIA = 0.05;

/** Factor de zoom que aplica cada muesca de la rueda del ratón. */
export const FACTOR_RUEDA = 1.12;

// --- Escena auxiliar reutilizada para el cálculo de «hacia dónde apuntaría la
// cámara si su distancia fuera esta otra». Se crea una sola vez: es la misma idea
// de «cero basura por evento» que pide el encargo, aplicada a un objeto en vez de
// a un simple número. ---
const camaraSombra = new THREE.PerspectiveCamera(28, 1, 0.5, 500);
const rayoSombra = new THREE.Raycaster();
const planoSombra = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndcSombraTmp = new THREE.Vector2();
const puntoSombraTmp = new THREE.Vector3();
const puntoAntesTmp = { x: 0, z: 0 };
const puntoDespuesTmp = { x: 0, z: 0 };
const puntoArrastreATmp = new THREE.Vector3();
const puntoArrastreBTmp = new THREE.Vector3();
const ndcArrastreTmp = { x: 0, y: 0 };

/**
 * Punto de terreno (aprox., plano y=0) que se vería en (ndcX, ndcY) si la cámara
 * tuviera esta `distancia` en vez de la actual. Reutiliza la fórmula esférica de
 * `camara.aplicar()`, apoyándose solo en los campos públicos de `CamaraJuego`.
 */
function puntoParaDistancia(
  camara: CamaraJuego,
  distancia: number,
  ndcX: number,
  ndcY: number,
  salida: { x: number; z: number },
): boolean {
  const t = limitar((distancia - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN), 0, 1);
  const inclinacion = (INCLINACION_CAMARA + t * 8) * DEG_A_RAD;
  const cosInc = Math.cos(inclinacion);
  const senInc = Math.sin(inclinacion);

  const px = camara.objetivoX - Math.sin(camara.azimut) * distancia * cosInc;
  const py = distancia * senInc;
  const pz = camara.objetivoZ - Math.cos(camara.azimut) * distancia * cosInc;

  camaraSombra.fov = camara.nucleo.fov;
  camaraSombra.aspect = camara.nucleo.aspect;
  camaraSombra.near = 0.1;
  camaraSombra.far = distancia * 8 + 200;
  camaraSombra.updateProjectionMatrix();
  camaraSombra.position.set(px, py, pz);
  camaraSombra.lookAt(camara.objetivoX, 0, camara.objetivoZ);
  camaraSombra.updateMatrixWorld(true);

  ndcSombraTmp.set(ndcX, ndcY);
  rayoSombra.setFromCamera(ndcSombraTmp, camaraSombra);
  if (!rayoSombra.ray.intersectPlane(planoSombra, puntoSombraTmp)) return false;
  salida.x = puntoSombraTmp.x;
  salida.z = puntoSombraTmp.z;
  return true;
}

/**
 * Aplica un desplazamiento en unidades de mundo (no de pantalla) al objetivo de la
 * cámara. `camara.desplazar` rota su entrada por el azimut para que un arrastre en
 * pantalla siga siendo intuitivo tras girar la cámara; aquí se deshace exactamente
 * esa rotación para que el resultado neto sea el delta de mundo pedido, sin
 * importar hacia dónde mire la cámara en este momento.
 */
function desplazarEnMundo(camara: CamaraJuego, deltaX: number, deltaZ: number): void {
  if (deltaX === 0 && deltaZ === 0) return;
  const cos = Math.cos(camara.azimut);
  const sen = Math.sin(camara.azimut);
  const dx = deltaX * cos + deltaZ * sen;
  const dz = -deltaX * sen + deltaZ * cos;
  camara.desplazar(dx, dz);
}

export class ControlCamara {
  private readonly camara: CamaraJuego;

  /** Sombra de la distancia deseada; solo la mueven las llamadas propias a `acercar`. */
  private distanciaSombra: number;

  // --- Inercia del arrastre ---
  private velocidadX = 0;
  private velocidadZ = 0;
  private arrastrando = false;

  // --- Borde de pantalla (solo ratón) ---
  private ratonEnBorde = false;
  private direccionBordeX = 0;
  private direccionBordeZ = 0;

  // --- Dirección continua pedida por teclado ---
  private direccionTecladoX = 0;
  private direccionTecladoZ = 0;

  /** Preferencia del jugador (menú de opciones), aplicada al arrastre por teclado y borde. */
  private multiplicadorVelocidad = 1;

  constructor(camara: CamaraJuego) {
    this.camara = camara;
    this.distanciaSombra = camara.distancia;
  }

  fijarMultiplicadorVelocidad(multiplicador: number): void {
    this.multiplicadorVelocidad = multiplicador;
  }

  // --- Arrastre (un dedo táctil o botón central del ratón) ---

  iniciarArrastre(): void {
    this.arrastrando = true;
    this.velocidadX = 0;
    this.velocidadZ = 0;
  }

  /**
   * `dxPantalla/dyPantalla` son el delta en píxeles desde el último movimiento;
   * `xPantalla/yPantalla` la posición actual, para poder reconstruir el punto de
   * partida. `rect` es el rectángulo del lienzo en coordenadas de cliente.
   */
  arrastrar(
    dxPantalla: number,
    dyPantalla: number,
    xPantalla: number,
    yPantalla: number,
    rect: { left: number; top: number; width: number; height: number },
    dt: number,
  ): void {
    ndcArrastreTmp.x = ((xPantalla - dxPantalla - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndcArrastreTmp.y = -((yPantalla - dyPantalla - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    const okAntes = this.camara.puntoEnSuelo(ndcArrastreTmp.x, ndcArrastreTmp.y, puntoArrastreATmp);

    ndcArrastreTmp.x = ((xPantalla - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndcArrastreTmp.y = -((yPantalla - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    const okDespues = this.camara.puntoEnSuelo(ndcArrastreTmp.x, ndcArrastreTmp.y, puntoArrastreBTmp);

    if (!okAntes || !okDespues) return;

    const deltaX = puntoArrastreATmp.x - puntoArrastreBTmp.x;
    const deltaZ = puntoArrastreATmp.z - puntoArrastreBTmp.z;
    desplazarEnMundo(this.camara, deltaX, deltaZ);

    // Velocidad instantánea de este tramo, en casillas/segundo: es lo que hereda la
    // inercia al soltar. Un `dt` de un fotograma es ruidoso, pero el promedio móvil
    // implícito de reemplazar el valor en cada evento (en vez de acumularlo) evita
    // que un tirón brusco puntual dispare una inercia desproporcionada.
    if (dt > 0) {
      this.velocidadX = deltaX / dt;
      this.velocidadZ = deltaZ / dt;
    }
  }

  soltarArrastre(): void {
    this.arrastrando = false;
    // La velocidad que quedó registrada en el último `arrastrar()` es el impulso de
    // inercia; `actualizar()` se encarga de decaerla.
  }

  detenerInercia(): void {
    this.velocidadX = 0;
    this.velocidadZ = 0;
  }

  // --- Borde de pantalla (ratón) ---

  /**
   * Se llama en cada `pointermove` del ratón, se esté pulsando un botón o no: el
   * desplazamiento por borde es pasivo, como en cualquier RTS de escritorio clásico.
   */
  actualizarBorde(
    xPantalla: number,
    yPantalla: number,
    anchoLienzo: number,
    altoLienzo: number,
  ): void {
    let dx = 0;
    let dz = 0;
    if (xPantalla <= MARGEN_BORDE_CAMARA) dx = -1;
    else if (xPantalla >= anchoLienzo - MARGEN_BORDE_CAMARA) dx = 1;
    if (yPantalla <= MARGEN_BORDE_CAMARA) dz = -1;
    else if (yPantalla >= altoLienzo - MARGEN_BORDE_CAMARA) dz = 1;

    this.ratonEnBorde = dx !== 0 || dz !== 0;
    this.direccionBordeX = dx;
    this.direccionBordeZ = dz;
  }

  /** El ratón ha salido del lienzo: no hay borde que valga. */
  limpiarBorde(): void {
    this.ratonEnBorde = false;
    this.direccionBordeX = 0;
    this.direccionBordeZ = 0;
  }

  // --- Teclado ---

  /** `dx`/`dz` ya normalizados a norma <= 1 por `teclado.ts`. */
  fijarDireccionTeclado(dx: number, dz: number): void {
    this.direccionTecladoX = dx;
    this.direccionTecladoZ = dz;
  }

  // --- Zoom ---

  /**
   * Zoom multiplicativo anclado al punto de pantalla `(ndcX, ndcY)` (coordenadas
   * NDC, no píxeles: lo convierte quien llama, que ya conoce el rectángulo del
   * lienzo). Sirve tanto para la rueda del ratón como para el pellizco de dos dedos.
   */
  acercarHaciaPunto(factor: number, ndcX: number, ndcY: number): void {
    const nuevaSombra = limitar(this.distanciaSombra * factor, ZOOM_MIN, ZOOM_MAX);
    const okAntes = puntoParaDistancia(this.camara, this.distanciaSombra, ndcX, ndcY, puntoAntesTmp);
    const okDespues = puntoParaDistancia(this.camara, nuevaSombra, ndcX, ndcY, puntoDespuesTmp);

    this.camara.acercar(factor);
    this.distanciaSombra = nuevaSombra;

    if (okAntes && okDespues) {
      desplazarEnMundo(this.camara, puntoAntesTmp.x - puntoDespuesTmp.x, puntoAntesTmp.z - puntoDespuesTmp.z);
    }
  }

  girar(deltaRadianes: number): void {
    this.camara.girar(deltaRadianes);
  }

  // --- Fotograma ---

  actualizar(dt: number): void {
    // Inercia: solo corre cuando no se está arrastrando activamente.
    if (!this.arrastrando) {
      const rapidez = Math.hypot(this.velocidadX, this.velocidadZ);
      if (rapidez > VELOCIDAD_MINIMA_INERCIA) {
        desplazarEnMundo(this.camara, this.velocidadX * dt, this.velocidadZ * dt);
        const decaimiento = Math.exp(-AMORTIGUACION_INERCIA * dt);
        this.velocidadX *= decaimiento;
        this.velocidadZ *= decaimiento;
      } else {
        this.velocidadX = 0;
        this.velocidadZ = 0;
      }
    }

    // Borde de pantalla y teclado se combinan (mano en el teclado y ratón en el
    // borde a la vez es raro, pero no hay motivo para que se estorben).
    let dx = this.direccionTecladoX;
    let dz = this.direccionTecladoZ;
    if (this.ratonEnBorde) {
      dx += this.direccionBordeX;
      dz += this.direccionBordeZ;
    }
    if (dx !== 0 || dz !== 0) {
      const longitud = Math.hypot(dx, dz);
      const factorNormalizado = longitud > 1 ? 1 / longitud : 1;
      const velocidad = VELOCIDAD_CAMARA * this.multiplicadorVelocidad;
      this.camara.desplazar(
        dx * factorNormalizado * velocidad * dt,
        dz * factorNormalizado * velocidad * dt,
      );
    }
  }
}
