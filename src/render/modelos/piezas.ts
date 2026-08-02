import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from '../../core/math';
import type { Acabado } from './materiales';
import { BancoMateriales, colorLineal } from './materiales';

/**
 * Constructores de geometría reutilizables.
 *
 * Todas las funciones devuelven geometrías **ya pintadas**: con el atributo `color`
 * relleno y sin coordenadas de textura. Esto es lo que permite fusionar piezas de
 * materiales distintos en una sola malla más adelante (ver `Ensamblador`).
 *
 * Convenio de ejes, fijo en todo el módulo de modelos:
 *   - X a la derecha del modelo, Y arriba, Z hacia delante.
 *   - **Con rotación cero, un modelo mira hacia +Z.**
 *   - Las piezas «apoyadas» (prismas, troncos, edificios) nacen con su base en y = 0.
 */

const _color = { r: 1, g: 1, b: 1 };

/**
 * Hornea un color en los vértices y normaliza la geometría para poder fusionarla.
 *
 * Quitar las UV no es una economía menor: ninguna pieza usa textura, y todas las
 * geometrías tienen que compartir exactamente el mismo juego de atributos para que
 * `mergeGeometries` no se niegue a trabajar.
 */
export function pintar(geo: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  geo.deleteAttribute('uv');
  geo.deleteAttribute('uv1');
  geo.deleteAttribute('uv2');
  geo.deleteAttribute('tangent');

  if (!geo.getAttribute('normal')) geo.computeVertexNormals();

  colorLineal(color, _color);
  const cuenta = geo.getAttribute('position').count;
  const colores = new Float32Array(cuenta * 3);
  for (let i = 0; i < cuenta; i++) {
    colores[i * 3] = _color.r;
    colores[i * 3 + 1] = _color.g;
    colores[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colores, 3));

  // Los poliedros de Three (icosaedro, extrusión) salen sin índice. Mezclar
  // indexadas con no indexadas rompe la fusión, así que las indexamos aquí.
  // `mergeVertices` compara también la normal, de modo que las aristas duras
  // sobreviven intactas.
  return geo.index ? geo : mergeVertices(geo);
}

// --- Transformaciones (mutan y devuelven, para poder encadenar) ---

export function mover(geo: THREE.BufferGeometry, x: number, y: number, z: number): THREE.BufferGeometry {
  geo.translate(x, y, z);
  return geo;
}

export function girarX(geo: THREE.BufferGeometry, angulo: number): THREE.BufferGeometry {
  geo.rotateX(angulo);
  return geo;
}

export function girarY(geo: THREE.BufferGeometry, angulo: number): THREE.BufferGeometry {
  geo.rotateY(angulo);
  return geo;
}

export function girarZ(geo: THREE.BufferGeometry, angulo: number): THREE.BufferGeometry {
  geo.rotateZ(angulo);
  return geo;
}

export function escalar(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  geo.scale(x, y, z);
  return geo;
}

/** Fusiona varias geometrías compatibles en una sola. Devuelve null si la lista está vacía. */
export function fusionar(geos: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (geos.length === 0) return null;
  if (geos.length === 1) return geos[0]!;
  const fusion = mergeGeometries(geos, false);
  if (!fusion) return geos[0]!;
  for (const geo of geos) geo.dispose();
  return fusion;
}

// --- Primitivas ---

/** Caja centrada en el origen. */
export function caja(ancho: number, alto: number, fondo: number, color: number): THREE.BufferGeometry {
  return pintar(new THREE.BoxGeometry(ancho, alto, fondo), color);
}

/** Caja centrada en (x, y, z). El atajo más usado de todo el módulo. */
export function cajaEn(
  ancho: number,
  alto: number,
  fondo: number,
  x: number,
  y: number,
  z: number,
  color: number,
): THREE.BufferGeometry {
  return mover(caja(ancho, alto, fondo, color), x, y, z);
}

/**
 * Prisma de sección rectangular con base y tapa de distinto tamaño, apoyado en y = 0.
 *
 * Es la pieza más útil del repertorio: torsos que se estrechan hacia la cintura,
 * muslos, torres que se afinan, tejados que se cierran en punta. Un ahusado suave
 * es la diferencia entre una figura tallada y un montón de cajas.
 */
