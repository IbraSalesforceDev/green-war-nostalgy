import * as THREE from 'three';
import { variarColor } from '../../render/modelos/materiales';
import { TERRITORIOS, type Territorio } from '../territorios';
import { BandoCampana, type IdTerritorio } from '../tipos';

/**
 * El mapa de campaña, dibujado como una lámina.
 *
 * Cada territorio es su polígono plano, con el color de quien lo controla y su
 * frontera trazada a tinta encima. El aire de mapa antiguo no sale de ningún
 * filtro caro: sale de colores aguados, trazos oscuros y el papel asomando por
 * los huecos.
 *
 * Antes iba en relieve, con cada provincia extruida como una losa. Daba volumen
 * pero también sombras propias y cantos, y el país quedaba roto en dieciocho
 * bloques sueltos que no se reconocían. Plano se lee mejor —que es lo que se le
 * pide a un mapa— y además es lo que enseñaba el original.
 *
 * ── Del mapa plano al espacio ────────────────────────────────────────────────
 * Los territorios se definen en coordenadas de mapa —`x` de oeste a este, `y` de
 * sur a norte— y aquí se llevan al plano XZ de la escena: la `x` del mapa es la
 * `x` del mundo, la `y` del mapa es el `-z`, y el alto queda para `y`. Así el
 * norte apunta hacia el fondo de la pantalla, que es como se lee un mapa.
 *
 * ── Estados que sabe pintar ──────────────────────────────────────────────────
 * Un territorio puede estar en reposo, resaltado (el dedo encima) o marcado como
 * destino legal del ejército elegido. Los tres se resuelven tocando solo el color
 * del material, sin reconstruir ninguna geometría: eso ocurre en cada fotograma y
 * tiene que costar cero.
 */

/** Tamaño del mapa en unidades de escena. Los datos vienen en 0..100. */
const ESCALA = 1;

/**
 * Centro real del dibujo.
 *
 * No es (50, 50): el país ocupa de 11 a 97 a lo ancho y de 3 a 93 a lo alto, así
 * que restar 50 lo dejaba descolgado hacia un lado de la lámina. Se resta su
 * centro de verdad para que quede centrado sobre el papel.
 */
const CENTRO_X = 54;
const CENTRO_Y = 48;

/**
 * El mapa es plano, no un relieve.
 *
 * La versión anterior extruía cada territorio como una losa de tierra. Daba
 * volumen, sí, pero también sombras propias, cantos y una silueta rota por
 * dieciocho bloques sueltos: el país no se reconocía. Una lámina plana con sus
 * fronteras a tinta se lee de un vistazo y es, además, lo que enseñaba el
 * original.
 *
 * Queda una altura mínima, la justa para que las fichas de los ejércitos se
 * apoyen encima y no compitan en el mismo plano con el dibujo del mapa.
 */
export const ALTURA_SUPERFICIE = 0.12;

/**
 * Colores de bando sobre papel.
 *
 * Más apagados y cálidos que los de antes: sobre una lámina de mapa, un azul
 * saturado canta como una aplicación web y rompe la ilusión. Estos son tintas
 * aguadas, que es como se coloreaban los mapas de la época.
 */
const COLOR_BANDO: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0xa89f88,
  [BandoCampana.UNION]: 0x7f9ec4,
  // Bien separado del papel: el primer pardo elegido quedaba a un pelo del color
  // de la lámina y el Sur entero desaparecía contra el mar.
  [BandoCampana.CONFEDERACION]: 0xb9a173,
};

/** Tinta de las fronteras y del contorno de la costa. */
const COLOR_TINTA = 0x4a3a24;

/** El papel sobre el que está dibujado el mapa. Más claro que cualquier bando. */
const COLOR_PAPEL = 0xdccaa6;

export interface MapaCampana {
  readonly raiz: THREE.Group;
  /** Repinta los territorios según quién los controle ahora. */
  sincronizar(duenoDe: (id: IdTerritorio) => BandoCampana): void;
  /** Marca el territorio bajo el puntero. `null` para ninguno. */
  fijarResaltado(id: IdTerritorio | null): void;
  /** Marca los territorios a los que el ejército elegido puede ir. */
  fijarDestinos(ids: readonly IdTerritorio[]): void;
  /** Marca el territorio del ejército elegido. */
  fijarSeleccionado(id: IdTerritorio | null): void;
  /** Mallas contra las que lanzar el rayo del puntero. */
  readonly superficies: readonly THREE.Mesh[];
  /** Qué territorio es una malla devuelta por el rayo. */
  territorioDe(objeto: THREE.Object3D): IdTerritorio | null;
  /** Centro de un territorio en coordenadas de escena. */
  posicionDe(id: IdTerritorio): THREE.Vector3;
  liberar(): void;
}

