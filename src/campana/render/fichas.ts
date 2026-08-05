import * as THREE from 'three';
import {
  ARMAS,
  Arma,
  BandoCampana,
  type Ejercito,
  type IdTerritorio,
  totalTropas,
} from '../tipos';

/**
 * Las fichas de ejército: quién hay en cada territorio y de qué está hecho.
 *
 * Cada ejército se representa con hasta tres figurillas —un fusil, un jinete y un
 * cañón— sobre una peana del color de su bando. No son un recuento fiel: son un
 * vistazo. Lo que se debe leer sin pensar es «aquí hay caballería» y «este de aquí
 * es más grande que aquel», no cuántos hombres exactos lleva; para eso está el
 * panel de detalle.
 *
 * ── Por qué se reciclan las fichas ───────────────────────────────────────────
 * Los ejércitos aparecen, se funden y mueren en cada turno. Crear y destruir sus
 * mallas al ritmo de esos cambios llenaría la memoria de basura y obligaría a
 * recompilar materiales a mitad de partida. En vez de eso hay una reserva de
 * fichas que se apagan y se vuelven a encender según hagan falta, igual que los
 * anillos de selección del campo de batalla.
 */

/** Tope de fichas simultáneas. Con dieciocho territorios nunca se llega ni de lejos. */
const MAX_FICHAS = 24;

/** Altura a la que flota la peana sobre la tierra. */
const ALTURA_PEANA = 0.05;

const COLOR_PEANA: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0x8a8a82,
  [BandoCampana.UNION]: 0x2f4f9e,
  [BandoCampana.CONFEDERACION]: 0x6e6a5c,
};

/** Tono del uniforme: azul de la Unión, gris pardo del Sur. */
const COLOR_TROPA: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0x9a9a92,
  [BandoCampana.UNION]: 0x3d5fa8,
  [BandoCampana.CONFEDERACION]: 0x8b8672,
};

export interface FichasEjercitos {
  readonly raiz: THREE.Group;
  /**
   * Coloca una ficha por ejército vivo y apaga las sobrantes. `posicionDe`
   * traduce el territorio de cada ejército a un punto de la escena: la ficha no
   * conoce la geografía, igual que el mapa no conoce los ejércitos.
   */
  sincronizar(
    ejercitos: readonly Ejercito[],
    posicionDe: (id: IdTerritorio) => THREE.Vector3,
  ): void;
  /** Marca visualmente el ejército elegido. */
  fijarSeleccionado(id: number | null): void;
  /** Balanceo suave para que el mapa no parezca congelado. */
  actualizar(dt: number): void;
  /** Mallas contra las que lanzar el rayo del puntero. */
  readonly superficies: readonly THREE.Object3D[];
  /** Qué ejército es un objeto devuelto por el rayo. */
  ejercitoDe(objeto: THREE.Object3D): number | null;
  liberar(): void;
}

interface Ficha {
  raiz: THREE.Group;
  peana: THREE.Mesh;
  materialPeana: THREE.MeshStandardMaterial;
  /** Una figurilla por arma; se enseñan solo las que el ejército tenga. */
  figuras: THREE.Mesh[];
  materialesFigura: THREE.MeshStandardMaterial[];
  idEjercito: number;
  /** Altura del suelo bajo la ficha; el balanceo se suma a esto cada fotograma. */
  alturaBase: number;
  /** Desfase del balanceo, para que no oscilen todas a la vez. */
  desfase: number;
}

