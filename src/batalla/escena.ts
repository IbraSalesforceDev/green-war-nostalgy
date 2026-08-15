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

/**
 * Aire alrededor de lo que se encuadra.
 *
 * Un ejército pegado al borde de la pantalla se lee como un ejército cortado, y
 * además no deja ver hacia dónde se mueve. Un 15 % basta para que se note que
 * hay campo a los lados.
 */
const MARGEN_ENCUADRE = 1.15;

/**
 * Inclinación de la cámara según lo estrecha que sea la pantalla.
 *
 * En apaisado la batalla se mira casi de perfil, que es como mejor se lee: las
 * dos líneas caen en un plano y se ve el hueco, el avance y la carga que entra.
 *
 * En vertical no hay margen para elegir. Meter los ochenta y cuatro de frente en
 * una pantalla estrecha obliga a alejarse mucho, y de tan lejos la cámara casi de
 * perfil enseña un palmo de campo abajo y todo lo demás cielo: la primera versión
 * de este arreglo encuadraba el campo entero, sí, pero sobre una pantalla vacía.
 * Lo que sobra es cielo, no distancia, así que en cuanto la pantalla se estrecha
 * la cámara se empina y el suelo vuelve a llenar el encuadre.
 *
 * Lo que no arregla ningún ángulo: a lo ancho hay unos cuatro píxeles por unidad
 * de campo en un móvil en vertical, así que las figuras salen pequeñas se haga lo
 * que se haga. Se ven las líneas y sus movimientos, que es para lo que sirve el
 * plano general; para verles la cara, apaisado.
 */
function inclinacionPara(aspecto: number): number {
  const t = limitar((aspecto - 0.6) / (1.3 - 0.6), 0, 1);
  return 1.0 + (0.4 - 1.0) * t;
}

function limitar(valor: number, minimo: number, maximo: number): number {
  return Math.min(maximo, Math.max(minimo, valor));
}

