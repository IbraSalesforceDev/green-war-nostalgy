import * as THREE from 'three';
import {
  barra,
  caja,
  cajaEn,
  capsula,
  cilindro,
  cono,
  cupula,
  esfera,
  fusionar,
  girarX,
  girarZ,
  mover,
  prisma,
} from '../../render/modelos/piezas';
import { Arma, BandoCampana } from '../tipos';

/**
 * Las figurillas que van sobre las fichas del mapa.
 *
 * ── El problema que resuelven ────────────────────────────────────────────────
 * La primera versión usaba cápsulas y conos sueltos, y no se distinguía una cosa
 * de otra: tres píldoras de distinto grosor no son un fusilero, un jinete y un
 * cañón. A este tamaño —cada figura ocupa un puñado de píxeles— no se ve el
 * detalle, se ve **la silueta**, así que cada arma se construye alrededor del
 * rasgo que la hace inconfundible de un vistazo:
 *
 *   · infantería  → el fusil terciado en diagonal y el chacó alto de la época;
 *   · caballería  → el perfil del caballo, con sus cuatro patas y el cuello;
 *   · artillería  → las dos ruedas grandes y el tubo apuntando al frente.
 *
 * Todo lo demás sobra. Añadir dedos o correajes no mejoraría nada: solo emborrona
 * la mancha que el ojo tiene que reconocer.
 *
 * ── Cómo se construyen ───────────────────────────────────────────────────────
 * Con las mismas primitivas del resto del juego (`modelos/piezas.ts`), que
 * hornean el color en los vértices. Cada figura acaba siendo **una sola
 * geometría fusionada**, así que las setenta y dos figurillas del mapa cuestan
 * tres llamadas de dibujado, no doscientas. El color de bando va dentro de la
 * geometría, de ahí que haya un juego de figuras por bando.
 */

/** Paleta de cada bando. El uniforme es lo único que cambia de verdad. */
interface PaletaBando {
  casaca: number;
  casacaOscura: number;
  pantalon: number;
}

const PALETA: Readonly<Record<BandoCampana, PaletaBando>> = {
  [BandoCampana.NINGUNO]: { casaca: 0x8a8a82, casacaOscura: 0x5f5f58, pantalon: 0x6e6e66 },
  // Azul de ordenanza del Norte.
  [BandoCampana.UNION]: { casaca: 0x35529b, casacaOscura: 0x22376b, pantalon: 0x8d95a8 },
  // El gris pardo del Sur, que en campaña tiraba más a nuez que a gris.
  [BandoCampana.CONFEDERACION]: { casaca: 0x9a9078, casacaOscura: 0x6d6553, pantalon: 0x7d7462 },
};

const PIEL = 0xd9a877;
const METAL = 0x8f949c;
const METAL_OSCURO = 0x4a4e55;
const MADERA = 0x6b4a2a;
const CUERO = 0x3d2b1a;
const CABALLO = 0x5a3c26;
const CABALLO_CRIN = 0x2c1c10;

/**
 * Construye las tres figuras de un bando.
 *
 * Se llama una vez por bando y las geometrías se comparten entre todas las
 * fichas, así que puede permitirse ser generosa en piezas.
 */
export function crearFigurasDeBando(bando: BandoCampana): Readonly<Record<Arma, THREE.BufferGeometry>> {
  const paleta = PALETA[bando];
  return {
    [Arma.INFANTERIA]: fusilero(paleta),
    [Arma.CABALLERIA]: jinete(paleta),
    [Arma.ARTILLERIA]: canon(paleta),
  };
}

/**
 * Fusilero de pie, con el arma terciada.
 *
 * La diagonal del fusil cruzando el cuerpo es lo que se reconoce a distancia;
 * sin ella queda un monigote y podría ser cualquier cosa.
 */
