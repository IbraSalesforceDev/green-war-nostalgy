import * as THREE from 'three';
import {
  ARMAS,
  Arma,
  BandoCampana,
  type Ejercito,
  type IdTerritorio,
  totalTropas,
} from '../tipos';
import { crearFigurasDeBando } from './figuras';

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

/**
 * La peana va mucho más oscura que el territorio que pisa, no del color del bando.
 *
 * Parece contraintuitivo, pero teñirla del color del bando la hacía desaparecer:
 * una peana azul sobre una provincia azul no se ve, y era justo la pieza que debe
 * decir «aquí hay un ejército». El bando ya lo cantan los uniformes de las
 * figurillas; la peana solo tiene que separarlas del suelo.
 */
const COLOR_PEANA: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0x2a2a26,
  [BandoCampana.UNION]: 0x17203a,
  [BandoCampana.CONFEDERACION]: 0x322d22,
};

/**
 * Aro vivo en el borde de la peana. La peana oscura separa la ficha del suelo,
 * pero por sí sola no dice de quién es —y en sombra se confunde con la propia
 * sombra—. El aro resuelve las dos cosas de un golpe, y de paso hace que el
 * conjunto se lea como la ficha de un juego de mesa.
 */
const COLOR_ARO: Readonly<Record<BandoCampana, number>> = {
  [BandoCampana.NINGUNO]: 0xa8a89c,
  [BandoCampana.UNION]: 0x5b8ae0,
  [BandoCampana.CONFEDERACION]: 0xc9bb92,
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
  aro: THREE.Mesh;
  materialAro: THREE.MeshStandardMaterial;
  /** Una figurilla por arma; se enseñan solo las que el ejército tenga. */
  figuras: THREE.Mesh[];
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
  const geoPeana = new THREE.CylinderGeometry(3.45, 3.75, 0.42, 16);
  // Aro plano justo sobre el canto de la peana. Va sin sombras: es una marca de
  // identificación, no un objeto, y proyectarla solo ensuciaría el suelo.
  const geoAro = new THREE.RingGeometry(3.0, 3.55, 20);
  geoAro.rotateX(-Math.PI / 2);
  desechables.push(geoPeana, geoAro);

  // Un juego de figuras por bando: el color del uniforme va horneado en los
  // vértices, así que no puede compartirse entre azules y grises.
  const geoPorBando = new Map<BandoCampana, Readonly<Record<Arma, THREE.BufferGeometry>>>();
  for (const bando of [BandoCampana.UNION, BandoCampana.CONFEDERACION, BandoCampana.NINGUNO]) {
    const juego = crearFigurasDeBando(bando);
    geoPorBando.set(bando, juego);
    for (const arma of ARMAS) desechables.push(juego[arma]);
  }

  // Un solo material para todas las figurillas de todas las fichas: el color ya
  // viaja en los vértices, así que no hace falta uno por arma ni por bando.
  const materialFiguras = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
  });
  desechables.push(materialFiguras);

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

    const materialAro = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.6,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const aro = new THREE.Mesh(geoAro, materialAro);
    aro.position.y = 0.24;
    grupo.add(aro);
    desechables.push(materialAro);

    const figuras: THREE.Mesh[] = [];
    for (const arma of ARMAS) {
      // La geometría definitiva se asigna al sincronizar, cuando se sabe de qué
      // bando es el ejército; aquí solo hace falta una para poder crear la malla.
      const figura = new THREE.Mesh(geoPorBando.get(BandoCampana.UNION)![arma], materialFiguras);
      figura.castShadow = true;
      // En fila, de izquierda a derecha, en el mismo orden que las armas.
      figura.position.set((arma - 1) * 1.9, 0.2, 0);
      figura.visible = false;
      grupo.add(figura);
      figuras.push(figura);
    }

    raiz.add(grupo);
    const ficha: Ficha = {
      raiz: grupo,
      peana,
      materialPeana,
      aro,
      materialAro,
      figuras,
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
        ficha.materialAro.color.setHex(COLOR_ARO[ejercito.bando]);
        const juego = geoPorBando.get(ejercito.bando) ?? geoPorBando.get(BandoCampana.NINGUNO)!;

        // El tamaño de la peana crece con las tropas, pero muy poco a poco: un
        // ejército de treinta no puede tapar medio mapa.
        const escala = 0.8 + Math.min(1, tropas / 24) * 0.42;
        ficha.peana.scale.setScalar(escala);
        ficha.aro.scale.set(escala, 1, escala);
        ficha.aro.position.y = 0.24 * escala;

        // Las armas presentes se reparten centradas: con una sola no debe quedar
        // descolgada a un lado de la peana.
        const presentes = ARMAS.filter((arma) => ejercito.composicion[arma] > 0);
        presentes.forEach((arma, indice) => {
          const figura = ficha.figuras[arma]!;
          figura.visible = true;
          figura.geometry = juego[arma];
          const desplazamiento = (indice - (presentes.length - 1) / 2) * 1.95;
          // Cada figurilla crece un poco con los suyos, sin llegar a deformarse.
          const cuantos = ejercito.composicion[arma];
          const bulto = 1.05 + Math.min(1, cuantos / 12) * 0.32;
          figura.scale.setScalar(bulto);
          figura.position.set(desplazamiento, 0.2, 0);
        });
        for (const arma of ARMAS) {
          if (ejercito.composicion[arma] === 0) ficha.figuras[arma]!.visible = false;
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
