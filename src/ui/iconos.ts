import { TipoEdificio, TipoUnidad } from '../sim/tipos';

/**
 * Iconografía de la interfaz, dibujada por código.
 *
 * No hay ni un solo archivo de imagen en el proyecto: cada icono es una cadena de
 * SVG que se genera aquí. La ventaja no es solo de peso —que también— sino de
 * control: un icono vectorial se ve igual de nítido en el retrato de 64 px del panel
 * de selección que en el punto de 16 px de una miniatura de la cola de producción,
 * y puede recolorearse por bando sin exportar una variante nueva.
 *
 * Reglas de dibujo que sigue todo el juego de iconos:
 *
 *  - Lienzo cuadrado de 32x32 unidades. Todo se diseña a esa escala y se estira.
 *  - Nada de `<defs>` ni degradados con `id`: un icono se inserta muchas veces en el
 *    documento y los identificadores duplicados romperían las referencias. El volumen
 *    se consigue con dos o tres tonos planos, que además leen mejor en tamaños chicos.
 *  - Contorno oscuro común heredado del grupo raíz. Es lo que permite que un icono
 *    claro siga recortándose sobre el pergamino y uno oscuro sobre la piedra.
 *  - Silueta antes que detalle: si la forma no se reconoce en negro a 32 px, el icono
 *    está mal y ningún detalle interior lo salva.
 */

// --- Paleta ---------------------------------------------------------------

/** Contorno común. Un pardo casi negro, más cálido que el negro puro. */
const CONTORNO = '#170f07';

const M1 = '#eef4fa'; // acero al brillo
const M2 = '#b6c3d1'; // acero medio
const M3 = '#7c8a99'; // acero en sombra
const M4 = '#4e5764'; // acero profundo

const W1 = '#c68e51'; // madera clara
const W2 = '#8b5c2e'; // madera
const W3 = '#57351a'; // madera en sombra

const O1 = '#ffeaad'; // oro al brillo
const O2 = '#f0c552'; // oro
const O3 = '#a97a1c'; // oro en sombra

const C1 = '#a86a3c'; // cuero
const C2 = '#6d4220'; // cuero en sombra

const P1 = '#b3ab9c'; // piedra clara
const P2 = '#847c6d'; // piedra
const P3 = '#544d40'; // piedra en sombra

const R1 = '#c8442f'; // rojo
const R2 = '#8b2c1d'; // rojo en sombra
const V1 = '#7fb04a'; // verde
const PIEL = '#e6bd93';
const HUESO = '#efe7d4';

// --- Utilidades geométricas ----------------------------------------------

/** Puntos de un polígono regular, para engranajes, sierras y octógonos. */
function poligono(lados: number, radio: number, giro = 0, cx = 16, cy = 16): string {
  const puntos: string[] = [];
  for (let i = 0; i < lados; i++) {
    const a = giro + (Math.PI * 2 * i) / lados;
    puntos.push(`${(cx + Math.cos(a) * radio).toFixed(2)},${(cy + Math.sin(a) * radio).toFixed(2)}`);
  }
  return puntos.join(' ');
}

/** Estrella de radios alternos: dientes de sierra y coronas de engranaje. */
function estrella(picos: number, radioExterno: number, radioInterno: number, giro = 0): string {
  const puntos: string[] = [];
  for (let i = 0; i < picos * 2; i++) {
    const r = i % 2 === 0 ? radioExterno : radioInterno;
    const a = giro + (Math.PI * i) / picos;
    puntos.push(`${(16 + Math.cos(a) * r).toFixed(2)},${(16 + Math.sin(a) * r).toFixed(2)}`);
  }
  return puntos.join(' ');
}

// --- Catálogo -------------------------------------------------------------

