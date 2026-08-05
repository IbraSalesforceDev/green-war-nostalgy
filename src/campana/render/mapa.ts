import * as THREE from 'three';
import { variarColor } from '../../render/modelos/materiales';
import { TERRITORIOS, type Territorio } from '../territorios';
import { BandoCampana, type IdTerritorio } from '../tipos';

/**
 * El mapa de campaña dibujado en tres dimensiones.
 *
 * Cada territorio es su polígono extruido, con el color de quien lo controla y un
 * reborde oscuro. El aire de cómic no sale de ningún filtro caro: sale de colores
 * planos, siluetas gruesas y una altura ligera que separa la tierra del mar.
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

/** Grosor de la tierra. Suficiente para que se vea el canto contra el mar. */
const ALTURA_TIERRA = 1.6;

/** Colores base de cada bando, en tono cómic: planos y saturados sin chillar. */
const COLOR_BANDO: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0x9a9a92,
  [BandoCampana.UNION]: 0x4a6fae,
  [BandoCampana.CONFEDERACION]: 0x9a8f7a,
};

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
  return new THREE.Vector3((x - 50) * ESCALA, alto, -(y - 50) * ESCALA);
}

interface PiezaTerritorio {
  territorio: Territorio;
  malla: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
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
      const px = (x - 50) * ESCALA;
      const py = (y - 50) * ESCALA;
      if (indice === 0) forma.moveTo(px, py);
      else forma.lineTo(px, py);
    });
    forma.closePath();

    const geometria = new THREE.ExtrudeGeometry(forma, {
      depth: ALTURA_TIERRA,
      bevelEnabled: true,
      bevelThickness: 0.25,
      bevelSize: 0.35,
      bevelSegments: 1,
    });
    // La forma se dibuja en XY y se extruye hacia +Z; esta rotación la tumba al
    // plano del suelo y convierte la extrusión en altura.
    geometria.rotateX(-Math.PI / 2);
    desechables.push(geometria);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.92,
      metalness: 0,
      flatShading: true,
    });
    desechables.push(material);

    const malla = new THREE.Mesh(geometria, material);
    malla.receiveShadow = true;
    malla.castShadow = false;
    malla.userData.territorio = territorio.id;
    raiz.add(malla);

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

  // El mar: un plano bajo la tierra que asoma por los huecos entre territorios y
  // les da el reborde de costa sin tener que dibujar ninguna línea.
  const mar = new THREE.Mesh(
    new THREE.PlaneGeometry(260, 260),
    new THREE.MeshStandardMaterial({ color: 0x2c4a63, roughness: 1, metalness: 0 }),
  );
  mar.rotation.x = -Math.PI / 2;
  mar.position.y = -0.35;
  mar.receiveShadow = true;
  raiz.add(mar);
  desechables.push(mar.geometry, mar.material as THREE.Material);

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
      return aEscena(pieza.territorio.x, pieza.territorio.y, ALTURA_TIERRA);
    },

    liberar(): void {
      for (const desechable of desechables) desechable.dispose();
      raiz.clear();
      escena.remove(raiz);
    },
  };
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
  const base = aEscena(territorio.x, territorio.y, ALTURA_TIERRA);

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
