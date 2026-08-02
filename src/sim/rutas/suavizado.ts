import { TAM_CASILLA } from '../constantes';
import type { MapaJuego } from '../mapa';

/**
 * Suavizado de rutas («string pulling»).
 *
 * El A* devuelve una escalera de casillas. Si una unidad la sigue tal cual, anda en
 * zigzag: es el andar delator de los RTS mal hechos. El truco clásico es tirar del
 * hilo: se avanza por la escalera mientras haya línea de visión desde el último
 * punto fijado, y solo se fija un punto nuevo cuando la visión se pierde. Lo que
 * queda son los puntos de inflexión reales.
 *
 * La línea de visión se calcula con un Bresenham entero sobre la rejilla que da
 * pasos de una sola casilla (nunca salta en diagonal sin comprobar las esquinas) y
 * que además verifica `transitableEntre`, de modo que un atajo suavizado jamás
 * cruza un acantilado por donde no hay rampa.
 */

/**
 * ¿Hay línea de visión libre entre dos puntos de mundo para una unidad de radio
 * `radio`? Con radio > 0 se comprueban además las dos líneas desplazadas
 * perpendicularmente ±radio, que es la aproximación barata al barrido del disco.
 */
export function hayLineaDeVision(
  mapa: MapaJuego,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radio: number,
): boolean {
  if (!lineaLibre(mapa, x0, z0, x1, z1)) return false;
  if (radio <= 0) return true;

  const dx = x1 - x0;
  const dz = z1 - z0;
  const largo = Math.sqrt(dx * dx + dz * dz);
  if (largo < 1e-9) return true;

  // Perpendicular unitaria por el desplazamiento del radio.
  const px = (-dz / largo) * radio;
  const pz = (dx / largo) * radio;

  if (!lineaLibre(mapa, x0 + px, z0 + pz, x1 + px, z1 + pz)) return false;
  if (!lineaLibre(mapa, x0 - px, z0 - pz, x1 - px, z1 - pz)) return false;
  return true;
}

/**
 * Bresenham «supercover» entero entre las casillas de dos puntos de mundo.
 * Solo da pasos ortogonales; cuando la línea pasa exactamente por una esquina,
 * exige que las dos casillas ortogonales adyacentes sean transitables (misma regla
 * anti-corte-de-esquinas que el A*).
 */
function lineaLibre(
  mapa: MapaJuego,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): boolean {
  let cx = Math.floor(x0 / TAM_CASILLA);
  let cz = Math.floor(z0 / TAM_CASILLA);
  const cxFin = Math.floor(x1 / TAM_CASILLA);
  const czFin = Math.floor(z1 / TAM_CASILLA);

  if (!mapa.transitable(cx, cz)) return false;
  if (!mapa.transitable(cxFin, czFin)) return false;

  let dx = cxFin - cx;
  let dz = czFin - cz;
  const pasoX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const pasoZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  dx = dx < 0 ? -dx : dx;
  dz = dz < 0 ? -dz : dz;

  let n = dx + dz;
  let error = dx - dz;
  dx *= 2;
  dz *= 2;

  while (n > 0) {
    if (error > 0) {
      if (!mapa.transitableEntre(cx, cz, cx + pasoX, cz)) return false;
      cx += pasoX;
      error -= dz;
      n--;
    } else if (error < 0) {
      if (!mapa.transitableEntre(cx, cz, cx, cz + pasoZ)) return false;
      cz += pasoZ;
      error += dx;
      n--;
    } else {
      // La línea cruza justo por el vértice: solo se admite si se puede rodear por
      // los dos lados. Es lo que impide colarse entre dos bloques en diagonal.
      if (!mapa.transitableEntre(cx, cz, cx + pasoX, cz)) return false;
      if (!mapa.transitableEntre(cx, cz, cx, cz + pasoZ)) return false;
      if (!mapa.transitableEntre(cx + pasoX, cz, cx + pasoX, cz + pasoZ)) return false;
      cx += pasoX;
      cz += pasoZ;
      error -= dz;
      error += dx;
      n -= 2;
    }
  }

  return true;
}

/** Centro de la casilla `indice` en coordenadas de mundo, eje X. */
function centroX(mapa: MapaJuego, indice: number): number {
  return ((indice % mapa.ancho) + 0.5) * TAM_CASILLA;
}

