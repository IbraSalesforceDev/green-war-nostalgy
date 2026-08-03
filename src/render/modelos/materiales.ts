import * as THREE from 'three';
import { Bando } from '../../sim/tipos';

/**
 * Materiales y paletas de los modelos.
 *
 * Decisión de fondo: **el color viaja en los vértices, no en el material**. Todo el
 * juego se dibuja con cinco materiales compartidos —mate, facetado, metal, piel y
 * brillo— y cada pieza lleva su color horneado en el atributo `color` de su
 * geometría. Las consecuencias son enormes para un RTS:
 *
 *   - un edificio entero cabe en tres o cuatro llamadas de dibujado en lugar de
 *     veinte, porque todas las piedras, maderas y herrajes del mismo acabado se
 *     fusionan en una sola malla;
 *   - no hay una explosión combinatoria de materiales por bando y por tono;
 *   - la variación de tono entre piedras sale gratis, que es justo lo que separa
 *     un muro creíble de una plancha de plástico gris.
 *
 * El acabado es lo único que no puede mezclarse: el acero necesita `metalness`
 * alto y `roughness` bajo para captar el sol, y la tela justo lo contrario.
 */

/** Familias de superficie. Cada una es un material compartido en toda la escena. */
export type Acabado =
  /** Tela, cuero, piedra pulida, tablones. Sombreado suave. */
  | 'mate'
  /** Roca, follaje, troncos. Sombreado plano: facetas duras que leen a distancia. */
  | 'facetado'
  /** Acero, hierro, herrajes. Capta el sol y define la silueta armada. */
  | 'metal'
  /** Carne. Un emisivo cálido bajísimo simula la subsuperficie. */
  | 'piel'
  /** Oro, cristales, brasas. Metálico puro y algo de emisión propia. */
  | 'brillo';

/**
 * Paleta de un bando.
 *
 * `bandera` y `bandera2` son el color de identificación y solo deben aparecer en
 * zonas concretas —capa, estandarte, penacho, escudo, gualdrapa—. Teñir la unidad
 * entera de azul o de rojo destruye la lectura de material y es el error clásico.
 */
export interface Paleta {
  /** Color de bando. Se ve a distancia de juego y decide de un vistazo quién es quién. */
  bandera: number;
  /** Tono oscuro del color de bando, para bordes y sombras del mismo tejido. */
  bandera2: number;
  piel: number;
  pielOscura: number;
  tela: number;
  telaOscura: number;
  cuero: number;
  cueroOscuro: number;
  metal: number;
  metalOscuro: number;
  madera: number;
  maderaOscura: number;
  piedra: number;
  piedraClara: number;
  piedraOscura: number;
  /** Cubierta: pizarra azul en los humanos, pieles curtidas en los orcos. */
  tejado: number;
  tejadoOscuro: number;
  pelo: number;
  hueso: number;
  /** Rugosidad extra del metal del bando: el hierro orco no brilla como el acero. */
  brunido: number;
}

/** Humanos: acero, lino y pizarra azul. Silueta esbelta y limpia. */
export const PALETA_HUMANOS: Paleta = {
  bandera: 0x2f63d8,
  bandera2: 0x1a3a8f,
  piel: 0xd8a274,
  pielOscura: 0xb07d52,
  tela: 0xd6cdb6,
  telaOscura: 0x9d9578,
  cuero: 0x77522f,
  cueroOscuro: 0x4e351d,
  metal: 0xc2c9d2,
  metalOscuro: 0x646c76,
  madera: 0x8b6237,
  maderaOscura: 0x5c4023,
  piedra: 0xa39a8b,
  piedraClara: 0xc0b7a6,
  piedraOscura: 0x766e62,
  tejado: 0x3b5486,
  tejadoOscuro: 0x26355a,
  pelo: 0x543a20,
  hueso: 0xe0d8c0,
  brunido: 0.26,
};

/** Orcos: hierro tosco, cuero, troncos y pieles. Silueta maciza y encorvada. */
export const PALETA_ORCOS: Paleta = {
  bandera: 0xb52d20,
  bandera2: 0x6d1811,
  piel: 0x63913c,
  pielOscura: 0x44682a,
  tela: 0x8d7c58,
  telaOscura: 0x5f523a,
  cuero: 0x5c3f24,
  cueroOscuro: 0x3a2616,
  metal: 0x8a857e,
  metalOscuro: 0x4a4643,
  madera: 0x6f5030,
  maderaOscura: 0x46311c,
  piedra: 0x857b6d,
  piedraClara: 0x9d9384,
  piedraOscura: 0x5d564b,
  tejado: 0x6b5236,
  tejadoOscuro: 0x453322,
  pelo: 0x2b241c,
  hueso: 0xdcd2b6,
  brunido: 0.45,
};