/** Lleva un punto del mapa (x, y) al plano de la escena. */
export function aEscena(x: number, y: number, alto = 0): THREE.Vector3 {
  return new THREE.Vector3((x - CENTRO_X) * ESCALA, alto, -(y - CENTRO_Y) * ESCALA);
}

interface PiezaTerritorio {
  territorio: Territorio;
  malla: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  /** Color que le toca por dueño, antes de resaltados. */
  colorBase: THREE.Color;
}

export function crearMapaCampana(escena: THREE.Scene): MapaCampana {
  const raiz = new THREE.Group();
  raiz.name = 'mapa-campana';
  escena.add(raiz);

  const piezas = new Map<IdTerritorio, PiezaTerritorio>();
  const porObjeto = new Map<THREE.Object3D, IdTerritorio>();
  const superficies: THREE.Mesh[] = [];
  const desechables: Array<{ dispose(): void }> = [];

  for (const territorio of TERRITORIOS) {
    const forma = new THREE.Shape();
    territorio.contorno.forEach(([x, y], indice) => {
      const px = (x - CENTRO_X) * ESCALA;
      const py = (y - CENTRO_Y) * ESCALA;
      if (indice === 0) forma.moveTo(px, py);
      else forma.lineTo(px, py);
    });
    forma.closePath();

    // Superficie plana. `ShapeGeometry` la genera ya en el plano XY; una rotación
    // la tumba al suelo.
    const geometria = new THREE.ShapeGeometry(forma);
    geometria.rotateX(-Math.PI / 2);
    desechables.push(geometria);

    // Sin relieve no hay luces que valgan: un material básico da el color plano y
    // exacto de una tinta, sin que el sol lo apague por un lado.
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    desechables.push(material);

    const malla = new THREE.Mesh(geometria, material);
    malla.position.y = ALTURA_SUPERFICIE;
    malla.userData.territorio = territorio.id;
    raiz.add(malla);

    // Frontera a tinta: el trazo que convierte manchas de color en un mapa.
    const puntos = territorio.contorno.map(
      ([x, y]) =>
        new THREE.Vector3(
          (x - CENTRO_X) * ESCALA,
          ALTURA_SUPERFICIE + 0.02,
          -(y - CENTRO_Y) * ESCALA,
        ),
    );
    puntos.push(puntos[0]!.clone());
    const geoBorde = new THREE.BufferGeometry().setFromPoints(puntos);
    const matBorde = new THREE.LineBasicMaterial({ color: COLOR_TINTA });
    raiz.add(new THREE.Line(geoBorde, matBorde));
    desechables.push(geoBorde, matBorde);

    piezas.set(territorio.id, {
      territorio,
      malla,
      material,
      colorBase: new THREE.Color(0xffffff),
    });
    porObjeto.set(malla, territorio.id);
    superficies.push(malla);

    anadirEmblemas(raiz, territorio, desechables);
  }

  // La costa, trazada gruesa alrededor de todo el país.
  //
  // Es lo que separa un mapa de un mosaico de manchas. Las fronteras interiores
  // van a línea fina y esta a banda ancha: la jerarquía de trazo es la que hace
  // que el ojo lea primero la silueta —Florida colgando, el golfo, Nueva
  // Inglaterra— y solo después el reparto de provincias.
  const costa = bandaDelLitoral(1.5);
  raiz.add(costa);
  desechables.push(costa.geometry, costa.material as THREE.Material);

  // El papel sobre el que está dibujado todo. Asoma por los huecos entre
  // territorios y hace de mar y de márgenes a la vez. Acotado al tamaño de una
  // lámina: si cubre toda la vista, el mapa deja de parecer un objeto sobre una
  // mesa y pasa a ser un fondo sin más.
  const papel = new THREE.Mesh(
    new THREE.PlaneGeometry(124, 124),
    new THREE.MeshBasicMaterial({ color: COLOR_PAPEL }),
  );
  papel.rotation.x = -Math.PI / 2;
  raiz.add(papel);

  // Filo de la lámina, para que se despegue del fondo.
  const filo = new THREE.Mesh(
    new THREE.PlaneGeometry(128, 128),
    new THREE.MeshBasicMaterial({ color: 0x8a7550 }),
  );
  filo.rotation.x = -Math.PI / 2;
  filo.position.y = -0.02;
  raiz.add(filo);

  desechables.push(
    papel.geometry,
    papel.material as THREE.Material,
    filo.geometry,
    filo.material as THREE.Material,
  );

  let resaltado: IdTerritorio | null = null;
  let seleccionado: IdTerritorio | null = null;
  let destinos: readonly IdTerritorio[] = [];

  /** Aplica al material el color que corresponda al estado actual del territorio. */
  function repintar(pieza: PiezaTerritorio): void {
    const id = pieza.territorio.id;
    const color = pieza.colorBase.clone();
    if (id === seleccionado) {
      color.lerp(new THREE.Color(0xffe9a8), 0.45);
    } else if (destinos.includes(id)) {
      color.lerp(new THREE.Color(0x7fd67f), 0.38);
    }
    if (id === resaltado) color.offsetHSL(0, 0, 0.09);
    pieza.material.color.copy(color);
  }

  return {
    raiz,
    superficies,

    sincronizar(duenoDe): void {
      for (const pieza of piezas.values()) {
        const dueno = duenoDe(pieza.territorio.id);
        // Una pizca de variación por territorio: dos provincias del mismo bando
        // no deben ser exactamente del mismo tono o el mapa parece un tablero.
        // Ojo con la escala: en `variarColor` el factor es cuánto se acerca el
        // color al blanco (1 lo blanquea del todo), no un multiplicador. Aquí
        // basta un empujón de ±6 % para que se note sin despintar el bando.
        const semillaTono = (pieza.territorio.x * 7 + pieza.territorio.y * 13) % 100;
        const variacion = (semillaTono / 100 - 0.5) * 0.12;
        pieza.colorBase.setHex(variarColor(COLOR_BANDO[dueno], variacion));
        repintar(pieza);
      }
    },

    fijarResaltado(id): void {
      if (resaltado === id) return;
      const anterior = resaltado;
      resaltado = id;
      if (anterior) {
        const pieza = piezas.get(anterior);
        if (pieza) repintar(pieza);
      }
      if (id) {
        const pieza = piezas.get(id);
        if (pieza) repintar(pieza);
      }
    },

    fijarDestinos(ids): void {
      const antes = destinos;
      destinos = [...ids];
      // Solo se repintan los que entran o salen del conjunto.
      for (const id of new Set([...antes, ...destinos])) {
        const pieza = piezas.get(id);
        if (pieza) repintar(pieza);
      }
    },

    fijarSeleccionado(id): void {
      if (seleccionado === id) return;
      const anterior = seleccionado;
      seleccionado = id;
      for (const candidato of [anterior, id]) {
        if (!candidato) continue;
        const pieza = piezas.get(candidato);
        if (pieza) repintar(pieza);
      }
    },

    territorioDe(objeto): IdTerritorio | null {
      let actual: THREE.Object3D | null = objeto;
      while (actual) {
        const id = porObjeto.get(actual);
        if (id) return id;
        actual = actual.parent;
      }
      return null;
    },

    posicionDe(id): THREE.Vector3 {
      const pieza = piezas.get(id);
      if (!pieza) return new THREE.Vector3();
      return aEscena(pieza.territorio.x, pieza.territorio.y, ALTURA_SUPERFICIE);
    },

    liberar(): void {
      for (const desechable of desechables) desechable.dispose();
      raiz.clear();
      escena.remove(raiz);
    },
  };
}