export function prisma(
  anchoInf: number,
  fondoInf: number,
  anchoSup: number,
  fondoSup: number,
  alto: number,
  color: number,
): THREE.BufferGeometry {
  const ai = anchoInf / 2;
  const fi = fondoInf / 2;
  const as = anchoSup / 2;
  const fs = fondoSup / 2;

  // A B C D abajo (z-, z+ en sentido horario visto desde arriba), E F G H arriba.
  const v: number[][] = [
    [-ai, 0, -fi], [ai, 0, -fi], [ai, 0, fi], [-ai, 0, fi],
    [-as, alto, -fs], [as, alto, -fs], [as, alto, fs], [-as, alto, fs],
  ];

  const quads: number[][] = [
    [4, 7, 6, 5], // tapa
    [0, 1, 2, 3], // base
    [3, 2, 6, 7], // frente (+Z)
    [1, 0, 4, 5], // dorso (-Z)
    [1, 5, 6, 2], // derecha (+X)
    [0, 3, 7, 4], // izquierda (-X)
  ];

  const posiciones: number[] = [];
  for (const q of quads) {
    const [a, b, c, d] = [v[q[0]!]!, v[q[1]!]!, v[q[2]!]!, v[q[3]!]!];
    posiciones.push(...a, ...b, ...c, ...a, ...c, ...d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(posiciones, 3));
  geo.computeVertexNormals();
  return pintar(geo, color);
}

/** Cilindro apoyado en y = 0 (a diferencia del de Three, que va centrado). */
export function cilindro(
  radioSup: number,
  radioInf: number,
  alto: number,
  color: number,
  segmentos = 10,
): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(radioSup, radioInf, alto, segmentos, 1);
  return mover(pintar(geo, color), 0, alto / 2, 0);
}

/** Cilindro centrado en el origen, útil como eje o miembro. */
export function barra(
  radio: number,
  largo: number,
  color: number,
  segmentos = 8,
): THREE.BufferGeometry {
  return pintar(new THREE.CylinderGeometry(radio, radio, largo, segmentos, 1), color);
}

export function esfera(radio: number, color: number, segmentos = 12, anillos = 9): THREE.BufferGeometry {
  return pintar(new THREE.SphereGeometry(radio, segmentos, anillos), color);
}

/** Media esfera con el corte hacia abajo: cascos, cúpulas, hombreras. */
export function cupula(radio: number, color: number, segmentos = 12, anillos = 6): THREE.BufferGeometry {
  return pintar(
    new THREE.SphereGeometry(radio, segmentos, anillos, 0, Math.PI * 2, 0, Math.PI * 0.5),
    color,
  );
}

/** Cono apoyado en y = 0. */
export function cono(radio: number, alto: number, color: number, segmentos = 10): THREE.BufferGeometry {
  return mover(pintar(new THREE.ConeGeometry(radio, alto, segmentos, 1), color), 0, alto / 2, 0);
}

export function toro(
  radio: number,
  tubo: number,
  color: number,
  segmentosTubo = 6,
  segmentosAnillo = 14,
): THREE.BufferGeometry {
  return pintar(new THREE.TorusGeometry(radio, tubo, segmentosTubo, segmentosAnillo), color);
}

/**
 * Cápsula: el miembro básico. Redondear los extremos evita el aspecto de muñeco de
 * palos y a distancia de juego es lo que hace que un brazo parezca un brazo.
 */
export function capsula(radio: number, largo: number, color: number, segmentos = 8): THREE.BufferGeometry {
  return pintar(new THREE.CapsuleGeometry(radio, largo, 2, segmentos), color);
}

/**
 * Perfil de revolución. Con cuatro puntos salen yelmos, cúpulas de torre, jarrones
 * y contrapesos con una silueta mucho más rica que la de una primitiva.
 */
export function revolucion(
  perfil: readonly (readonly [number, number])[],
  color: number,
  segmentos = 12,
): THREE.BufferGeometry {
  const puntos = perfil.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return pintar(new THREE.LatheGeometry(puntos, segmentos), color);
}

/**
 * Bloque irregular con aspecto de roca.
 *
 * Un icosaedro subdividido al que se le desplazan los vértices con ruido
 * determinista. Con material facetado, las caras planas atrapan la luz del sol en
 * ángulos distintos y la roca deja de ser una pelota gris.
 */
export function roca(
  radio: number,
  color: number,
  semilla: number,
  irregularidad = 0.28,
  detalle = 1,
): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(radio, detalle);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Cuantizamos la posición para que los vértices coincidentes reciban el mismo
    // desplazamiento: si no, la malla se abre por las costuras.
    const k = hash2(Math.round(x * 97) + Math.round(z * 31), Math.round(y * 97), semilla);
    const f = 1 + (k - 0.5) * 2 * irregularidad;
    pos.setXYZ(i, x * f, y * f * 0.92, z * f);
  }

  geo.computeVertexNormals();
  return pintar(geo, color);
}

