import * as THREE from 'three';
import {
  AZIMUT_CAMARA,
  INCLINACION_CAMARA,
  ZOOM_INICIAL,
  ZOOM_MAX,
  ZOOM_MIN,
} from '../sim/constantes';
import { DEG_A_RAD, limitar, mezclarExp } from '../core/math';
import type { MapaJuego } from '../sim/mapa';

/**
 * Cámara de estrategia.
 *
 * Es una perspectiva con un ángulo de visión estrecho (28°), no una ortográfica.
 * La elección importa: la ortográfica da el isométrico exacto de los clásicos en 2D,
 * pero aplana el relieve y mata las sombras largas. Un teleobjetivo virtual conserva
 * casi toda la lectura isométrica y a cambio devuelve profundidad, paralaje al
 * desplazarse y volumen en los edificios.
 *
 * El objetivo de la cámara es siempre un punto del suelo. Todo lo demás —distancia,
 * inclinación, giro— orbita alrededor de él.
 */
export class CamaraJuego {
  readonly nucleo: THREE.PerspectiveCamera;

  /** Punto del suelo al que mira la cámara. */
  objetivoX: number;
  objetivoZ: number;

  /** Distancia al objetivo. Es el zoom. */
  distancia = ZOOM_INICIAL;

  /** Inclinación sobre el horizonte, en radianes. */
  inclinacion = INCLINACION_CAMARA * DEG_A_RAD;

  /** Giro alrededor del eje vertical, en radianes. */
  azimut = AZIMUT_CAMARA * DEG_A_RAD;

  // Valores deseados; los reales los persiguen con suavizado.
  private objetivoXDeseado: number;
  private objetivoZDeseado: number;
  private distanciaDeseada = ZOOM_INICIAL;
  private azimutDeseado = AZIMUT_CAMARA * DEG_A_RAD;

  /** Sacudida por impactos, decae sola. */
  private sacudida = 0;
  private semillaSacudida = 0;

  private mapa: MapaJuego;
  private plano = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private rayo = new THREE.Raycaster();
  private vector = new THREE.Vector3();
  private vector2 = new THREE.Vector2();

  constructor(mapa: MapaJuego, aspecto: number) {
    this.mapa = mapa;
    this.objetivoX = mapa.ancho * 0.5;
    this.objetivoZ = mapa.alto * 0.5;
    this.objetivoXDeseado = this.objetivoX;
    this.objetivoZDeseado = this.objetivoZ;

    this.nucleo = new THREE.PerspectiveCamera(28, aspecto, 1, 400);
    this.aplicar();
  }

  // --- Control ---

  /**
   * Desplaza el objetivo en coordenadas de pantalla.
   * Convierte el arrastre del dedo o del ratón al plano del suelo teniendo en cuenta
   * el giro actual, de modo que arrastrar hacia arriba siempre aleja la vista aunque
   * la cámara esté rotada.
   */
  desplazar(dx: number, dz: number): void {
    const cos = Math.cos(this.azimut);
    const sen = Math.sin(this.azimut);
    this.objetivoXDeseado += dx * cos - dz * sen;
    this.objetivoZDeseado += dx * sen + dz * cos;
    this.limitarObjetivo();
  }

  /** Coloca la cámara sobre un punto sin transición. */
  saltarA(x: number, z: number): void {
    this.objetivoXDeseado = x;
    this.objetivoZDeseado = z;
    this.limitarObjetivo();
    this.objetivoX = this.objetivoXDeseado;
    this.objetivoZ = this.objetivoZDeseado;
    this.aplicar();
  }

  /** Desliza suavemente hasta un punto (minimapa, aviso de ataque). */
  irA(x: number, z: number): void {
    this.objetivoXDeseado = x;
    this.objetivoZDeseado = z;
    this.limitarObjetivo();
  }

  /** Zoom multiplicativo: cada muesca acerca un porcentaje, no una cantidad fija. */
  acercar(factor: number): void {
    this.distanciaDeseada = limitar(this.distanciaDeseada * factor, ZOOM_MIN, ZOOM_MAX);
  }

  girar(deltaRadianes: number): void {
    this.azimutDeseado += deltaRadianes;
  }

  /** Devuelve el giro al ángulo canónico. */
  reiniciarGiro(): void {
    this.azimutDeseado = AZIMUT_CAMARA * DEG_A_RAD;
  }

  /** Sacude la cámara. `fuerza` en unidades de mundo; se acumula pero se satura. */
  sacudir(fuerza: number): void {
    this.sacudida = Math.min(0.55, this.sacudida + fuerza);
  }

