import { limitar01 } from '../../core/math';
import { FUERZA_SEPARACION, TAM_CASILLA } from '../constantes';
import type { MapaJuego } from '../mapa';
import { Clase } from '../tipos';

/**
 * Evitación local entre unidades.
 *
 * La ruta lleva la unidad *cerca*; la evitación es lo que evita que las unidades se
 * atraviesen, se apelotonen en un embudo o se empotren contra la esquina de un
 * edificio. No sustituye a la búsqueda de caminos: la corrige tick a tick.
 *
 * El resultado es un **vector de corrección** que el sistema de movimiento suma a su
 * dirección deseada antes de normalizar y aplicar la velocidad. Esta unidad de
 * compilación no toca el mundo: es una función de consulta.
 *
 * Tres cosas que hay que hacer bien o el resultado tiembla:
 *
 *  1. **Promediar, no acumular.** Sumar un vector unitario por vecino hace que en un
 *     apelotonamiento la fuerza crezca sin límite y las unidades salgan disparadas.
 *     Aquí se promedia por vecino y se acota.
 *  2. **Umbral mínimo.** Por debajo de `umbralMinimo` la corrección se descarta del
 *     todo. Sin esto, dos unidades en reposo se empujan con fuerzas diminutas y
 *     alternas: vibran en el sitio y el jugador lo nota enseguida.
 *  3. **Romper la simetría de forma determinista.** Dos unidades de frente en la
 *     misma línea se bloquean para siempre si solo hay repulsión radial. Se añade una
 *     componente tangencial cuyo sentido sale de la geometría (no de un azar), de
 *     modo que ambas se apartan al mismo lado y se cruzan.
 */

/** Vector en el plano de juego XZ. */
export interface VectorPlano {
  x: number;
  z: number;
}

/**
 * Lo que la evitación necesita del mundo. `Mundo` lo cumple estructuralmente, así
 * que este módulo no depende de `mundo.ts` y se puede probar con un doble.
 */
export interface EntornoUnidades {
  readonly x: Float32Array;
  readonly z: Float32Array;
  readonly vx: Float32Array;
  readonly vz: Float32Array;
  readonly radio: Float32Array;
  readonly vida: Float32Array;
  readonly activos: Uint8Array;
  readonly clase: Uint8Array;
  consultarRadio(x: number, z: number, radio: number, visitar: (indice: number) => void): void;
}

export interface OpcionesEvitacion {
  /** Escala global de la separación. Por omisión `FUERZA_SEPARACION`. */
  fuerza?: number;
  /** Holgura extra sobre la suma de radios en la que ya se empieza a empujar. */
  margen?: number;
  /** Cuánto más pesa un vecino que viene de frente. 0 = igual que los demás. */
  pesoContrario?: number;
  /** Peso de la componente tangencial que rompe los bloqueos frontales. */
  pesoTangencial?: number;
  /** Por debajo de esta magnitud la corrección se anula. Antitemblor. */
  umbralMinimo?: number;
  /** Tope de la magnitud devuelta. */
  maxCorreccion?: number;
  /** Añadir el desvío ante bloqueos estáticos del mapa. */
  evitarEstaticos?: boolean;
}

const OPCIONES_POR_DEFECTO: Required<OpcionesEvitacion> = {
  fuerza: FUERZA_SEPARACION,
  margen: 0.15 * TAM_CASILLA,
  pesoContrario: 1.1,
  pesoTangencial: 0.55,
  umbralMinimo: 0.04,
  maxCorreccion: 1.25,
  evitarEstaticos: true,
};

/** Velocidad de referencia para normalizar el ritmo de acercamiento. */
const VELOCIDAD_REFERENCIA = 3;

// --- Estado de trabajo del módulo ---
// La simulación es de un solo hilo y esta función no se reentra: usar variables de
// módulo en vez de una clausura por llamada ahorra una reserva por unidad y tick.
// Con 200 unidades a 20 Hz eso son 4.000 objetos por segundo que el recolector no ve.

let ctxEntorno: EntornoUnidades | null = null;
let ctxIndice = 0;
let ctxX = 0;
let ctxZ = 0;
let ctxRadio = 0;
let ctxVx = 0;
let ctxVz = 0;
let ctxMargen = 0;
let ctxPesoContrario = 0;
let ctxPesoTangencial = 0;
let acumX = 0;
let acumZ = 0;
let acumPeso = 0;
let acumVecinos = 0;