/** Velocidades de reloj que ofrece el panel. */
const VELOCIDADES = [1, 2, 3] as const;

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
  /**
   * Cuántos pasos de simulación pide por fotograma: 1, 2 o 3.
   *
   * No es un `dt` multiplicado, y la diferencia importa. Alargar el paso
   * cambiaría el resultado de la batalla —a pasos más largos las unidades se
   * atraviesan y el fuego se resuelve en trozos más gruesos—, así que acelerar
   * dejaría de ser una comodidad para pasar a ser una forma de jugar distinta.
   * Repitiendo el mismo paso fijo, x3 es exactamente la misma batalla vista tres
   * veces más deprisa.
   */
  readonly velocidad: number;
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
  // La niebla se ajusta luego a la distancia de la cámara. Con los 90/190 fijos
  // de antes, en cuanto el encuadre pedía alejarse —una pantalla estrecha pide
  // más de doscientas cincuenta unidades— la escena entera caía más allá del
  // fondo de niebla y se disolvía en el color del cielo: la batalla se veía como
  // una pantalla azul vacía, y parecía un fallo de la cámara cuando era esto.
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
    new THREE.PlaneGeometry(ANCHO_CAMPO * 6, FONDO_CAMPO * 16, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1, metalness: 0 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  suelo.receiveShadow = true;
  escena.add(suelo);
  desechables.push(suelo.geometry, suelo.material as THREE.Material);

  // Franjas de labranza: dan escala y hacen visible el avance de las tropas, que
  // sobre un verde liso parecería que patinan sin moverse.
  const franjas = new THREE.Group();
  for (let i = -24; i <= 24; i++) {
    const franja = new THREE.Mesh(
      new THREE.PlaneGeometry(ANCHO_CAMPO * 5, 2.2),
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
  const camara = new THREE.PerspectiveCamera(42, opciones.relacionAspecto, 0.5, 600);
  let objetivoX = 0;

  /**
   * A qué distancia cabe un ancho dado de campo, con margen.
   *
   * Antes la cámara arrancaba a una distancia fija de 52 y se acercaba o alejaba
   * después. El número estaba elegido a ojo sobre un monitor apaisado, y en
   * cuanto la pantalla se estrechaba dejaba de valer: lo que cabe a lo ancho
   * depende de la proporción de la pantalla, así que en un móvil los dos
   * ejércitos empezaban fuera del encuadre, uno por cada lado. Justo al
   * principio, que es cuando hay que decidir cómo plantear la batalla.
   *
   * Con esto la distancia se calcula en vez de estimarse, y sale bien en
   * cualquier pantalla porque la proporción entra en la cuenta.
   */
  function distanciaParaAncho(ancho: number): number {
    const mitadFov = (camara.fov * Math.PI) / 360;
    // Lo que se ve de ancho por cada unidad de distancia.
    const porUnidad = 2 * Math.tan(mitadFov) * Math.max(0.35, camara.aspect);
    return (ancho * MARGEN_ENCUADRE) / porUnidad;
  }

  /** La distancia a la que se ve el campo entero, de un borde al otro. */
  function distanciaDeCampoEntero(): number {
    return distanciaParaAncho(ANCHO_CAMPO);
  }

  let distancia = distanciaDeCampoEntero();
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
  let inclinacion = inclinacionPara(camara.aspect);

  function recolocarCamara(): void {
    camara.position.set(
      objetivoX,
      Math.sin(inclinacion) * distancia,
      Math.cos(inclinacion) * distancia,
    );
    camara.lookAt(objetivoX, 2.5, 0);
    // La niebla vive en el fondo de la escena, no a una distancia fija: tiene que
    // empezar más allá de la tropa y acabar más allá del campo, encuadre el que
    // encuadre.
    const niebla = escena.fog as THREE.Fog;
    niebla.near = distancia * 0.9;
    niebla.far = distancia * 2.6;
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

  // Reloj de la batalla. Va en la misma fila que las órdenes y separado a la
  // derecha: no es una orden a las tropas, es a qué ritmo lo miras.
  let velocidad = 1;
  const botonesVelocidad = new Map<number, HTMLButtonElement>();
  const grupoVelocidad = document.createElement('div');
  grupoVelocidad.className = 'gwn-batalla-velocidad';
  for (const paso of VELOCIDADES) {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'gwn-batalla-reloj';
    boton.textContent = `×${paso}`;
    boton.setAttribute('aria-label', `Velocidad por ${paso}`);
    boton.addEventListener('click', () => {
      velocidad = paso;
      refrescarMando();
    });
    grupoVelocidad.appendChild(boton);
    botonesVelocidad.set(paso, boton);
  }
  filaOrdenes.appendChild(grupoVelocidad);
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
    for (const [paso, boton] of botonesVelocidad) {
      boton.classList.toggle('gwn-batalla-reloj--activo', paso === velocidad);
    }
  }

  const pista = document.createElement('div');
  pista.className = 'gwn-batalla-pista';
  pista.textContent = 'Elige un arma y dile si avanza, aguanta o se retira';
  // Va dentro del panel y como primer hijo, no flotando a una altura fija sobre
  // el borde: en cuanto las órdenes se reparten en dos filas —una pantalla
  // estrecha— una altura fija se le echa encima y tapa el botón de avanzar.
  mando.insertBefore(pista, mando.firstChild);
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

    get velocidad() {
      return velocidad;
    },

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

        // Nunca más lejos que el campo entero ni más cerca de lo que hace falta
        // para que quepan los dos ejércitos. El techo importa tanto como el
        // suelo: sin él, la cámara se iba tan atrás que las figuras dejaban de
        // distinguirse; sin el suelo, la tropa se salía por los lados.
        const necesaria = distanciaParaAncho(Math.max(18, derecha - izquierda));
        const deseada = Math.min(necesaria, distanciaDeCampoEntero());
        // Si ni siquiera los dos ejércitos caben —pantalla estrecha—, la cámara se
        // queda en el tope y sigue al combate en vez de alejarse hasta que no se
        // distinga nada.
        distancia += (deseada - distancia) * Math.min(1, dt * 0.9);
        recolocarCamara();
      }
    },

    redimensionar(ancho: number, alto: number): void {
      camara.aspect = ancho / Math.max(1, alto);
      camara.updateProjectionMatrix();
      // Al girar el móvil cambia lo que cabe a lo ancho, así que el encuadre hay
      // que rehacerlo: si no, media batalla se queda fuera hasta el siguiente
      // reajuste automático. Y con la proporción cambia también el ángulo.
      inclinacion = inclinacionPara(camara.aspect);
      distancia = Math.min(distancia, distanciaDeCampoEntero());
      recolocarCamara();
    },

    liberar(): void {
      hud.remove();
      for (const d of desechables) d.dispose();
      escena.clear();
    },
  };
}