function fusilero(paleta: PaletaBando): THREE.BufferGeometry {
  const piezas: THREE.BufferGeometry[] = [];

  // Piernas, ligeramente separadas para que la base no sea un palo.
  for (const lado of [-1, 1]) {
    piezas.push(mover(capsula(0.16, 0.62, paleta.pantalon, 6), lado * 0.19, 0.42, 0));
  }
  // Botas.
  for (const lado of [-1, 1]) {
    piezas.push(cajaEn(0.28, 0.18, 0.44, lado * 0.19, 0.09, 0.06, CUERO));
  }

  // Torso: se estrecha hacia la cintura, que es lo que da aire de figura tallada.
  piezas.push(mover(prisma(0.62, 0.4, 0.5, 0.34, 0.9, paleta.casaca), 0, 0.72, 0));
  // Correaje cruzado: dos manchas claras que rompen el bloque del torso.
  piezas.push(mover(girarZ(caja(0.09, 0.86, 0.02, 0xd8d2c4), 0.34), 0, 1.16, 0.2));

  // Cabeza y chacó: el gorro alto y cilíndrico sitúa la época sin lugar a dudas.
  piezas.push(mover(esfera(0.2, PIEL, 8, 6), 0, 1.75, 0));
  piezas.push(mover(cilindro(0.21, 0.23, 0.34, paleta.casacaOscura, 8), 0, 1.86, 0));
  piezas.push(mover(cilindro(0.24, 0.24, 0.05, METAL_OSCURO, 8), 0, 2.2, 0));
  // Visera.
  piezas.push(mover(cajaEn(0.34, 0.04, 0.16, 0, 1.88, 0.19, METAL_OSCURO), 0, 0, 0));

  // Brazos.
  piezas.push(mover(capsula(0.12, 0.5, paleta.casaca, 6), -0.36, 1.12, 0.06));
  piezas.push(mover(capsula(0.12, 0.5, paleta.casaca, 6), 0.36, 1.12, 0.06));

  // El fusil: cañón, culata y bayoneta, cruzados sobre el pecho.
  const fusil: THREE.BufferGeometry[] = [];
  fusil.push(mover(barra(0.045, 1.5, METAL_OSCURO, 6), 0, 0, 0));
  fusil.push(mover(caja(0.13, 0.42, 0.1, MADERA), 0, -0.62, 0));
  fusil.push(mover(cono(0.035, 0.3, METAL, 6), 0, 0.9, 0));
  const fusilEntero = fusionar(fusil)!;
  // Terciado: inclinado unos 25° y adelantado, para que la diagonal recorte
  // contra el fondo y no se pierda dentro de la silueta del cuerpo.
  girarZ(fusilEntero, -0.42);
  mover(fusilEntero, 0.26, 1.2, 0.24);
  piezas.push(fusilEntero);

  return fusionar(piezas)!;
}

/**
 * Jinete a caballo, de perfil.
 *
 * Se orienta de lado a propósito: de frente, un caballo es una mancha compacta
 * indistinguible de un soldado gordo. De perfil, el cuello y las cuatro patas lo
 * delatan al instante.
 */
function jinete(paleta: PaletaBando): THREE.BufferGeometry {
  const piezas: THREE.BufferGeometry[] = [];

  // Cuerpo del caballo: cápsula tumbada a lo largo del eje X.
  const tronco = girarZ(capsula(0.34, 0.95, CABALLO, 8), Math.PI / 2);
  piezas.push(mover(tronco, 0, 1.0, 0));

  // Cuartos traseros, algo más altos que el pecho.
  piezas.push(mover(esfera(0.36, CABALLO, 8, 6), -0.6, 1.02, 0));
  piezas.push(mover(esfera(0.32, CABALLO, 8, 6), 0.55, 0.98, 0));

  // Cuello y cabeza, inclinados hacia delante.
  const cuello = girarZ(capsula(0.16, 0.5, CABALLO, 6), -0.6);
  piezas.push(mover(cuello, 0.82, 1.32, 0));
  piezas.push(mover(girarZ(capsula(0.13, 0.3, CABALLO, 6), 1.35), 1.12, 1.6, 0));
  // Crin y cola: dos manchas oscuras que refuerzan el perfil.
  piezas.push(mover(girarZ(caja(0.5, 0.1, 0.16, CABALLO_CRIN), -0.6), 0.78, 1.45, 0));
  piezas.push(mover(girarZ(capsula(0.09, 0.34, CABALLO_CRIN, 6), 0.5), -0.92, 0.92, 0));

  // Las cuatro patas. Sin ellas no hay caballo que valga.
  for (const x of [-0.52, -0.3, 0.36, 0.56]) {
    piezas.push(mover(barra(0.075, 0.78, CABALLO, 6), x, 0.39, x < 0 ? -0.02 : 0.02));
    piezas.push(mover(cilindro(0.09, 0.1, 0.1, CABALLO_CRIN, 6), x, 0, x < 0 ? -0.02 : 0.02));
  }

  // Silla y manta.
  piezas.push(mover(caja(0.5, 0.1, 0.62, paleta.casacaOscura), -0.05, 1.32, 0));

  // El jinete: torso, cabeza, gorra y un sable en alto.
  piezas.push(mover(prisma(0.42, 0.34, 0.34, 0.28, 0.6, paleta.casaca), -0.05, 1.36, 0));
  piezas.push(mover(esfera(0.17, PIEL, 8, 6), -0.05, 2.06, 0));
  piezas.push(mover(cilindro(0.18, 0.19, 0.16, paleta.casacaOscura, 8), -0.05, 2.14, 0));
  // Piernas a horcajadas, una a cada lado del caballo.
  for (const lado of [-1, 1]) {
    piezas.push(mover(girarX(capsula(0.1, 0.34, paleta.pantalon, 6), 0.5), -0.02, 1.16, lado * 0.3));
  }
  // Sable levantado: una diagonal brillante que remata la silueta.
  const sable = girarZ(barra(0.035, 0.85, METAL, 6), -0.5);
  piezas.push(mover(sable, 0.36, 2.1, 0.16));

  return fusionar(piezas)!;
}

