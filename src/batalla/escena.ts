import * as THREE from 'three';
import { crearFigurasDeBando } from '../campana/render/figuras';
import { ARMAS, Arma, BandoCampana, type Composicion, NOMBRE_ARMA } from '../campana/tipos';
import { elementoIcono } from '../ui/iconos';
import { IABatalla } from './ia';
import {
  ANCHO_CAMPO,
  Batalla,
  type DesenlaceBatalla,
  EstadoUnidad,
  FONDO_CAMPO,
  Postura,
  type UnidadBatalla,
} from './batalla';

/**
 * La escena de la batalla campal: el campo, las tropas y el mando.
 *
 * Reutiliza las mismas figurillas que las fichas del mapa —el fusilero con el
 * arma terciada, el jinete y el cañón—, y por un motivo que no es de ahorro:
 * quien acaba de mover una ficha con esas tres siluetas tiene que reconocer al
 * instante lo que ve cuando la ficha se convierte en un ejército de verdad.
 *
 * ── El mando ─────────────────────────────────────────────────────────────────
 * Tres botones, uno por arma, y tres órdenes: avanzar, aguantar o retirarse. Más
 * la carga de caballería, que va aparte porque es un momento y no un estado.
 *
 * La versión anterior dejaba señalar puntos del campo, y se sentía automática con
 * razón: las tropas ya iban solas hacia el enemigo, así que la orden casi nunca
 * cambiaba nada. Se mandaba sin que mandar sirviese. Decidir el ritmo de cada
 * arma —adelantar la infantería mientras los cañones baten desde atrás, aguantar
 * hasta que el enemigo se meta a tiro, lanzar la carga en el momento justo— sí
 * decide la batalla, y además se hace con el pulgar sin apuntar a nada.
 */

/** Alto del suelo. Las unidades andan sobre él. */
const ALTURA_SUELO = 0;

/**
 * Las figuras se agrandan respecto a su tamaño «real» en el campo.
 *
 * A escala honesta, un soldado de tres unidades sobre un frente de ochenta y
 * cuatro ocupa cuarenta píxeles y la batalla se ve como hormigas. Aquí el
 * protagonista es la tropa, no la topografía: se exagera el tamaño igual que lo
 * hacen los juegos de este género desde siempre.
 */
const ESCALA_FIGURA = 1.7;

const COLOR_SELECCION = 0xffe9a8;

const ICONO_ARMA: Readonly<Record<Arma, Parameters<typeof elementoIcono>[0]>> = {
  [Arma.INFANTERIA]: 'casco',
  [Arma.CABALLERIA]: 'jinete',
  [Arma.ARTILLERIA]: 'catapulta',
};

export interface EscenaBatalla {
  readonly escena: THREE.Scene;
  readonly camara: THREE.PerspectiveCamera;
  readonly batalla: Batalla;
  actualizar(dt: number): void;
  redimensionar(ancho: number, alto: number): void;
  /** La batalla ha terminado y su resultado está listo para la campaña. */
  readonly terminada: boolean;
  desenlace(): DesenlaceBatalla;
  liberar(): void;
}

export interface OpcionesEscenaBatalla {
  /** Dónde colgar el marcador y el panel de mando. */
  capaInterfaz: HTMLElement;
  relacionAspecto: number;
  atacante: BandoCampana;
  composicionAtacante: Composicion;
  composicionDefensor: Composicion;
  bandoJugador: BandoCampana;
  enFuerte?: boolean;
  semilla?: number;
  conSombras?: boolean;
}

interface VistaUnidad {
  malla: THREE.Mesh;
  anillo: THREE.Mesh;
  unidad: UnidadBatalla;
}