/**
 * El litoral del país, deducido de los propios territorios.
 *
 * No hay ninguna lista de costa que mantener: una frontera que solo dibuja un
 * territorio es, por definición, litoral —las interiores las dibujan los dos
 * vecinos, cada uno en un sentido—. Encadenando las que quedan sueltas sale el
 * contorno del país. Así, al retocar una provincia de la orilla, la costa se
 * mueve con ella sin que haya que acordarse de nada.
 */
function litoral(): Array<readonly [number, number]> {
  const clave = (punto: readonly [number, number]): string => `${punto[0]},${punto[1]}`;
  const dirigidas = new Set<string>();
  const puntoPorClave = new Map<string, readonly [number, number]>();
  for (const territorio of TERRITORIOS) {
    const contorno = territorio.contorno;
    for (let i = 0; i < contorno.length; i++) {
      const a = contorno[i]!;
      const b = contorno[(i + 1) % contorno.length]!;
      dirigidas.add(`${clave(a)}->${clave(b)}`);
      puntoPorClave.set(clave(a), a);
    }
  }

  const siguiente = new Map<string, string>();
  for (const arista of dirigidas) {
    const [a, b] = arista.split('->') as [string, string];
    if (dirigidas.has(`${b}->${a}`)) continue; // frontera interior
    siguiente.set(a, b);
  }

  const arranque = siguiente.keys().next().value as string;
  const cadena: Array<readonly [number, number]> = [];
  let actual = arranque;
  do {
    cadena.push(puntoPorClave.get(actual)!);
    actual = siguiente.get(actual)!;
  } while (actual !== arranque && cadena.length <= siguiente.size);
  return cadena;
}