/**
 * Cañón de campaña sobre su cureña.
 *
 * Las dos ruedas grandes son el rasgo que lo identifica; el tubo solo, sin
 * ruedas, se confundiría con un tronco.
 */
function canon(paleta: PaletaBando): THREE.BufferGeometry {
  const piezas: THREE.BufferGeometry[] = [];

  // Ruedas: aro, cubo y radios, una a cada lado.
  for (const lado of [-1, 1]) {
    const rueda: THREE.BufferGeometry[] = [];
    rueda.push(cilindro(0.62, 0.62, 0.09, MADERA, 14));
    rueda.push(mover(cilindro(0.14, 0.14, 0.16, METAL_OSCURO, 8), 0, -0.03, 0));
    for (let i = 0; i < 6; i++) {
      const radio = girarZ(caja(0.06, 1.16, 0.05, MADERA), (i * Math.PI) / 6);
      rueda.push(mover(radio, 0, 0.045, 0));
    }
    const ruedaEntera = fusionar(rueda)!;
    // De pie y a los lados del afuste.
    girarX(ruedaEntera, Math.PI / 2);
    piezas.push(mover(ruedaEntera, 0, 0.62, lado * 0.46));
  }

  // Cureña: dos gualderas de madera que bajan hacia la cola.
  for (const lado of [-1, 1]) {
    const gualdera = girarZ(caja(1.7, 0.16, 0.11, MADERA), -0.12);
    piezas.push(mover(gualdera, -0.15, 0.6, lado * 0.24));
  }
  // Contera: donde el afuste se apoya en el suelo.
  piezas.push(mover(caja(0.3, 0.16, 0.5, MADERA), -0.95, 0.36, 0));

  // El tubo: grueso en la recámara y afinado en la boca, con el refuerzo central.
  const tubo: THREE.BufferGeometry[] = [];
  tubo.push(girarZ(cilindro(0.13, 0.2, 1.5, METAL_OSCURO, 10), -Math.PI / 2));
  tubo.push(mover(girarZ(cilindro(0.23, 0.23, 0.2, METAL_OSCURO, 10), -Math.PI / 2), -0.05, 0, 0));
  tubo.push(mover(cupula(0.2, METAL_OSCURO, 10, 5), -0.78, 0, 0));
  const tuboEntero = fusionar(tubo)!;
  // Ligeramente alzado, como si estuviera calado para tirar lejos.
  girarZ(tuboEntero, 0.13);
  piezas.push(mover(tuboEntero, 0.28, 0.86, 0));

  // Un artillero al lado: da escala y ata la pieza al bando por el color.
  piezas.push(mover(capsula(0.14, 0.5, paleta.casaca, 6), -0.62, 1.0, 0.62));
  piezas.push(mover(esfera(0.16, PIEL, 8, 6), -0.62, 1.42, 0.62));
  piezas.push(mover(cilindro(0.17, 0.18, 0.14, paleta.casacaOscura, 8), -0.62, 1.5, 0.62));
  for (const lado of [-1, 1]) {
    piezas.push(mover(capsula(0.09, 0.42, paleta.pantalon, 6), -0.62 + lado * 0.11, 0.35, 0.62));
  }

  // Pila de balas: tres esferas que rematan la lectura de «esto es artillería».
  piezas.push(mover(esfera(0.13, METAL, 7, 5), -1.15, 0.13, -0.5));
  piezas.push(mover(esfera(0.13, METAL, 7, 5), -0.92, 0.13, -0.56));
  piezas.push(mover(esfera(0.13, METAL, 7, 5), -1.04, 0.32, -0.53));

  return fusionar(piezas)!;
}