export function crearEscenaBatalla(opciones: OpcionesEscenaBatalla): EscenaBatalla {
  const batalla = new Batalla({
    atacante: opciones.atacante,
    composicionAtacante: opciones.composicionAtacante,
    composicionDefensor: opciones.composicionDefensor,
    bandoJugador: opciones.bandoJugador,
    enFuerte: opciones.enFuerte ?? false,
    semilla: opciones.semilla,
  });

  // El mando de la máquina. Usa los mismos verbos que los botones de abajo: no
  // hay nada que pueda hacer el enemigo que no puedas hacer tú.
  const mandoEnemigo = new IABatalla(
    batalla,
    opciones.bandoJugador === opciones.atacante ? batalla.defensor : batalla.atacante,
  );

  const escena = new THREE.Scene();
  escena.background = new THREE.Color(0x8fa9c4);
  escena.fog = new THREE.Fog(0x8fa9c4, 90, 190);

  const sol = new THREE.DirectionalLight(0xfff2d8, 1.5);
  sol.position.set(-40, 60, 30);
  if (opciones.conSombras !== false) {
    sol.castShadow = true;
    sol.shadow.mapSize.set(1024, 1024);
    const c = sol.shadow.camera;
    c.left = -60;
    c.right = 60;
    c.top = 40;
    c.bottom = -40;
    c.near = 5;
    c.far = 160;
  }
  escena.add(sol);
  escena.add(new THREE.HemisphereLight(0xcfe0f0, 0x4a4028, 0.7));

  const desechables: Array<{ dispose(): void }> = [];

  // --- El campo ---
  // Muy holgado a propósito: la cámara se aleja para encuadrar a los dos
  // ejércitos, y con un suelo ajustado al campo se veía el canto del plano
  // recortado contra el cielo.
  const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(ANCHO_CAMPO * 4, FONDO_CAMPO * 6, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1, metalness: 0 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  suelo.receiveShadow = true;
  escena.add(suelo);
  desechables.push(suelo.geometry, suelo.material as THREE.Material);

  // Franjas de labranza: dan escala y hacen visible el avance de las tropas, que
  // sobre un verde liso parecería que patinan sin moverse.
  const franjas = new THREE.Group();
  for (let i = -10; i <= 10; i++) {
    const franja = new THREE.Mesh(
      new THREE.PlaneGeometry(ANCHO_CAMPO * 3, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x64823f, roughness: 1 }),
    );
    franja.rotation.x = -Math.PI / 2;
    franja.position.set(0, 0.02, i * 6.5);
    escena.add(franja);
    desechables.push(franja.geometry, franja.material as THREE.Material);
  }
  escena.add(franjas);

  // Empalizada del defensor cuando la batalla es un asalto a posición fortificada.
  if (batalla.enFuerte) {
    const muro = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 3.2, FONDO_CAMPO - 4),
      new THREE.MeshStandardMaterial({ color: 0x6b5136, roughness: 0.95, flatShading: true }),
    );
    muro.position.set(ANCHO_CAMPO / 2 - 20, 1.6, 0);
    muro.castShadow = true;
    muro.receiveShadow = true;
    escena.add(muro);
    desechables.push(muro.geometry, muro.material as THREE.Material);
  }

  // --- Figuras, una malla por unidad ---
  const geoPorBando = new Map<BandoCampana, Readonly<Record<Arma, THREE.BufferGeometry>>>();
  for (const bando of [BandoCampana.UNION, BandoCampana.CONFEDERACION]) {
    const juego = crearFigurasDeBando(bando);
    geoPorBando.set(bando, juego);
    for (const arma of ARMAS) desechables.push(juego[arma]);
  }

  const materialFiguras = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.82,
    metalness: 0.08,
    flatShading: true,
  });
  const materialAnillo = new THREE.MeshBasicMaterial({
    color: COLOR_SELECCION,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const geoAnillo = new THREE.RingGeometry(2.0, 2.6, 16);
  geoAnillo.rotateX(-Math.PI / 2);
  desechables.push(materialFiguras, materialAnillo, geoAnillo);

  const vistas: VistaUnidad[] = [];
  for (const unidad of batalla.unidades) {
    const juego = geoPorBando.get(unidad.bando)!;
    const malla = new THREE.Mesh(juego[unidad.arma], materialFiguras);
    malla.castShadow = true;
    malla.scale.setScalar(ESCALA_FIGURA);
    // Las figuras se modelaron mirando al este; el ángulo de la simulación se
    // aplica en negativo porque el eje Z de la escena crece hacia el sur.
    malla.position.set(unidad.x, ALTURA_SUELO, unidad.z);
    escena.add(malla);

    const anillo = new THREE.Mesh(geoAnillo, materialAnillo);
    anillo.position.set(unidad.x, ALTURA_SUELO + 0.05, unidad.z);
    anillo.visible = false;
    escena.add(anillo);

    vistas.push({ malla, anillo, unidad });
  }

  // --- Fogonazos de los disparos ---
  const MAX_FOGONAZOS = 40;
  const geoFogonazo = new THREE.SphereGeometry(0.42, 6, 4);
  const materialFogonazo = new THREE.MeshBasicMaterial({
    color: 0xffd88a,
    transparent: true,
    opacity: 1,
  });
  desechables.push(geoFogonazo, materialFogonazo);
  const fogonazos: Array<{ malla: THREE.Mesh; vida: number }> = [];
  for (let i = 0; i < MAX_FOGONAZOS; i++) {
    const malla = new THREE.Mesh(geoFogonazo, materialFogonazo);
    malla.visible = false;
    escena.add(malla);
    fogonazos.push({ malla, vida: 0 });
  }
  let cursorFogonazo = 0;

  // --- Cámara ---
  const camara = new THREE.PerspectiveCamera(42, opciones.relacionAspecto, 0.5, 400);
  let distancia = 52;
  let objetivoX = 0;
  /**
   * Casi de perfil.
   *
   * Es el cambio que arregla la lectura de la batalla: en cenital las tropas se
   * tapaban unas a otras en profundidad y no se distinguía quién pegaba a quién.
   * De lado todo cae en un plano —se ve la línea, el hueco, la carga que entra— y
   * además las figuras se modelaron de perfil, que es su mejor ángulo. Los quince
   * grados que quedan son los que separan un dibujo plano de una escena con
   * volumen: lo justo para que se note el suelo bajo los pies.
   *
   * Con 0,26 la cámara miraba tan a ras que media pantalla era cielo vacío; 0,40
   * sigue leyéndose de perfil y llena el encuadre de campo, que es donde pasa
   * todo.
   */
  const INCLINACION = 0.4;

  function recolocarCamara(): void {
    camara.position.set(
      objetivoX,
      Math.sin(INCLINACION) * distancia,
      Math.cos(INCLINACION) * distancia,
    );
    camara.lookAt(objetivoX, 2.5, 0);
  }
  recolocarCamara();

  // --- Mando: un arma cada vez, con botones ---
  //
  // Señalar puntos del campo no mandaba nada: las tropas ya iban solas hacia el
  // enemigo, así que la orden apenas cambiaba el resultado. Decidir si un arma
  // avanza, aguanta o se retira sí decide la batalla, y además se hace con el
  // pulgar sin apuntar a nada.
  let armaElegida: Arma = Arma.INFANTERIA;

  // --- Marcador ---
  const hud = document.createElement('div');
  hud.className = 'gwn-hud gwn-batalla-hud';
  const marcador = document.createElement('div');
  marcador.className = 'gwn-panel gwn-batalla-marcador';
  hud.appendChild(marcador);

  const lado = (clase: string): HTMLElement => {
    const el = document.createElement('div');
    el.className = `gwn-batalla-lado ${clase}`;
    marcador.appendChild(el);
    return el;
  };
  const marcaPropia = lado('gwn-batalla-lado--propio');
  const separadorMarcador = document.createElement('div');
  separadorMarcador.className = 'gwn-batalla-separador';
  separadorMarcador.textContent = batalla.enFuerte ? 'ASALTO' : 'BATALLA';
  marcador.appendChild(separadorMarcador);
  const marcaAjena = lado('gwn-batalla-lado--ajeno');

  // --- Panel de mando ---
  const mando = document.createElement('div');
  mando.className = 'gwn-batalla-mando';

  const fichasArma = new Map<Arma, HTMLButtonElement>();
  const filaArmas = document.createElement('div');
  filaArmas.className = 'gwn-batalla-armas';
  for (const arma of ARMAS) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'gwn-batalla-arma';
    boton.appendChild(elementoIcono(ICONO_ARMA[arma]));
    const cuenta = document.createElement('span');
    cuenta.className = 'gwn-batalla-arma-cuenta';
    boton.appendChild(cuenta);
    boton.setAttribute('aria-label', NOMBRE_ARMA[arma]);
    boton.addEventListener('click', () => {
      armaElegida = arma;
      refrescarMando();
    });
    filaArmas.appendChild(boton);
    fichasArma.set(arma, boton);
  }
  mando.appendChild(filaArmas);

  const filaOrdenes = document.createElement('div');
  filaOrdenes.className = 'gwn-batalla-ordenes';
  const botonesPostura = new Map<Postura, HTMLButtonElement>();
  const ORDENES: Array<[Postura, string, Parameters<typeof elementoIcono>[0]]> = [
    [Postura.RETIRAR, 'Atrás', 'volver'],
    [Postura.MANTENER, 'Alto', 'mantener'],
    [Postura.AVANZAR, 'Avanzar', 'espadas'],
  ];
  for (const [postura, texto, icono] of ORDENES) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'gwn-batalla-orden';
    boton.appendChild(elementoIcono(icono));
    const etiqueta = document.createElement('span');
    etiqueta.textContent = texto;
    boton.appendChild(etiqueta);
    boton.addEventListener('click', () => {
      batalla.fijarPostura(armaElegida, postura);
      refrescarMando();
    });
    filaOrdenes.appendChild(boton);
    botonesPostura.set(postura, boton);
  }

  // La carga es un momento, no un estado: va aparte y con su propio aspecto.
  const botonCarga = document.createElement('button');
  botonCarga.type = 'button';
  botonCarga.className = 'gwn-batalla-carga';
  botonCarga.appendChild(elementoIcono('jinete'));
  const textoCarga = document.createElement('span');
  textoCarga.textContent = '¡Carga!';
  botonCarga.appendChild(textoCarga);
  botonCarga.addEventListener('click', () => {
    batalla.lanzarCarga();
    refrescarMando();
  });
  filaOrdenes.appendChild(botonCarga);
  mando.appendChild(filaOrdenes);
  hud.appendChild(mando);

  function refrescarMando(): void {
    for (const arma of ARMAS) {
      const boton = fichasArma.get(arma)!;
      const cuantas = batalla.vivasDe(opciones.bandoJugador).filter((u) => u.arma === arma).length;
      boton.classList.toggle('gwn-batalla-arma--elegida', arma === armaElegida);
      boton.disabled = cuantas === 0;
      (boton.lastElementChild as HTMLElement).textContent = String(cuantas);
    }
    const actual = batalla.posturaDe(opciones.bandoJugador, armaElegida);
    for (const [postura, boton] of botonesPostura) {
      boton.classList.toggle('gwn-batalla-orden--activa', postura === actual);
    }
    const cargando = batalla.cargaDe(opciones.bandoJugador) > 0;
    const hayJinetes = batalla
      .vivasDe(opciones.bandoJugador)
      .some((u) => u.arma === Arma.CABALLERIA);
    botonCarga.disabled = cargando || !hayJinetes;
    botonCarga.classList.toggle('gwn-batalla-carga--en-marcha', cargando);
  }

  const pista = document.createElement('div');
  pista.className = 'gwn-batalla-pista';
  pista.textContent = 'Elige un arma y dile si avanza, aguanta o se retira';
  hud.appendChild(pista);
  opciones.capaInterfaz.appendChild(hud);

  // La pista estorba en cuanto se entiende: se retira sola.
  setTimeout(() => pista.classList.add('gwn-batalla-pista--ida'), 6000);

  const rival = opciones.bandoJugador === BandoCampana.UNION
    ? BandoCampana.CONFEDERACION
    : BandoCampana.UNION;

  function refrescarMarcador(): void {
    marcaPropia.textContent = String(batalla.vivasDe(opciones.bandoJugador).length);
    marcaAjena.textContent = String(batalla.vivasDe(rival).length);
  }
  refrescarMarcador();
  refrescarMando();

  return {
    escena,
    camara,
    batalla,

    get terminada(): boolean {
      return batalla.terminada;
    },

    desenlace: () => batalla.desenlace(),

    actualizar(dt: number): void {
      // Primero decide el enemigo, luego se simula: así sus órdenes rigen este
      // paso y no el siguiente, igual que las tuyas.
      mandoEnemigo.actualizar(dt);
      batalla.paso(dt);
      refrescarMarcador();
      refrescarMando();

      // Un fogonazo por disparo de este tick.
      for (const disparo of batalla.disparos) {
        const f = fogonazos[cursorFogonazo]!;
        cursorFogonazo = (cursorFogonazo + 1) % MAX_FOGONAZOS;
        f.malla.position.set(disparo.origenX, 1.4, disparo.origenZ);
        f.malla.scale.setScalar(disparo.arma === Arma.ARTILLERIA ? 1.8 : 1);
        f.malla.visible = true;
        f.vida = 0.12;
      }
      for (const f of fogonazos) {
        if (!f.malla.visible) continue;
        f.vida -= dt;
        if (f.vida <= 0) f.malla.visible = false;
      }

      // Las figuras siguen a sus unidades.
      for (const vista of vistas) {
        const u = vista.unidad;
        if (u.estado === EstadoUnidad.MUERTA) {
          vista.malla.visible = false;
          vista.anillo.visible = false;
          continue;
        }
        vista.malla.position.set(u.x, ALTURA_SUELO, u.z);
        // El ángulo va negado: la simulación mide en el plano XZ con Z hacia el
        // sur, y la rotación de Three gira en sentido contrario sobre ese plano.
        vista.malla.rotation.y = -u.angulo;

        if (u.estado === EstadoUnidad.MURIENDO) {
          // Se desploma de costado mientras dura la agonía.
          const caida = 1 - Math.max(0, u.agonia / 0.9);
          vista.malla.rotation.z = caida * (Math.PI / 2);
          vista.malla.position.y = ALTURA_SUELO - caida * 0.2;
          vista.anillo.visible = false;
          continue;
        }

        // Se marcan las tropas del arma que se está mandando ahora mismo, para
        // que se vea a quién van a afectar los botones antes de pulsarlos.
        const marcada = u.bando === opciones.bandoJugador && u.arma === armaElegida;
        vista.anillo.visible = marcada;
        if (marcada) vista.anillo.position.set(u.x, ALTURA_SUELO + 0.05, u.z);
      }

      // La cámara sigue al grueso del combate para que la acción no se salga.
      const enPie = batalla.unidades.filter(
        (u) => u.estado === EstadoUnidad.AVANZANDO || u.estado === EstadoUnidad.COMBATIENDO,
      );
      if (enPie.length > 0) {
        // La cámara encuadra a los dos ejércitos enteros, no solo el punto de
        // contacto: si se pega al frente, la mitad de la tropa queda fuera de
        // pantalla justo cuando hay que decidir qué hacer con ella.
        const izquierda = Math.min(...enPie.map((u) => u.x));
        const derecha = Math.max(...enPie.map((u) => u.x));
        const centro = (izquierda + derecha) / 2;
        objetivoX += (centro - objetivoX) * Math.min(1, dt * 1.5);

        // Y se aleja lo justo para que quepan, entre un mínimo que evita el
        // plano lejanísimo del principio y un máximo que no deja verlas.
        const anchoVisible = 2 * Math.tan((camara.fov * Math.PI) / 360) * camara.aspect;
        const deseada = limitar(((derecha - izquierda) * 1.35) / Math.max(0.5, anchoVisible), 34, 74);
        distancia += (deseada - distancia) * Math.min(1, dt * 0.9);
        recolocarCamara();
      }
    },

    redimensionar(ancho: number, alto: number): void {
      camara.aspect = ancho / Math.max(1, alto);
      camara.updateProjectionMatrix();
    },

    liberar(): void {
      hud.remove();
      for (const d of desechables) d.dispose();
      escena.clear();
    },
  };
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}