function visitarVecino(j: number): void {
  const e = ctxEntorno!;
  if (j === ctxIndice) return;
  if (e.activos[j] !== 1) return;
  if (e.vida[j] <= 0) return;
  // Solo las unidades empujan: los edificios y los árboles ya están en la rejilla.
  if (e.clase[j] !== Clase.UNIDAD) return;

  let dx = ctxX - e.x[j];
  let dz = ctxZ - e.z[j];
  const alcance = ctxRadio + e.radio[j] + ctxMargen;
  const d2 = dx * dx + dz * dz;
  if (d2 >= alcance * alcance) return;

  let d = Math.sqrt(d2);
  if (d < 1e-5) {
    // Superpuestas exactamente. Se separan por el eje X en sentidos opuestos según
    // el orden de los índices: determinista y antisimétrico para el par.
    dx = ctxIndice < j ? 1 : -1;
    dz = 0;
    d = 1;
  } else {
    dx /= d;
    dz /= d;
  }

  // Penetración normalizada: 0 justo al rozar, 1 con los centros pegados.
  const penetracion = limitar01((alcance - d) / alcance);

  // Ritmo de acercamiento: positivo si se están juntando. Los que vienen de frente
  // pesan más porque son los que de verdad van a chocar.
  const cierre = -(dx * (ctxVx - e.vx[j]) + dz * (ctxVz - e.vz[j]));
  const factorCierre = 1 + ctxPesoContrario * limitar01(cierre / VELOCIDAD_REFERENCIA);

  const peso = penetracion * factorCierre;

  acumX += dx * peso;
  acumZ += dz * peso;

  // Componente tangencial: la perpendicular «a la derecha» de la dirección de
  // alejamiento. Como para el vecino (dx,dz) sale con el signo cambiado, ambos
  // giran hacia lados opuestos del mundo y se cruzan en vez de forcejear.
  if (cierre > 0) {
    const t = peso * ctxPesoTangencial * limitar01(cierre / VELOCIDAD_REFERENCIA);
    acumX += dz * t;
    acumZ += -dx * t;
  }

  acumPeso += peso;
  acumVecinos++;
}

/**
 * Calcula la corrección de evitación local para una unidad.
 *
 * **Firma para el sistema de movimiento.** Escribe el resultado en `salida` (no
 * reserva nada) y devuelve su magnitud, por si el llamante quiere reaccionar a ella
 * (por ejemplo, reducir la velocidad cuando la corrección es grande).
 *
 * Uso previsto, por tick y por unidad en movimiento:
 * ```ts
 * const mag = calcularEvitacion(mundo, mundo.mapa, i, dirX, dirZ, correccion);
 * let mx = dirX + correccion.x;
 * let mz = dirZ + correccion.z;
 * // normalizar (mx, mz) y aplicar velocidad * dt
 * ```
 *
 * @param unidades  Fuente de posiciones y velocidades (el `Mundo` la cumple).
 * @param mapa      Rejilla, para el desvío ante bloqueos estáticos.
 * @param indice    Índice de la unidad que se está moviendo.
 * @param dirDeseadaX  Dirección deseada por la ruta, componente X. Debe ir normalizada.
 * @param dirDeseadaZ  Ídem, componente Z. Puede ser (0,0) si la unidad está parada.
 * @param salida    Vector de salida; se sobrescribe siempre (0,0 si no hay corrección).
 * @param opciones  Ajustes finos; por omisión los de `constantes.ts`.
 * @returns Magnitud de la corrección escrita en `salida`, en [0, `maxCorreccion`].
 */