export type NombreIcono =
  // Tropa y retratos
  | 'aldeano'
  | 'casco'
  | 'arco'
  | 'jinete'
  | 'catapulta'
  // Edificios
  | 'castillo'
  | 'granja'
  | 'barracon'
  | 'aserradero'
  | 'torre'
  | 'yunque'
  // Recursos y marcadores
  | 'moneda'
  | 'tronco'
  | 'personas'
  | 'reloj'
  | 'calavera'
  | 'bandera'
  | 'corazon'
  | 'escudo'
  | 'espada'
  | 'hacha'
  // Acciones
  | 'espadas'
  | 'mover'
  | 'detener'
  | 'mantener'
  | 'patrullar'
  | 'pico'
  | 'martillo'
  | 'reparar'
  | 'construir'
  | 'volver'
  | 'cancelar'
  // Menús y opciones
  | 'engranaje'
  | 'pausa'
  | 'sonido'
  | 'rayo'
  | 'ojo'
  | 'brujula'
  | 'laurel';

/**
 * Contenido interior de cada icono.
 *
 * Se guardan las cadenas ya montadas y no funciones: los iconos son constantes y
 * así el coste de generarlos se paga una vez, al cargar el módulo.
 */
const DIBUJOS: Record<NombreIcono, string> = {
  // --- Tropa ---

  aldeano: `
    <path d="M9.5 19.5 C5 21 3 24.5 3 29 H29 C29 24.5 27 21 22.5 19.5 Z" fill="${C1}"/>
    <path d="M16 19.5 L13 29 H19 Z" fill="${C2}"/>
    <ellipse cx="16" cy="13.5" rx="5.4" ry="6.4" fill="${PIEL}"/>
    <path d="M16 2.5 C9.6 2.5 6.3 8.2 7.6 15 C8.6 11.4 10.9 9.4 16 9.4 C21.1 9.4 23.4 11.4 24.4 15 C25.7 8.2 22.4 2.5 16 2.5 Z" fill="${W2}"/>
    <path d="M16 2.5 C9.6 2.5 6.3 8.2 7.6 15 C8.6 11.4 10.9 9.4 16 9.4 Z" fill="${W1}"/>
    <circle cx="13.4" cy="13.6" r="0.95" fill="${CONTORNO}" stroke="none"/>
    <circle cx="18.6" cy="13.6" r="0.95" fill="${CONTORNO}" stroke="none"/>`,

  casco: `
    <path d="M4.5 21 C4.5 10.6 9.6 4.6 16 4.6 C22.4 4.6 27.5 10.6 27.5 21 V26.4 C27.5 27.6 26.6 28.4 25.4 28.4 H6.6 C5.4 28.4 4.5 27.6 4.5 26.4 Z" fill="${M2}"/>
    <path d="M4.5 21 C4.5 10.6 9.6 4.6 16 4.6 V28.4 H6.6 C5.4 28.4 4.5 27.6 4.5 26.4 Z" fill="${M1}" opacity="0.5" stroke="none"/>
    <path d="M6.6 15.5 H13.6 V19.6 H6.6 Z" fill="${CONTORNO}" stroke="none"/>
    <path d="M18.4 15.5 H25.4 V19.6 H18.4 Z" fill="${CONTORNO}" stroke="none"/>
    <path d="M14.3 8.5 H17.7 V27 H14.3 Z" fill="${M3}"/>
    <path d="M16 1.2 C18.4 3 19.4 5.2 19.2 7.6 H12.8 C12.6 5.2 13.6 3 16 1.2 Z" fill="${R1}"/>`,

  arco: `
    <path d="M11 3.5 C19.5 8.5 19.5 23.5 11 28.5" fill="none" stroke="${W2}" stroke-width="3.4"/>
    <path d="M11 3.5 L11 28.5" fill="none" stroke="${M2}" stroke-width="1.1"/>
    <path d="M5 16 H24" fill="none" stroke="${W3}" stroke-width="1.9"/>
    <path d="M22 12.4 L28.5 16 L22 19.6 Z" fill="${M1}"/>
    <path d="M5 16 L8.5 12.6 M5 16 L8.5 19.4" fill="none" stroke="${R1}" stroke-width="1.6"/>`,

  jinete: `
    <path d="M7 29 C7 21.5 8.6 16.4 12.2 13.2 L11.4 4.6 C11.3 3.5 12.4 2.9 13.2 3.6 L16.4 6.6 L19 4.2 C19.9 3.4 21.2 4.1 21 5.3 L19.9 11.6 C24.4 13.8 27.5 17 28.5 21 L23.4 22.6 C22 19.6 19.6 17.7 16.4 17.2 L16.9 21.5 C17.3 24.8 16.3 27.2 14.6 29 Z" fill="${C1}"/>
    <path d="M12.2 13.2 L19.9 11.6 C24.4 13.8 27.5 17 28.5 21 L23.4 22.6 C22 19.6 19.6 17.7 16.4 17.2 Z" fill="${C2}" stroke="none"/>
    <path d="M11.6 6.4 C9 9.6 8 14 8.2 19.6" fill="none" stroke="${W3}" stroke-width="1.5"/>
    <circle cx="19.6" cy="14.6" r="1.15" fill="${CONTORNO}" stroke="none"/>`,

  catapulta: `
    <path d="M6.5 25.5 L18 8.5" fill="none" stroke="${W2}" stroke-width="3.2"/>
    <path d="M4 25.5 H28" fill="none" stroke="${W3}" stroke-width="2.6"/>
    <path d="M12 25.5 L20.5 15" fill="none" stroke="${W1}" stroke-width="2"/>
    <path d="M14.5 10.5 C14.5 6.9 17.4 4 21 4 C24.6 4 27.5 6.9 27.5 10.5 Z" fill="${C1}"/>
    <circle cx="21" cy="8" r="3.1" fill="${P2}"/>
    <circle cx="8.5" cy="25.8" r="3.4" fill="${W1}"/>
    <circle cx="23.5" cy="25.8" r="3.4" fill="${W1}"/>
    <circle cx="8.5" cy="25.8" r="1.1" fill="${W3}" stroke="none"/>
    <circle cx="23.5" cy="25.8" r="1.1" fill="${W3}" stroke="none"/>`,

  // --- Edificios ---

  castillo: `
    <path d="M2.5 11 H4.8 V8.4 H7.1 V11 H9.4 V29 H2.5 Z" fill="${P2}"/>
    <path d="M22.6 11 H24.9 V8.4 H27.2 V11 H29.5 V29 H22.6 Z" fill="${P2}"/>
    <path d="M9.4 7.5 H11.8 V5 H14.2 V7.5 H17.8 V5 H20.2 V7.5 H22.6 V29 H9.4 Z" fill="${P1}"/>
    <path d="M13.2 29 V23.4 C13.2 21 18.8 21 18.8 23.4 V29 Z" fill="${W3}"/>
    <path d="M4.5 14 H7.5 V17.5 H4.5 Z M24.5 14 H27.5 V17.5 H24.5 Z" fill="${P3}"/>
    <path d="M14.4 11.5 H17.6 V16 H14.4 Z" fill="${P3}"/>
    <path d="M16 5 V0.8 M16 1.6 L21.4 3 L16 4.4" fill="${O2}" stroke="${CONTORNO}" stroke-width="0.8"/>`,

  granja: `
    <path d="M1.5 14.6 L16 4.2 L30.5 14.6 Z" fill="${R2}"/>
    <path d="M1.5 14.6 L16 4.2 L16 14.6 Z" fill="${R1}" stroke="none"/>
    <path d="M5 14.6 H27 V29 H5 Z" fill="${W1}"/>
    <path d="M16 14.6 H27 V29 H16 Z" fill="${W2}" stroke="none"/>
    <path d="M12 19.5 H20 V29 H12 Z" fill="${W3}"/>
    <path d="M12 19.5 L20 29 M20 19.5 L12 29" fill="none" stroke="${W1}" stroke-width="1.1"/>
    <path d="M5 14.6 H27" fill="none" stroke="${CONTORNO}" stroke-width="0.9"/>
    <circle cx="16" cy="9.6" r="1.9" fill="${O2}"/>`,

  barracon: `
    <path d="M3 12.5 L16 4.5 L29 12.5 V29 H3 Z" fill="${P2}"/>
    <path d="M3 12.5 L16 4.5 L16 29 H3 Z" fill="${P1}" stroke="none"/>
    <path d="M3 12.5 L16 4.5 L29 12.5" fill="none" stroke="${CONTORNO}" stroke-width="1"/>
    <g transform="rotate(45 16 20)">
      <path d="M15.1 12.5 H16.9 V25 L16 27 L15.1 25 Z" fill="${M1}"/>
      <path d="M12.4 24.7 H19.6 V26.4 H12.4 Z" fill="${O2}"/>
    </g>
    <g transform="rotate(-45 16 20)">
      <path d="M15.1 12.5 H16.9 V25 L16 27 L15.1 25 Z" fill="${M2}"/>
      <path d="M12.4 24.7 H19.6 V26.4 H12.4 Z" fill="${O3}"/>
    </g>`,

  aserradero: `
    <path d="M2.5 20 H25 A3.6 3.6 0 0 1 25 27.2 H2.5 A3.6 3.6 0 0 1 2.5 20 Z" fill="${W2}"/>
    <ellipse cx="6.2" cy="23.6" rx="3.4" ry="3.6" fill="${W1}"/>
    <ellipse cx="6.2" cy="23.6" rx="1.4" ry="1.5" fill="${W3}" stroke="none"/>
    <polygon points="${estrella(11, 11.5, 8.4)}" fill="${M2}" transform="translate(3 -5)"/>
    <circle cx="19" cy="11" r="6.4" fill="${M1}"/>
    <circle cx="19" cy="11" r="2" fill="${M4}"/>`,

  torre: `
    <path d="M6 4 H10 V10 H6 Z M13.5 4 H18.5 V10 H13.5 Z M22 4 H26 V10 H22 Z" fill="${P1}"/>
    <path d="M4.5 9.5 H27.5 V13 H4.5 Z" fill="${P1}"/>
    <path d="M8 13 H24 V29 H8 Z" fill="${P2}"/>
    <path d="M8 13 H16 V29 H8 Z" fill="${P1}" opacity="0.45" stroke="none"/>
    <path d="M13.6 17 H18.4 V23.5 A2.4 2.4 0 0 0 13.6 23.5 Z" fill="${CONTORNO}" stroke="none"/>
    <path d="M8 21 H24 M8 25.5 H24" fill="none" stroke="${P3}" stroke-width="0.9"/>`,

  yunque: `
    <path d="M2.5 12.5 C6.5 10.6 8.5 10 11.5 10 H27.5 C27.5 14 25 16.6 21 17.4 V20 H25 L28.5 28.5 H3.5 L7 20 H11 V17.4 C6.5 16.6 3.5 15 2.5 12.5 Z" fill="${M3}"/>
    <path d="M2.5 12.5 C6.5 10.6 8.5 10 11.5 10 H27.5 V12.6 H10.5 C7.5 12.6 5 12.6 2.5 12.5 Z" fill="${M2}" stroke="none"/>
    <path d="M6.4 21.5 H25.6" fill="none" stroke="${M4}" stroke-width="1"/>`,

  // --- Recursos y marcadores ---

  moneda: `
    <circle cx="16" cy="16" r="12.6" fill="${O3}"/>
    <circle cx="16" cy="16" r="10.4" fill="${O2}"/>
    <circle cx="16" cy="16" r="8" fill="none" stroke="${O1}" stroke-width="1.1"/>
    <polygon points="${estrella(5, 7, 3.1, -Math.PI / 2)}" fill="${O1}"/>`,

  tronco: `
    <path d="M6 9.5 H26 A6.5 6.5 0 0 1 26 22.5 H6 A6.5 6.5 0 0 1 6 9.5 Z" fill="${W2}"/>
    <ellipse cx="6.5" cy="16" rx="4.6" ry="6.5" fill="${W1}"/>
    <ellipse cx="6.5" cy="16" rx="2.7" ry="3.9" fill="none" stroke="${W3}" stroke-width="0.9"/>
    <ellipse cx="6.5" cy="16" rx="1" ry="1.4" fill="${W3}" stroke="none"/>
    <path d="M13 10.5 V21.5 M18.5 10 V22 M24 11 V21" fill="none" stroke="${W3}" stroke-width="1"/>`,

  personas: `
    <circle cx="11" cy="10.4" r="4.8" fill="${M1}"/>
    <path d="M2.6 28.5 C2.6 21 6.3 17.5 11 17.5 C15.7 17.5 19.4 21 19.4 28.5 Z" fill="${M2}"/>
    <circle cx="22.4" cy="12.6" r="4.1" fill="${M2}"/>
    <path d="M15.4 28.5 C15.4 22.4 18.6 19.4 22.4 19.4 C26.2 19.4 29.4 22.4 29.4 28.5 Z" fill="${M3}"/>`,

  reloj: `
    <path d="M12.5 2.5 H19.5" fill="none" stroke="${O3}" stroke-width="2.4"/>
    <circle cx="16" cy="18" r="12.2" fill="${O3}"/>
    <circle cx="16" cy="18" r="10.2" fill="#241d12"/>
    <circle cx="16" cy="18" r="8.6" fill="none" stroke="${O2}" stroke-width="0.9"/>
    <path d="M16 18 V10.8 M16 18 L21.4 20.6" fill="none" stroke="${O1}" stroke-width="1.8"/>
    <circle cx="16" cy="18" r="1.4" fill="${O2}" stroke="none"/>`,

  calavera: `
    <path d="M16 2.5 C8.6 2.5 4 8 4 14.6 C4 18.6 5.8 21.4 8 23 V26.4 C8 27.8 9 28.8 10.4 28.8 H21.6 C23 28.8 24 27.8 24 26.4 V23 C26.2 21.4 28 18.6 28 14.6 C28 8 23.4 2.5 16 2.5 Z" fill="${HUESO}"/>
    <ellipse cx="11.3" cy="15" rx="3.6" ry="4.2" fill="${CONTORNO}" stroke="none"/>
    <ellipse cx="20.7" cy="15" rx="3.6" ry="4.2" fill="${CONTORNO}" stroke="none"/>
    <path d="M16 18.6 L18.4 23 H13.6 Z" fill="${CONTORNO}" stroke="none"/>
    <path d="M12.4 24.6 V28.8 M16 24.6 V28.8 M19.6 24.6 V28.8" fill="none" stroke="${CONTORNO}" stroke-width="1.1"/>`,

  bandera: `
    <path d="M7.2 3 H10 V30 H7.2 Z" fill="${W3}"/>
    <path d="M10 4.2 H27.5 L23.2 10.4 L27.5 16.6 H10 Z" fill="${R1}"/>
    <path d="M10 4.2 H18.7 V16.6 H10 Z" fill="${R2}" stroke="none"/>
    <circle cx="8.6" cy="2.6" r="2.2" fill="${O2}"/>`,

  corazon: `
    <path d="M16 28.5 C6 21.8 3 17.6 3 12.6 C3 8.4 6.2 5.4 10.2 5.4 C12.8 5.4 14.9 6.8 16 8.9 C17.1 6.8 19.2 5.4 21.8 5.4 C25.8 5.4 29 8.4 29 12.6 C29 17.6 26 21.8 16 28.5 Z" fill="${R1}"/>
    <path d="M9.5 9 C7.5 9.6 6.4 11 6.2 13" fill="none" stroke="#f0a08c" stroke-width="1.7"/>`,

  escudo: `
    <path d="M16 2.4 L28.5 6.6 V16.4 C28.5 23.4 22.6 27.9 16 30 C9.4 27.9 3.5 23.4 3.5 16.4 V6.6 Z" fill="${M2}"/>
    <path d="M16 2.4 L28.5 6.6 V16.4 C28.5 23.4 22.6 27.9 16 30 Z" fill="${M3}" stroke="none"/>
    <path d="M16 6.6 L24.6 9.4 V16.2 C24.6 20.8 20.8 23.8 16 25.6 C11.2 23.8 7.4 20.8 7.4 16.2 V9.4 Z" fill="none" stroke="${O2}" stroke-width="1.5"/>
    <path d="M16 9.4 L18.4 15.2 H24.2 L19.5 18.8 L21.3 24.4 L16 20.9 L10.7 24.4 L12.5 18.8 L7.8 15.2 H13.6 Z" fill="${O2}" transform="scale(0.72) translate(6.2 4.4)"/>`,

  espada: `
    <path d="M16 1.5 L19.6 8 V19.4 H12.4 V8 Z" fill="${M1}"/>
    <path d="M16 1.5 L19.6 8 V19.4 H16 Z" fill="${M3}" stroke="none"/>
    <path d="M8.6 19.4 H23.4 L21.6 23 H10.4 Z" fill="${O2}"/>
    <path d="M14.3 23 H17.7 V27.4 H14.3 Z" fill="${C1}"/>
    <circle cx="16" cy="28.8" r="2.3" fill="${O2}"/>`,

  hacha: `
    <path d="M14.4 2.6 H17.6 V29.4 H14.4 Z" fill="${W2}"/>
    <path d="M17.2 4.4 C24.6 6 29 10 29 15 C29 20 24.6 24 17.2 25.6 Z" fill="${M2}"/>
    <path d="M17.2 4.4 C24.6 6 29 10 29 15 L17.2 15 Z" fill="${M1}" stroke="none"/>
    <path d="M14.8 4.4 C10.2 5.6 7.6 8.4 7.6 12 C7.6 15.6 10.2 18.4 14.8 19.6 Z" fill="${M3}"/>`,

  // --- Acciones ---

  espadas: `
    <g transform="rotate(42 16 16)">
      <path d="M15 2.5 L17 2.5 L17 20.5 L16 23 L15 20.5 Z" fill="${M1}"/>
      <path d="M11.4 20.5 H20.6 V22.6 H11.4 Z" fill="${O2}"/>
      <path d="M14.7 22.6 H17.3 V28.4 H14.7 Z" fill="${C1}"/>
    </g>
    <g transform="rotate(-42 16 16)">
      <path d="M15 2.5 L17 2.5 L17 20.5 L16 23 L15 20.5 Z" fill="${M2}"/>
      <path d="M11.4 20.5 H20.6 V22.6 H11.4 Z" fill="${O3}"/>
      <path d="M14.7 22.6 H17.3 V28.4 H14.7 Z" fill="${C2}"/>
    </g>`,

  mover: `
    <path d="M9.6 3 H16.4 C17.5 3 18.2 3.7 18.3 4.8 L19 13.6 C19.2 15.8 20.3 17.3 22.6 18.5 L26.6 20.6 C28.2 21.4 29 22.7 29 24.6 V27.2 C29 28.3 28.3 29 27.2 29 H9.6 C8.5 29 7.8 28.3 7.8 27.2 V4.8 C7.8 3.7 8.5 3 9.6 3 Z" fill="${C1}"/>
    <path d="M7.8 24.2 H29 V27.2 C29 28.3 28.3 29 27.2 29 H9.6 C8.5 29 7.8 28.3 7.8 27.2 Z" fill="${C2}"/>
    <path d="M7.8 9 H18.4 M7.8 14 H18.7" fill="none" stroke="${C2}" stroke-width="1.2"/>
    <path d="M3.2 8 L3.2 21" fill="none" stroke="${O2}" stroke-width="2"/>`,

  detener: `
    <polygon points="${poligono(8, 13.6, Math.PI / 8)}" fill="${R2}"/>
    <polygon points="${poligono(8, 11, Math.PI / 8)}" fill="${R1}"/>
    <path d="M9.4 14.1 H22.6 V17.9 H9.4 Z" fill="${HUESO}"/>`,

  mantener: `
    <path d="M16 1.8 L27.6 5.8 V15.4 C27.6 22 22.2 26.4 16 28.4 C9.8 26.4 4.4 22 4.4 15.4 V5.8 Z" fill="${M2}"/>
    <path d="M16 1.8 L27.6 5.8 V15.4 C27.6 22 22.2 26.4 16 28.4 Z" fill="${M3}" stroke="none"/>
    <path d="M16 7.6 V21.6 M11 12 L16 7 L21 12" fill="none" stroke="${O2}" stroke-width="2.2"/>
    <path d="M3 30.4 H29" fill="none" stroke="${O3}" stroke-width="2.4"/>`,

  patrullar: `
    <path d="M6 12.6 A11 11 0 0 1 24.6 9.4" fill="none" stroke="${O2}" stroke-width="3"/>
    <path d="M20.6 4.6 L27 9.8 L19.6 12 Z" fill="${O2}"/>
    <path d="M26 19.4 A11 11 0 0 1 7.4 22.6" fill="none" stroke="${M2}" stroke-width="3"/>
    <path d="M11.4 27.4 L5 22.2 L12.4 20 Z" fill="${M2}"/>`,

  pico: `
    <path d="M14.4 8 H17.6 V29.6 H14.4 Z" fill="${W2}"/>
    <path d="M2.5 12.4 C7 5.6 25 5.6 29.5 12.4 C24.5 9.2 7.5 9.2 2.5 12.4 Z" fill="${M2}"/>
    <path d="M2.5 12.4 C7 5.6 16 5.6 16 5.6 V9.9 C10.4 9.9 5.6 10.8 2.5 12.4 Z" fill="${M1}" stroke="none"/>
    <path d="M12.6 7.6 H19.4 V11 H12.6 Z" fill="${C1}"/>`,

  martillo: `
    <path d="M13.8 11 H18.2 V29.6 H13.8 Z" fill="${W2}"/>
    <path d="M4 5.4 H28 L25.6 13.6 H6.4 Z" fill="${M2}"/>
    <path d="M4 5.4 H16 L16 13.6 H6.4 Z" fill="${M1}" stroke="none"/>
    <path d="M13.8 13.6 H18.2 V16.6 H13.8 Z" fill="${C1}"/>`,

  reparar: `
    <path d="M13.4 12 H17.8 V29.6 H13.4 Z" fill="${W2}" transform="rotate(-16 16 20)"/>
    <path d="M3.6 7 H27.6 L25.2 15.2 H6 Z" fill="${M2}" transform="rotate(-16 16 20)"/>
    <path d="M22.6 2.4 H26.4 V6.6 H30.6 V10.4 H26.4 V14.6 H22.6 V10.4 H18.4 V6.6 H22.6 Z" fill="${V1}"/>`,

  construir: `
    <path d="M3 15.5 L15 6.5 L27 15.5 V28.5 H3 Z" fill="${P2}"/>
    <path d="M3 15.5 L15 6.5 L15 28.5 H3 Z" fill="${P1}" stroke="none"/>
    <path d="M11 20 H19 V28.5 H11 Z" fill="${W3}"/>
    <path d="M21.4 12.6 H25.4 V29 H21.4 Z" fill="${W2}" transform="rotate(28 23.4 20)"/>
    <path d="M15.6 6.6 H30.4 L29 12.4 H17 Z" fill="${M2}" transform="rotate(28 23.4 20)"/>`,

  volver: `
    <path d="M2.5 16 L13.5 5 V11.4 H27.5 V20.6 H13.5 V27 Z" fill="${O2}"/>
    <path d="M2.5 16 L13.5 5 V11.4 L8 16 L13.5 20.6 V27 Z" fill="${O1}" stroke="none"/>`,

  cancelar: `
    <path d="M8.8 5.6 L16 12.8 L23.2 5.6 L26.4 8.8 L19.2 16 L26.4 23.2 L23.2 26.4 L16 19.2 L8.8 26.4 L5.6 23.2 L12.8 16 L5.6 8.8 Z" fill="${R1}"/>`,

  // --- Menús y opciones ---

  engranaje: `
    <polygon points="${estrella(8, 14, 10.4, Math.PI / 8)}" fill="${M3}"/>
    <circle cx="16" cy="16" r="8.4" fill="${M2}"/>
    <circle cx="16" cy="16" r="4.2" fill="#241d12"/>`,

  pausa: `
    <path d="M7.5 4.5 H13.5 V27.5 H7.5 Z" fill="${O2}"/>
    <path d="M18.5 4.5 H24.5 V27.5 H18.5 Z" fill="${O2}"/>
    <path d="M7.5 4.5 H10.5 V27.5 H7.5 Z M18.5 4.5 H21.5 V27.5 H18.5 Z" fill="${O1}" stroke="none"/>`,

  sonido: `
    <path d="M3 12 H8.5 L15.5 5.5 V26.5 L8.5 20 H3 Z" fill="${O2}"/>
    <path d="M19 11 A7 7 0 0 1 19 21" fill="none" stroke="${O1}" stroke-width="2.2"/>
    <path d="M23.4 7.4 A12 12 0 0 1 23.4 24.6" fill="none" stroke="${O3}" stroke-width="2.2"/>`,

  rayo: `
    <path d="M18.6 1.5 L6 18 H14 L12.4 30.5 L26 13.5 H17.4 Z" fill="${O2}"/>
    <path d="M18.6 1.5 L6 18 H14 Z" fill="${O1}" stroke="none"/>`,

  ojo: `
    <path d="M1.8 16 C6 8.6 11 5 16 5 C21 5 26 8.6 30.2 16 C26 23.4 21 27 16 27 C11 27 6 23.4 1.8 16 Z" fill="${HUESO}"/>
    <circle cx="16" cy="16" r="6.6" fill="#3f7fa8"/>
    <circle cx="16" cy="16" r="3.1" fill="${CONTORNO}" stroke="none"/>
    <circle cx="13.8" cy="13.6" r="1.3" fill="#ffffff" stroke="none"/>`,

  brujula: `
    <circle cx="16" cy="16" r="13" fill="${O3}"/>
    <circle cx="16" cy="16" r="10.8" fill="#241d12"/>
    <path d="M16 6.2 L19.6 15.2 L16 12.6 L12.4 15.2 Z" fill="${R1}"/>
    <path d="M16 25.8 L12.4 16.8 L16 19.4 L19.6 16.8 Z" fill="${HUESO}"/>`,

  laurel: `
    <path d="M16 4 C9 8 6.5 15 8.5 24 C12.5 22 15.5 18 16 12" fill="none" stroke="${V1}" stroke-width="2.6"/>
    <path d="M16 4 C23 8 25.5 15 23.5 24 C19.5 22 16.5 18 16 12" fill="none" stroke="${V1}" stroke-width="2.6"/>
    <path d="M8.5 24 C11.5 27.5 20.5 27.5 23.5 24" fill="none" stroke="${O2}" stroke-width="2.4"/>
    <polygon points="${estrella(5, 6.2, 2.7, -Math.PI / 2)}" fill="${O2}" transform="translate(0 -6)"/>`,
};