  private limitarObjetivo(): void {
    // Dejamos asomar un poco fuera del mapa: encajonar la cámara justo en el borde
    // hace que las bases de las esquinas resulten incómodas de manejar.
    const margen = 6;
    this.objetivoXDeseado = limitar(this.objetivoXDeseado, -margen, this.mapa.ancho + margen);
    this.objetivoZDeseado = limitar(this.objetivoZDeseado, -margen, this.mapa.alto + margen);
  }

  // --- Actualización ---

  actualizar(dt: number): void {
    this.objetivoX = mezclarExp(this.objetivoX, this.objetivoXDeseado, 18, dt);
    this.objetivoZ = mezclarExp(this.objetivoZ, this.objetivoZDeseado, 18, dt);
    this.distancia = mezclarExp(this.distancia, this.distanciaDeseada, 12, dt);
    this.azimut = mezclarExp(this.azimut, this.azimutDeseado, 10, dt);

    // Al alejarse conviene bajar un poco la cámara: se gana visión del campo de batalla
    // sin que la vista se convierta en un plano cenital sin volumen.
    const t = (this.distancia - ZOOM_MIN) / (ZOOM_MAX - ZOOM_MIN);
    this.inclinacion = (INCLINACION_CAMARA + t * 8) * DEG_A_RAD;

    if (this.sacudida > 0) {
      this.sacudida = Math.max(0, this.sacudida - dt * 1.8);
      this.semillaSacudida += dt * 42;
    }

    this.aplicar();
  }

  private aplicar(): void {
    const alturaSuelo = this.mapa.alturaEnMundo(this.objetivoX, this.objetivoZ);

    const cosInc = Math.cos(this.inclinacion);
    const senInc = Math.sin(this.inclinacion);

    let px = this.objetivoX - Math.sin(this.azimut) * this.distancia * cosInc;
    let py = alturaSuelo + this.distancia * senInc;
    let pz = this.objetivoZ - Math.cos(this.azimut) * this.distancia * cosInc;

    if (this.sacudida > 0) {
      const s = this.sacudida * this.sacudida; // decaimiento cuadrático: golpe seco
      px += Math.sin(this.semillaSacudida * 1.7) * s;
      py += Math.sin(this.semillaSacudida * 2.3) * s * 0.6;
      pz += Math.cos(this.semillaSacudida * 1.3) * s;
    }

    this.nucleo.position.set(px, py, pz);
    this.nucleo.lookAt(this.objetivoX, alturaSuelo, this.objetivoZ);

    // Los planos de recorte se ajustan al zoom: cuanto más cerca, más precisión de
    // profundidad, que es lo que evita el parpadeo entre el suelo y las decoraciones.
    this.nucleo.near = Math.max(0.5, this.distancia * 0.08);
    this.nucleo.far = this.distancia * 6 + 120;
    this.nucleo.updateProjectionMatrix();
  }

  redimensionar(aspecto: number): void {
    this.nucleo.aspect = aspecto;
    this.nucleo.updateProjectionMatrix();
  }

  // --- Conversiones pantalla / mundo ---

  /**
   * Punto del terreno bajo unas coordenadas de pantalla normalizadas [-1, 1].
   * Cruza contra un plano horizontal y después refina con la altura real del terreno:
   * dos iteraciones bastan para que hacer clic en lo alto de una colina no ordene
   * moverse a la casilla de detrás.
   */
  puntoEnSuelo(ndcX: number, ndcY: number, salida: THREE.Vector3): boolean {
    this.vector2.set(ndcX, ndcY);
    this.rayo.setFromCamera(this.vector2, this.nucleo);

    let alturaEstimada = 0;
    for (let iteracion = 0; iteracion < 3; iteracion++) {
      this.plano.constant = -alturaEstimada;
      if (!this.rayo.ray.intersectPlane(this.plano, this.vector)) return false;
      alturaEstimada = this.mapa.alturaEnMundo(this.vector.x, this.vector.z);
    }

    salida.copy(this.vector);
    salida.y = alturaEstimada;
    return true;
  }

  /** Proyecta un punto del mundo a píxeles de pantalla. Devuelve false si queda detrás. */
  aPantalla(
    x: number,
    y: number,
    z: number,
    anchoPantalla: number,
    altoPantalla: number,
    salida: { x: number; y: number },
  ): boolean {
    this.vector.set(x, y, z).project(this.nucleo);
    salida.x = (this.vector.x * 0.5 + 0.5) * anchoPantalla;
    salida.y = (-this.vector.y * 0.5 + 0.5) * altoPantalla;
    return this.vector.z < 1;
  }

  /** Casillas de mundo que abarca la pantalla; sirve para dimensionar el minimapa. */
  get anchoVisible(): number {
    const alturaVisible = 2 * Math.tan((this.nucleo.fov * DEG_A_RAD) / 2) * this.distancia;
    return alturaVisible * this.nucleo.aspect;
  }
}