export function crearFichasEjercitos(escena: THREE.Scene): FichasEjercitos {
  const raiz = new THREE.Group();
  raiz.name = 'fichas-ejercitos';
  escena.add(raiz);

  const desechables: Array<{ dispose(): void }> = [];

  // Geometrías compartidas por todas las fichas: se crean una vez y se reutilizan.
  // Las fichas se dimensionan para el dedo, no para el ojo: en un mapa que cabe
  // entero en la pantalla de un móvil, una ficha «a escala» sería intocable.
  const geoPeana = new THREE.CylinderGeometry(3.3, 3.6, 0.4, 14);
  const geoFigura: Readonly<Record<Arma, THREE.BufferGeometry>> = {
    // El fusilero: un cuerpo esbelto y un chacó. Basta la silueta.
    [Arma.INFANTERIA]: new THREE.CapsuleGeometry(0.62, 1.6, 3, 6),
    // El jinete: más ancho y más bajo, la grupa del caballo.
    [Arma.CABALLERIA]: new THREE.CapsuleGeometry(0.78, 2.0, 3, 6),
    // El cañón: una cuña, que a esta escala se lee mejor que un tubo.
    [Arma.ARTILLERIA]: new THREE.CylinderGeometry(0.28, 0.95, 2.2, 6),
  };
  desechables.push(geoPeana, ...Object.values(geoFigura));

  const fichas: Ficha[] = [];
  const porObjeto = new Map<THREE.Object3D, number>();
  const superficies: THREE.Object3D[] = [];

  for (let i = 0; i < MAX_FICHAS; i++) {
    const grupo = new THREE.Group();
    grupo.visible = false;

    const materialPeana = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.75,
      metalness: 0.1,
      flatShading: true,
    });
    const peana = new THREE.Mesh(geoPeana, materialPeana);
    peana.castShadow = true;
    peana.receiveShadow = true;
    grupo.add(peana);
    desechables.push(materialPeana);

    const figuras: THREE.Mesh[] = [];
    const materialesFigura: THREE.MeshStandardMaterial[] = [];
    for (const arma of ARMAS) {
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.85,
        metalness: arma === Arma.ARTILLERIA ? 0.45 : 0.05,
        flatShading: true,
      });
      const figura = new THREE.Mesh(geoFigura[arma], material);
      figura.castShadow = true;
      // En fila, de izquierda a derecha, en el mismo orden que las armas.
      figura.position.set((arma - 1) * 1.85, 1.4, 0);
      figura.visible = false;
      grupo.add(figura);
      figuras.push(figura);
      materialesFigura.push(material);
      desechables.push(material);
    }

    raiz.add(grupo);
    const ficha: Ficha = {
      raiz: grupo,
      peana,
      materialPeana,
      figuras,
      materialesFigura,
      idEjercito: 0,
      alturaBase: 0,
      desfase: i * 0.7,
    };
    fichas.push(ficha);
    porObjeto.set(grupo, i);
    superficies.push(grupo);
  }

  let seleccionado: number | null = null;
  let reloj = 0;

  return {
    raiz,
    superficies,

    sincronizar(ejercitos, posicionDe): void {
      let usadas = 0;
      for (const ejercito of ejercitos) {
        if (usadas >= MAX_FICHAS) break;
        const tropas = totalTropas(ejercito.composicion);
        if (tropas === 0) continue;

        const ficha = fichas[usadas++]!;
        ficha.idEjercito = ejercito.id;
        ficha.raiz.visible = true;

        const posicion = posicionDe(ejercito.territorio);
        // La altura base se guarda aparte porque el balanceo de cada fotograma la
        // sobrescribe: sin ella, las fichas irían hundiéndose en el suelo.
        ficha.alturaBase = posicion.y + ALTURA_PEANA;
        ficha.raiz.position.set(posicion.x, ficha.alturaBase, posicion.z);

        ficha.materialPeana.color.setHex(COLOR_PEANA[ejercito.bando]);
        const colorTropa = COLOR_TROPA[ejercito.bando];

        // El tamaño de la peana crece con las tropas, pero muy poco a poco: un
        // ejército de treinta no puede tapar medio mapa.
        const escala = 0.75 + Math.min(1, tropas / 24) * 0.5;
        ficha.peana.scale.setScalar(escala);

        for (const arma of ARMAS) {
          const cuantos = ejercito.composicion[arma];
          const figura = ficha.figuras[arma]!;
          figura.visible = cuantos > 0;
          if (cuantos === 0) continue;
          ficha.materialesFigura[arma]!.color.setHex(colorTropa);
          // Cada figurilla también crece un poco con los suyos.
          const alto = 0.85 + Math.min(1, cuantos / 12) * 0.5;
          figura.scale.set(1, alto, 1);
          figura.position.y = 0.75 + alto * 0.8;
        }
      }

      for (let i = usadas; i < MAX_FICHAS; i++) {
        fichas[i]!.raiz.visible = false;
        fichas[i]!.idEjercito = 0;
      }
    },

    fijarSeleccionado(id): void {
      seleccionado = id;
    },

    actualizar(dt): void {
      reloj += dt;
      for (const ficha of fichas) {
        if (!ficha.raiz.visible) continue;
        const elegida = seleccionado !== null && ficha.idEjercito === seleccionado;
        // La ficha elegida flota y gira despacio; el resto solo respira.
        const bote = elegida
          ? 0.35 + Math.sin(reloj * 3 + ficha.desfase) * 0.18
          : Math.sin(reloj * 1.4 + ficha.desfase) * 0.05;
        ficha.raiz.position.y = ficha.alturaBase + bote;
        ficha.raiz.rotation.y = elegida ? reloj * 0.8 : 0;
      }
    },

    ejercitoDe(objeto): number | null {
      let actual: THREE.Object3D | null = objeto;
      while (actual) {
        const indice = porObjeto.get(actual);
        if (indice !== undefined) {
          const ficha = fichas[indice]!;
          return ficha.raiz.visible ? ficha.idEjercito : null;
        }
        actual = actual.parent;
      }
      return null;
    },

    liberar(): void {
      for (const desechable of desechables) desechable.dispose();
      raiz.clear();
      escena.remove(raiz);
    },
  };
}