/**
 * La banda de tinta que dibuja la costa, de `grosor` unidades hacia fuera.
 *
 * Se construye como un polígono con agujero: el contorno del país desplazado
 * hacia el mar, y el propio país recortado dentro. Cada vértice se empuja por la
 * bisectriz de sus dos aristas, que es lo que mantiene el grosor constante en
 * las esquinas en vez de estrangularlo.
 *
 * Los territorios van en sentido antihorario, así que el mar queda a la derecha
 * de cada arista de litoral: ese es el lado hacia el que se empuja.
 */
function bandaDelLitoral(grosor: number): THREE.Mesh {
  const costa = litoral();
  const fuera = costa.map((punto, indice) => {
    const previo = costa[(indice - 1 + costa.length) % costa.length]!;
    const posterior = costa[(indice + 1) % costa.length]!;
    const normal = new THREE.Vector2();
    for (const [desde, hasta] of [
      [previo, punto],
      [punto, posterior],
    ] as const) {
      // Normal a la derecha de la arista: el mar.
      const salida = new THREE.Vector2(hasta[1] - desde[1], desde[0] - hasta[0]);
      if (salida.lengthSq() > 0) normal.add(salida.normalize());
    }
    if (normal.lengthSq() === 0) normal.set(0, 1);
    normal.normalize().multiplyScalar(grosor);
    return [punto[0] + normal.x, punto[1] + normal.y] as const;
  });

  const forma = new THREE.Shape();
  fuera.forEach(([x, y], indice) => {
    const px = (x - CENTRO_X) * ESCALA;
    const py = (y - CENTRO_Y) * ESCALA;
    if (indice === 0) forma.moveTo(px, py);
    else forma.lineTo(px, py);
  });
  forma.closePath();

  const hueco = new THREE.Path();
  costa.forEach(([x, y], indice) => {
    const px = (x - CENTRO_X) * ESCALA;
    const py = (y - CENTRO_Y) * ESCALA;
    if (indice === 0) hueco.moveTo(px, py);
    else hueco.lineTo(px, py);
  });
  hueco.closePath();
  forma.holes.push(hueco);

  const geometria = new THREE.ShapeGeometry(forma);
  geometria.rotateX(-Math.PI / 2);
  const malla = new THREE.Mesh(
    geometria,
    new THREE.MeshBasicMaterial({ color: COLOR_TINTA }),
  );
  // Justo por debajo de los territorios: si empatan en altura, el z-fighting
  // hace parpadear la costa al girar la cámara.
  malla.position.y = ALTURA_SUPERFICIE - 0.01;
  return malla;
}

/**
 * Los distintivos que se leen de un vistazo: la cúpula de una capital, la
 * torre de un fuerte, el muelle de un puerto.
 *
 * Son geometría suelta y sin material propio compartido a propósito: hay como
 * mucho una docena en todo el mapa y no vale la pena instanciarlos.
 */
function anadirEmblemas(
  raiz: THREE.Group,
  territorio: Territorio,
  desechables: Array<{ dispose(): void }>,
): void {
  const base = aEscena(territorio.x, territorio.y, ALTURA_SUPERFICIE);

  if (territorio.capitalDe !== BandoCampana.NINGUNO) {
    // Cúpula sobre un tambor: la silueta de un capitolio, reducida a lo mínimo.
    const tambor = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.35, 1.5, 8),
      new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.85, flatShading: true }),
    );
    tambor.position.copy(base).add(new THREE.Vector3(0, 0.75, 0));
    tambor.castShadow = true;
    raiz.add(tambor);

    const cupula = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xd8c88a, roughness: 0.6, metalness: 0.25 }),
    );
    cupula.position.copy(base).add(new THREE.Vector3(0, 1.5, 0));
    cupula.castShadow = true;
    raiz.add(cupula);

    desechables.push(
      tambor.geometry,
      tambor.material as THREE.Material,
      cupula.geometry,
      cupula.material as THREE.Material,
    );
    return;
  }

  if (territorio.fuerte) {
    const torre = new THREE.Mesh(
      new THREE.CylinderGeometry(0.95, 1.2, 1.9, 6),
      new THREE.MeshStandardMaterial({ color: 0x8d7f6a, roughness: 0.95, flatShading: true }),
    );
    torre.position.copy(base).add(new THREE.Vector3(0, 0.95, 0));
    torre.castShadow = true;
    raiz.add(torre);
    desechables.push(torre.geometry, torre.material as THREE.Material);
  }

  if (territorio.puerto) {
    const muelle = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.42, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 1, flatShading: true }),
    );
    // Desplazado del centro para no pelearse con la ficha del ejército.
    muelle.position.copy(base).add(new THREE.Vector3(2.2, 0.2, 2.0));
    muelle.rotation.y = Math.PI / 7;
    muelle.castShadow = true;
    raiz.add(muelle);
    desechables.push(muelle.geometry, muelle.material as THREE.Material);
  }
}