/** Centro de la casilla `indice` en coordenadas de mundo, eje Z. */
function centroZ(mapa: MapaJuego, indice: number): number {
  return (Math.floor(indice / mapa.ancho) + 0.5) * TAM_CASILLA;
}

/**
 * Convierte un camino de casillas del A* en la lista de puntos de mundo de la `Ruta`.
 *
 * Convenio, importante para el sistema de movimiento: **el origen NO se incluye**.
 * `puntos[0]` es ya el siguiente punto al que dirigirse, coherente con que
 * `Ruta.indice` arranque en 0.
 *
 * @param casillas  Búfer de índices de casilla (solo se leen los `longitud` primeros).
 * @param destinoX  Destino real pedido, en coordenadas de mundo.
 * @param usarDestinoReal  Si el camino llegó de verdad al destino, se remata con el
 *   punto exacto en vez de con el centro de la casilla; así una orden de moverse a
 *   media casilla no queda «imantada» a la rejilla.
 */
export function suavizarCamino(
  mapa: MapaJuego,
  casillas: Int32Array,
  longitud: number,
  origenX: number,
  origenZ: number,
  destinoX: number,
  destinoZ: number,
  radio: number,
  usarDestinoReal: boolean,
): Float32Array {
  if (longitud <= 0) return new Float32Array(0);

  const ultima = casillas[longitud - 1];
  let finX = centroX(mapa, ultima);
  let finZ = centroZ(mapa, ultima);
  if (usarDestinoReal) {
    const cxDestino = Math.floor(destinoX / TAM_CASILLA);
    const czDestino = Math.floor(destinoZ / TAM_CASILLA);
    if (mapa.dentro(cxDestino, czDestino) && mapa.indice(cxDestino, czDestino) === ultima) {
      finX = destinoX;
      finZ = destinoZ;
    }
  }

  if (longitud === 1) {
    const unico = new Float32Array(2);
    unico[0] = finX;
    unico[1] = finZ;
    return unico;
  }

  // Se trabaja sobre un búfer de trabajo compartido para no crear basura; el único
  // array que sale de aquí es el definitivo, que es propiedad de la Ruta.
  const total = longitud;
  asegurarBuffer(total * 2);
  const puntos = bufferPuntos;
  for (let i = 0; i < total; i++) {
    puntos[i * 2] = centroX(mapa, casillas[i]);
    puntos[i * 2 + 1] = centroZ(mapa, casillas[i]);
  }
  puntos[(total - 1) * 2] = finX;
  puntos[(total - 1) * 2 + 1] = finZ;

  asegurarSalida(total * 2);
  const salida = bufferSalida;
  let cuenta = 0;

  let anclaX = origenX;
  let anclaZ = origenZ;
  let i = 1; // el índice 0 es la casilla del origen: nunca se emite

  while (i < total) {
    // Se avanza mientras siga habiendo visión directa desde el ancla.
    let j = i;
    while (j + 1 < total && hayLineaDeVision(mapa, anclaX, anclaZ, puntos[(j + 1) * 2], puntos[(j + 1) * 2 + 1], radio)) {
      j++;
    }
    const px = puntos[j * 2];
    const pz = puntos[j * 2 + 1];
    salida[cuenta * 2] = px;
    salida[cuenta * 2 + 1] = pz;
    cuenta++;
    anclaX = px;
    anclaZ = pz;
    i = j + 1;
  }

  // Si el ancla inicial ya veía el final, el bucle deja un solo punto; si no, la
  // lista queda con los quiebres reales. En ambos casos se copia al tamaño exacto.
  const definitivo = new Float32Array(cuenta * 2);
  for (let k = 0; k < cuenta * 2; k++) definitivo[k] = salida[k];
  return definitivo;
}

// --- Búferes de trabajo compartidos ---
// Un módulo, un hilo: la simulación es de un solo hilo y estas funciones no se
// reentran. A cambio, suavizar una ruta no reserva nada salvo el array final.

let bufferPuntos = new Float64Array(512);
let bufferSalida = new Float64Array(512);

function asegurarBuffer(tamano: number): void {
  if (bufferPuntos.length < tamano) bufferPuntos = new Float64Array(tamano * 2);
}

function asegurarSalida(tamano: number): void {
  if (bufferSalida.length < tamano) bufferSalida = new Float64Array(tamano * 2);
}