// --- Fábrica --------------------------------------------------------------

/**
 * Marca SVG completa de un icono.
 *
 * `aria-hidden` es deliberado: el icono nunca es la única forma de leer un botón,
 * siempre lo acompaña un nombre en texto, así que anunciarlo solo añadiría ruido
 * a un lector de pantalla.
 */
export function svgIcono(nombre: NombreIcono): string {
  const dibujo = DIBUJOS[nombre] ?? DIBUJOS.escudo;
  return (
    `<svg class="icono-svg" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">` +
    `<g stroke="${CONTORNO}" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" fill="none">` +
    dibujo +
    `</g></svg>`
  );
}

/** Envuelve el icono en un elemento listo para insertar. */
export function elementoIcono(nombre: NombreIcono, clase = ''): HTMLElement {
  const caja = document.createElement('span');
  caja.className = `icono ${clase}`.trim();
  caja.innerHTML = svgIcono(nombre);
  return caja;
}

const ICONO_UNIDAD: Record<TipoUnidad, NombreIcono> = {
  [TipoUnidad.CAMPESINO]: 'aldeano',
  [TipoUnidad.SOLDADO]: 'casco',
  [TipoUnidad.ARQUERO]: 'arco',
  [TipoUnidad.JINETE]: 'jinete',
  [TipoUnidad.CATAPULTA]: 'catapulta',
};

const ICONO_EDIFICIO: Record<TipoEdificio, NombreIcono> = {
  [TipoEdificio.AYUNTAMIENTO]: 'castillo',
  [TipoEdificio.GRANJA]: 'granja',
  [TipoEdificio.BARRACON]: 'barracon',
  [TipoEdificio.ASERRADERO]: 'aserradero',
  [TipoEdificio.TORRE]: 'torre',
  [TipoEdificio.HERRERIA]: 'yunque',
};

export function iconoDeUnidad(tipo: TipoUnidad): NombreIcono {
  return ICONO_UNIDAD[tipo] ?? 'casco';
}

export function iconoDeEdificio(tipo: TipoEdificio): NombreIcono {
  return ICONO_EDIFICIO[tipo] ?? 'castillo';
}

/** Todos los nombres disponibles. Útil para una hoja de contactos de depuración. */
export const NOMBRES_ICONO = Object.keys(DIBUJOS) as NombreIcono[];