export function calcularEvitacion(
  unidades: EntornoUnidades,
  mapa: MapaJuego,
  indice: number,
  dirDeseadaX: number,
  dirDeseadaZ: number,
  salida: VectorPlano,
  opciones?: OpcionesEvitacion,
): number {
  salida.x = 0;
  salida.z = 0;

  const fuerza = opciones?.fuerza ?? OPCIONES_POR_DEFECTO.fuerza;
  const margen = opciones?.margen ?? OPCIONES_POR_DEFECTO.margen;
  const pesoContrario = opciones?.pesoContrario ?? OPCIONES_POR_DEFECTO.pesoContrario;
  const pesoTangencial = opciones?.pesoTangencial ?? OPCIONES_POR_DEFECTO.pesoTangencial;
  const umbralMinimo = opciones?.umbralMinimo ?? OPCIONES_POR_DEFECTO.umbralMinimo;
  const maxCorreccion = opciones?.maxCorreccion ?? OPCIONES_POR_DEFECTO.maxCorreccion;
  const evitarEstaticos = opciones?.evitarEstaticos ?? OPCIONES_POR_DEFECTO.evitarEstaticos;

  const radioPropio = unidades.radio[indice];
  const x = unidades.x[indice];
  const z = unidades.z[indice];

  ctxEntorno = unidades;
  ctxIndice = indice;
  ctxX = x;
  ctxZ = z;
  ctxRadio = radioPropio;
  ctxVx = unidades.vx[indice];
  ctxVz = unidades.vz[indice];
  ctxMargen = margen;
  ctxPesoContrario = pesoContrario;
  ctxPesoTangencial = pesoTangencial;
  acumX = 0;
  acumZ = 0;
  acumPeso = 0;
  acumVecinos = 0;

  // Radio de consulta: nadie fuera de esto puede estar solapando.
  const radioConsulta = radioPropio + margen + 1.0 * TAM_CASILLA;
  unidades.consultarRadio(x, z, radioConsulta, visitarVecino);
  ctxEntorno = null;

  let sepX = acumX;
  let sepZ = acumZ;

  // Se promedia: veinte vecinos rozando no deben empujar veinte veces más que uno.
  if (acumVecinos > 0) {
    sepX /= acumVecinos;
    sepZ /= acumVecinos;
  }

  if (evitarEstaticos) {
    const empuje = empujeEstatico(mapa, x, z, radioPropio, dirDeseadaX, dirDeseadaZ);
    sepX += empuje.x;
    sepZ += empuje.z;
  }

  const magnitud = Math.sqrt(sepX * sepX + sepZ * sepZ);
  if (magnitud < 1e-6) return 0;

  // La intensidad va acotada a 1 antes de escalar: es la amortiguación que impide
  // que un amontonamiento profundo genere una corrección explosiva.
  const intensidad = magnitud > 1 ? 1 : magnitud;
  let escala = intensidad * fuerza * 0.5;
  if (escala > maxCorreccion) escala = maxCorreccion;

  if (escala < umbralMinimo) return 0;

  salida.x = (sepX / magnitud) * escala;
  salida.z = (sepZ / magnitud) * escala;
  return escala;
}

// --- Bloqueos estáticos ---

const empujeTmp: VectorPlano = { x: 0, z: 0 };

/** Vecindario de 8 para el sondeo de bloqueos, mismo orden que en el A*. */
const SONDEO_DX = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1]);
const SONDEO_DZ = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1]);

/**
 * Desvío ante bloqueos estáticos: mira las ocho casillas vecinas y empuja al lado
 * contrario de las que no son transitables, con más peso cuanto más cerca esté el
 * borde de la unidad. Ocho comprobaciones de array por unidad: se puede hacer todos
 * los ticks sin pensárselo.
 *
 * Devuelve un vector compartido, no lo guardes.
 */
export function empujeEstatico(
  mapa: MapaJuego,
  x: number,
  z: number,
  radio: number,
  dirDeseadaX: number,
  dirDeseadaZ: number,
): VectorPlano {
  empujeTmp.x = 0;
  empujeTmp.z = 0;

  const cx = Math.floor(x / TAM_CASILLA);
  const cz = Math.floor(z / TAM_CASILLA);
  const alcance = radio + 0.5 * TAM_CASILLA;

  for (let k = 0; k < 8; k++) {
    const nx = cx + SONDEO_DX[k];
    const nz = cz + SONDEO_DZ[k];
    if (mapa.transitableEntre(cx, cz, nx, nz)) continue;

    // Punto más cercano de esa casilla al centro de la unidad.
    const minX = nx * TAM_CASILLA;
    const minZ = nz * TAM_CASILLA;
    const px = x < minX ? minX : x > minX + TAM_CASILLA ? minX + TAM_CASILLA : x;
    const pz = z < minZ ? minZ : z > minZ + TAM_CASILLA ? minZ + TAM_CASILLA : z;

    let dx = x - px;
    let dz = z - pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= alcance) continue;

    if (d < 1e-5) {
      // Centro dentro del bloqueo: se sale por el eje del vecino.
      dx = -SONDEO_DX[k];
      dz = -SONDEO_DZ[k];
    } else {
      dx /= d;
      dz /= d;
    }

    const peso = limitar01((alcance - d) / alcance);
    empujeTmp.x += dx * peso;
    empujeTmp.z += dz * peso;
  }

  // Si la dirección deseada apunta contra la pared, el empuje se refuerza; si va
  // paralela, no hace falta estorbar el avance.
  const contraPared = -(empujeTmp.x * dirDeseadaX + empujeTmp.z * dirDeseadaZ);
  if (contraPared > 0) {
    const refuerzo = 1 + limitar01(contraPared);
    empujeTmp.x *= refuerzo;
    empujeTmp.z *= refuerzo;
  }

  return empujeTmp;
}