/**
 * Tejado a dos aguas: dos faldones inclinados más los dos hastiales que los cierran.
 * Se devuelve ya fusionado porque nunca se anima por partes.
 */
export function techoDosAguas(
  ancho: number,
  fondo: number,
  alto: number,
  grosor: number,
  colorFaldon: number,
  colorHastial: number,
  vuelo = 0.08,
): THREE.BufferGeometry {
  const mitad = ancho / 2 + vuelo;
  const largoFaldon = Math.hypot(mitad, alto);
  const angulo = Math.atan2(mitad, alto);
  const partes: THREE.BufferGeometry[] = [];

  for (const lado of [-1, 1]) {
    const faldon = caja(grosor, largoFaldon, fondo + vuelo * 2, colorFaldon);
    girarZ(faldon, lado * angulo);
    mover(faldon, (lado * mitad) / 2, alto / 2, 0);
    partes.push(faldon);
  }

  // Hastiales: los triángulos que tapan los extremos. Sin ellos el tejado se ve
  // hueco desde el lateral y delata que es cartón.
  for (const lado of [-1, 1]) {
    const hastial = prisma(ancho, grosor, 0.02, grosor, alto, colorHastial);
    mover(hastial, 0, 0, (lado * fondo) / 2);
    partes.push(hastial);
  }

  return fusionar(partes)!;
}

/**
 * Corona de almenas sobre un rectángulo. Es la firma visual de la piedra humana:
 * un borde dentado se reconoce a cualquier distancia.
 */
export function almenas(
  ancho: number,
  fondo: number,
  alto: number,
  grosor: number,
  color: number,
  paso = 0.3,
): THREE.BufferGeometry {
  const partes: THREE.BufferGeometry[] = [];
  const nx = Math.max(2, Math.round(ancho / paso));
  const nz = Math.max(2, Math.round(fondo / paso));
  const anchoDiente = (ancho / nx) * 0.55;
  const fondoDiente = (fondo / nz) * 0.55;

  for (let i = 0; i < nx; i++) {
    const x = -ancho / 2 + (i + 0.5) * (ancho / nx);
    for (const lado of [-1, 1]) {
      partes.push(cajaEn(anchoDiente, alto, grosor, x, alto / 2, (lado * fondo) / 2, color));
    }
  }
  for (let i = 0; i < nz; i++) {
    const z = -fondo / 2 + (i + 0.5) * (fondo / nz);
    if (Math.abs(z) > fondo / 2 - fondoDiente) continue;
    for (const lado of [-1, 1]) {
      partes.push(cajaEn(grosor, alto, fondoDiente, (lado * ancho) / 2, alto / 2, z, color));
    }
  }

  return fusionar(partes)!;
}

/**
 * Empalizada de estacas puntiagudas alrededor de un rectángulo. La firma de los
 * orcos, igual que las almenas lo son de los humanos.
 */
export function empalizada(
  ancho: number,
  fondo: number,
  alto: number,
  radio: number,
  color: number,
  semilla: number,
  paso = 0.26,
): THREE.BufferGeometry {
  const partes: THREE.BufferGeometry[] = [];

  const estaca = (x: number, z: number, indice: number): void => {
    const h = alto * (0.78 + hash2(indice, 3, semilla) * 0.42);
    const inclinacion = (hash2(indice, 7, semilla) - 0.5) * 0.22;
    const tronco = cilindro(radio * 0.55, radio, h, color, 6);
    // Punta: la estaca sin afilar parece un poste de valla, no una defensa.
    const punta = mover(cono(radio * 0.62, radio * 2.2, color, 6), 0, h, 0);
    const g = fusionar([tronco, punta])!;
    girarZ(g, inclinacion);
    girarY(g, hash2(indice, 11, semilla) * 3.14);
    partes.push(mover(g, x, 0, z));
  };

  const nx = Math.max(2, Math.round(ancho / paso));
  const nz = Math.max(2, Math.round(fondo / paso));
  let indice = 0;
  for (let i = 0; i <= nx; i++) {
    const x = -ancho / 2 + (i * ancho) / nx;
    estaca(x, -fondo / 2, indice++);
    estaca(x, fondo / 2, indice++);
  }
  for (let i = 1; i < nz; i++) {
    const z = -fondo / 2 + (i * fondo) / nz;
    estaca(-ancho / 2, z, indice++);
    estaca(ancho / 2, z, indice++);
  }

  return fusionar(partes)!;
}