/** Naturaleza: la usan los adornos y todo lo que no pertenece a un bando. */
export const PALETA_NEUTRAL: Paleta = {
  bandera: 0xd8b23a,
  bandera2: 0x8f7220,
  piel: 0xc9a878,
  pielOscura: 0xa08356,
  tela: 0xb9ac8f,
  telaOscura: 0x827a63,
  cuero: 0x6b4a2b,
  cueroOscuro: 0x43301c,
  metal: 0x9aa0a6,
  metalOscuro: 0x5a5f64,
  madera: 0x6b4a2b,
  maderaOscura: 0x3f2c19,
  piedra: 0x847d73,
  piedraClara: 0xa39b8f,
  piedraOscura: 0x585349,
  tejado: 0x6b5236,
  tejadoOscuro: 0x453322,
  pelo: 0x3a3128,
  hueso: 0xded5bd,
  brunido: 0.35,
};

export function paletaDe(bando: Bando): Paleta {
  if (bando === Bando.HUMANOS) return PALETA_HUMANOS;
  if (bando === Bando.ORCOS) return PALETA_ORCOS;
  return PALETA_NEUTRAL;
}

// --- Utilidades de color ---

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

/**
 * Convierte un color sRGB a espacio lineal y lo escribe en `destino`.
 * Los atributos de vértice se consumen tal cual en el sombreador, así que la
 * conversión hay que hacerla aquí: si se pasa el valor sRGB directo, todo el juego
 * sale lavado y con los medios tonos altos.
 */
export function colorLineal(hex: number, destino: { r: number; g: number; b: number }): void {
  _c1.setHex(hex, THREE.SRGBColorSpace);
  destino.r = _c1.r;
  destino.g = _c1.g;
  destino.b = _c1.b;
}

/** Mezcla dos colores sRGB y devuelve el hexadecimal resultante. */
export function mezclarColor(a: number, b: number, t: number): number {
  _c1.setHex(a, THREE.SRGBColorSpace);
  _c2.setHex(b, THREE.SRGBColorSpace);
  _c1.lerp(_c2, t);
  return _c1.getHex(THREE.SRGBColorSpace);
}

/**
 * Aclara u oscurece un color de forma determinista.
 * Es lo que da a un muro de piedra la variación entre sillares sin gastar ni una
 * textura ni un material extra.
 */
export function variarColor(hex: number, factor: number): number {
  _c1.setHex(hex, THREE.SRGBColorSpace);
  if (factor >= 0) {
    _c1.lerp(_c2.setRGB(1, 0.97, 0.92), Math.min(1, factor));
  } else {
    _c1.multiplyScalar(Math.max(0.05, 1 + factor));
  }
  return _c1.getHex(THREE.SRGBColorSpace);
}

/**
 * Banco de materiales compartidos.
 *
 * Cinco materiales para todo el juego. Se crean bajo demanda y se destruyen de una
 * vez al cerrar la partida.
 */
export class BancoMateriales {
  private materiales = new Map<Acabado, THREE.MeshStandardMaterial>();

  material(acabado: Acabado): THREE.MeshStandardMaterial {
    const existente = this.materiales.get(acabado);
    if (existente) return existente;

    const nuevo = crearMaterial(acabado);
    this.materiales.set(acabado, nuevo);
    return nuevo;
  }

  liberar(): void {
    for (const material of this.materiales.values()) material.dispose();
    this.materiales.clear();
  }
}

function crearMaterial(acabado: Acabado): THREE.MeshStandardMaterial {
  switch (acabado) {
    case 'metal':
      // Corrección: con `metalness` por encima de 0.9 y sin mapa de entorno —la
      // escena solo tiene sol, relleno y hemisférica, ver `iluminacion.ts`—, el
      // término difuso desaparece casi del todo y cualquier pieza metálica se ve
      // negra salvo en el punto exacto del brillo especular. Se comprobó con el
      // banco de modelos: cascos y espadas quedaban ilegibles. Bajar la metalicidad
      // y subir un poco la rugosidad conserva el aspecto de acero bajo las mismas
      // tres luces, sin necesitar iluminación basada en imágenes.
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.55,
        roughness: 0.4,
        flatShading: false,
        name: 'mat-metal',
      });

    case 'facetado':
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0,
        roughness: 0.94,
        flatShading: true,
        name: 'mat-facetado',
      });

    case 'piel':
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0,
        roughness: 0.56,
        // Emisivo cálido bajísimo: imita el rebote interno de la carne y evita que
        // las caras en sombra se conviertan en manchas negras sin lectura.
        emissive: new THREE.Color(0x2a1208),
        emissiveIntensity: 1,
        flatShading: false,
        name: 'mat-piel',
      });

    case 'brillo':
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 1,
        roughness: 0.14,
        emissive: new THREE.Color(0x3a2a06),
        emissiveIntensity: 1,
        flatShading: true,
        name: 'mat-brillo',
      });

    default:
      return new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.02,
        roughness: 0.88,
        flatShading: false,
        name: 'mat-mate',
      });
  }
}