/** Pila de troncos apilados en pirámide. Decoración de aserraderos y campamentos. */
export function pilaTroncos(
  filas: number,
  largo: number,
  radio: number,
  color: number,
  colorCorte: number,
): THREE.BufferGeometry {
  const partes: THREE.BufferGeometry[] = [];
  for (let fila = 0; fila < filas; fila++) {
    const cuenta = filas - fila;
    for (let i = 0; i < cuenta; i++) {
      const x = (i - (cuenta - 1) / 2) * radio * 2.05;
      const y = radio + fila * radio * 1.75;
      const tronco = girarX(barra(radio, largo, color, 7), Math.PI / 2);
      partes.push(mover(tronco, x, y, 0));
      for (const lado of [-1, 1]) {
        partes.push(
          mover(
            girarX(pintar(new THREE.CircleGeometry(radio * 0.97, 7), colorCorte), lado > 0 ? 0 : Math.PI),
            x,
            y,
            (lado * largo) / 2 + lado * 0.002,
          ),
        );
      }
    }
  }
  return fusionar(partes)!;
}

// --- Ensamblado ---

interface Lote {
  acabado: Acabado;
  /** Nivel de detalle máximo en el que la pieza sigue viéndose. */
  detalle: 0 | 1 | 2;
  sombra: boolean;
  geos: THREE.BufferGeometry[];
}

export interface OpcionesPieza {
  /**
   * Nivel de LOD máximo en el que la pieza sigue visible.
   * 2 = siempre; 1 = desaparece en silueta; 0 = solo en el nivel de detalle completo.
   */
  detalle?: 0 | 1 | 2;
  /** Proyecta sombra. Solo para piezas grandes: una hebilla no aporta y cuesta. */
  sombra?: boolean;
}

/**
 * Acumula geometrías y las vuelca en el mínimo número de mallas posible.
 *
 * Agrupa por acabado, nivel de detalle y sombra: todo lo que comparte esas tres
 * cosas acaba en una sola malla fusionada. Es la pieza clave del presupuesto de
 * llamadas de dibujado: un ayuntamiento con ciento y pico piezas sale en cuatro.
 */
export class Ensamblador {
  private lotes: Lote[] = [];

  anadir(geo: THREE.BufferGeometry, acabado: Acabado, opciones?: OpcionesPieza): this {
    const detalle = opciones?.detalle ?? 2;
    const sombra = opciones?.sombra ?? false;

    let lote = this.lotes.find(
      (l) => l.acabado === acabado && l.detalle === detalle && l.sombra === sombra,
    );
    if (!lote) {
      lote = { acabado, detalle, sombra, geos: [] };
      this.lotes.push(lote);
    }
    lote.geos.push(geo);
    return this;
  }

  /** Atajo para meter varias geometrías del mismo acabado de una vez. */
  anadirVarias(geos: THREE.BufferGeometry[], acabado: Acabado, opciones?: OpcionesPieza): this {
    for (const geo of geos) this.anadir(geo, acabado, opciones);
    return this;
  }

  get vacio(): boolean {
    return this.lotes.length === 0;
  }

  /** Fusiona lo acumulado y cuelga las mallas resultantes de `destino`. */
  volcarEn(destino: THREE.Object3D, banco: BancoMateriales, nombre: string): void {
    for (const lote of this.lotes) {
      const geo = fusionar(lote.geos);
      if (!geo) continue;
      geo.computeBoundingSphere();

      const malla = new THREE.Mesh(geo, banco.material(lote.acabado));
      malla.name = `${nombre}:${lote.acabado}`;
      malla.castShadow = lote.sombra;
      malla.receiveShadow = false;
      if (lote.detalle < 2) malla.userData.detalle = lote.detalle;
      destino.add(malla);
    }
    this.lotes.length = 0;
  }
}

/** Nodo articulado con nombre y pivote. La unidad mínima de la animación. */
export function nodo(nombre: string, x = 0, y = 0, z = 0): THREE.Group {
  const grupo = new THREE.Group();
  grupo.name = nombre;
  grupo.position.set(x, y, z);
  return grupo;
}

/** Recorre un objeto y libera todas las geometrías que cuelgan de él. */
export function liberarGeometrias(raiz: THREE.Object3D): void {
  raiz.traverse((objeto) => {
    const malla = objeto as THREE.Mesh;
    if (malla.isMesh && malla.geometry) malla.geometry.dispose();
  });
}
