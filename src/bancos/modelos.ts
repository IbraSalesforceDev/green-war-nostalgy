import * as THREE from 'three';
import { Bando, EstadoUnidad, TipoEdificio, TipoUnidad } from '../sim/tipos';
import { fichaUnidad, nombreUnidad, ORDEN_CARTA_UNIDADES } from '../sim/datos/unidades';
import { nombreEdificio } from '../sim/datos/edificios';
import { AZIMUT_CAMARA, INCLINACION_CAMARA } from '../sim/constantes';
import { DEG_A_RAD, limitar } from '../core/math';
import { crearFabricaModelos } from '../render/modelos/fabrica';
import type { ModeloEdificio, ModeloUnidad, PoseUnidad } from '../render/modelos/contrato';

/**
 * Banco de pruebas de modelos.
 *
 * Monta una rejilla de exposición con las diez combinaciones de unidad (5 tipos x 2
 * bandos), las doce de edificio (6 tipos x 2 bandos, cada uno en tres estados de obra
 * y daño) y los ocho adornos, todos etiquetados con su nombre de bando. No depende de
 * la simulación ni del resto del render: solo de la fábrica de modelos que este mismo
 * frente produce, para poder revisar el catálogo entero de un vistazo y con capturas
 * automatizadas.
 *
 * Parámetros por URL:
 *   ?estado=inactivo|caminando|atacando|recolectando|construyendo|muriendo|ciclo
 *   ?vista=unidades|edificios|adornos|juego
 *   ?x=&z=&d=&modo=movil   pose de cámara manual (para depurar a mano)
 */

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement | null;
const avisoError = document.getElementById('aviso-error');
const detalleError = document.getElementById('detalle-error');

function fallar(error: unknown): void {
  console.error(error);
  if (avisoError) avisoError.style.display = 'flex';
  if (detalleError) {
    detalleError.textContent =
      error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error);
  }
}

// --- Etiquetas de texto como sprites: nada de dependencias nuevas, solo canvas 2D. ---

function crearEtiqueta(texto: string, acento: string): THREE.Sprite {
  const tamFuente = 40;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${tamFuente}px 'Trebuchet MS', sans-serif`;
  const ancho = Math.ceil(ctx.measureText(texto).width) + 32;
  const alto = tamFuente + 20;
  canvas.width = ancho;
  canvas.height = alto;
  // Cambiar el tamaño reinicia el contexto: hay que reconfigurar la fuente.
  ctx.font = `bold ${tamFuente}px 'Trebuchet MS', sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,6,4,0.78)';
  ctx.fillRect(0, 0, ancho, alto);
  ctx.fillStyle = acento;
  ctx.fillRect(0, alto - 4, ancho, 4);
  ctx.fillStyle = '#f2e2b8';
  ctx.fillText(texto, 16, alto / 2 - 1);

  const textura = new THREE.CanvasTexture(canvas);
  textura.colorSpace = THREE.SRGBColorSpace;
  textura.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: textura, depthWrite: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  const escala = 0.0062;
  sprite.scale.set(ancho * escala, alto * escala, 1);
  return sprite;
}

const ACENTO_BANDO: Record<number, string> = {
  [Bando.HUMANOS]: '#4d7fe0',
  [Bando.ORCOS]: '#d1432f',
  [Bando.NEUTRAL]: '#d8b23a',
};

// --- Estados de animación en ciclo, para el modo `?estado=ciclo` ---

const CICLO_ESTADOS: readonly EstadoUnidad[] = [
  EstadoUnidad.INACTIVO,
  EstadoUnidad.CAMINANDO,
  EstadoUnidad.ATACANDO,
  EstadoUnidad.RECOLECTANDO,
  EstadoUnidad.CONSTRUYENDO,
  EstadoUnidad.MURIENDO,
];
const DURACION_CICLO = 2.4;

const NOMBRE_A_ESTADO: Record<string, EstadoUnidad> = {
  inactivo: EstadoUnidad.INACTIVO,
  caminando: EstadoUnidad.CAMINANDO,
  atacando: EstadoUnidad.ATACANDO,
  recolectando: EstadoUnidad.RECOLECTANDO,
  construyendo: EstadoUnidad.CONSTRUYENDO,
  muriendo: EstadoUnidad.MURIENDO,
};

interface ControladorUnidad {
  modelo: ModeloUnidad;
  desfase: number;
  rapidez: number;
  estadoBase: EstadoUnidad;
}

function arrancar(): void {
  if (!lienzo) throw new Error('No se ha encontrado el lienzo de dibujo.');

  const parametros = new URLSearchParams(location.search);
  const estadoParam = parametros.get('estado');
  const estadoForzado: EstadoUnidad | 'ciclo' | null =
    estadoParam === 'ciclo' ? 'ciclo' : estadoParam && NOMBRE_A_ESTADO[estadoParam] !== undefined ? NOMBRE_A_ESTADO[estadoParam]! : null;
  const vista = parametros.get('vista') ?? 'unidades';

  // --- Renderizador: mismos ajustes de color y sombra que el juego real. ---
  const renderer = new THREE.WebGLRenderer({ canvas: lienzo, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x1b2230, 1);
  renderer.info.autoReset = false;

  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0x1b2230, 45, 150);

  // Mismas tres luces que `iluminacion.ts` (sol + relleno + hemisférica), con los
  // mismos colores e intensidades: sin esto, un material metálico casi sin difuso
  // (`metalness` alto) se ve negro aquí y no refleja lo que pasará en la partida real.
  const DIRECCION_SOL = new THREE.Vector3(-0.58, 0.68, 0.45).normalize();
  const sol = new THREE.DirectionalLight(0xffe7c2, 2.75);
  sol.position.copy(DIRECCION_SOL).multiplyScalar(95);
  sol.target.position.set(0, 0, 30);
  sol.castShadow = true;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.camera.left = -40;
  sol.shadow.camera.right = 40;
  sol.shadow.camera.top = 40;
  sol.shadow.camera.bottom = -40;
  sol.shadow.camera.near = 1;
  sol.shadow.camera.far = 210;
  sol.shadow.bias = -0.0004;
  sol.shadow.normalBias = 0.03;
  sol.shadow.radius = 1.6;
  escena.add(sol, sol.target);

  const relleno = new THREE.DirectionalLight(0x86b0e6, 0.6);
  relleno.position.set(-DIRECCION_SOL.x * 60, 34, 30 + -DIRECCION_SOL.z * 60);
  escena.add(relleno);

  const ambiente = new THREE.HemisphereLight(0xa6cdf5, 0x4c3d29, 0.85);
  escena.add(ambiente);

  const suelo = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshStandardMaterial({ color: 0x3c4a32, roughness: 0.95, metalness: 0 }),
  );
  suelo.rotation.x = -Math.PI / 2;
  suelo.position.set(0, 0, 20);
  suelo.receiveShadow = true;
  escena.add(suelo);
  const rejilla = new THREE.GridHelper(240, 120, 0x5c6c48, 0x445236);
  rejilla.position.set(0, 0.002, 20);
  (rejilla.material as THREE.Material).opacity = 0.35;
  (rejilla.material as THREE.Material).transparent = true;
  escena.add(rejilla);

  const camara = new THREE.PerspectiveCamera(28, 1, 0.3, 400);

  // --- Cámara orbital simple: misma fórmula esférica que `CamaraJuego`. ---
  const cam = {
    x: 0,
    z: 0,
    distancia: 20,
    azimut: AZIMUT_CAMARA * DEG_A_RAD,
    inclinacion: INCLINACION_CAMARA * DEG_A_RAD,
  };
  function aplicarCamara(): void {
    const cosInc = Math.cos(cam.inclinacion);
    const senInc = Math.sin(cam.inclinacion);
    const px = cam.x - Math.sin(cam.azimut) * cam.distancia * cosInc;
    const py = cam.distancia * senInc;
    const pz = cam.z - Math.cos(cam.azimut) * cam.distancia * cosInc;
    camara.position.set(px, py, pz);
    camara.lookAt(cam.x, Math.min(2, cam.distancia * 0.06), cam.z);
    camara.near = Math.max(0.3, cam.distancia * 0.08);
    camara.far = cam.distancia * 6 + 120;
    camara.updateProjectionMatrix();
  }

  function encuadrar(x: number, z: number, distancia: number): void {
    cam.x = x;
    cam.z = z;
    cam.distancia = distancia;
  }

  // Encuadres por defecto según la zona a revisar; `?x=&z=&d=` los sobrescribe.
  if (vista === 'edificios') encuadrar(0, 39, 34);
  else if (vista === 'adornos') encuadrar(0, 72, 13);
  else if (vista === 'juego') encuadrar(0, 2.1, 20);
  else encuadrar(0, 4.6, 17);

  if (parametros.has('x')) cam.x = Number(parametros.get('x'));
  if (parametros.has('z')) cam.z = Number(parametros.get('z'));
  if (parametros.has('d')) cam.distancia = Number(parametros.get('d'));

  // --- Fábrica de modelos: el objeto bajo prueba. ---
  const fabrica = crearFabricaModelos();

  const controladoresUnidad: ControladorUnidad[] = [];
  const modelosEdificio: ModeloEdificio[] = [];

  function anadirEtiqueta(texto: string, bando: Bando, x: number, y: number, z: number): void {
    const etiqueta = crearEtiqueta(texto, ACENTO_BANDO[bando] ?? '#d8b23a');
    etiqueta.position.set(x, y, z);
    escena.add(etiqueta);
  }

  // --- Zona de unidades: humanos a la izquierda, orcos a la derecha. ---
  const X_HUMANOS = -1.4;
  const X_ORCOS = 1.4;
  const ESPACIO_FILA: Record<TipoUnidad, number> = {
    [TipoUnidad.CAMPESINO]: 0,
    [TipoUnidad.SOLDADO]: 2.1,
    [TipoUnidad.ARQUERO]: 4.2,
    [TipoUnidad.JINETE]: 6.6,
    [TipoUnidad.CATAPULTA]: 9.3,
  };

  for (const tipo of ORDEN_CARTA_UNIDADES) {
    const z = ESPACIO_FILA[tipo];
    const ficha = fichaUnidad(tipo);
    for (const [bando, x] of [
      [Bando.HUMANOS, X_HUMANOS],
      [Bando.ORCOS, X_ORCOS],
    ] as const) {
      const modelo = fabrica.crearUnidad(tipo, bando);
      modelo.raiz.position.set(x, 0, z);
      // El modelo mira a +Z por convenio; se gira 180° para presentar el frente a
      // una cámara que se acerca desde -Z, como en esta exposición.
      modelo.raiz.rotation.y = Math.PI;
      escena.add(modelo.raiz);
      const desfase = ((tipo * 7 + bando * 13 + 3) % 97) / 97;
      controladoresUnidad.push({ modelo, desfase, rapidez: ficha.velocidad, estadoBase: EstadoUnidad.INACTIVO });
      anadirEtiqueta(nombreUnidad(tipo, bando), bando, x, modelo.altura + 0.32, z);
    }
  }

  // --- Zona de edificios: tres estados (obra, sano, dañado) por tipo y bando. ---
  const TIPOS_EDIFICIO: readonly TipoEdificio[] = [
    TipoEdificio.AYUNTAMIENTO,
    TipoEdificio.GRANJA,
    TipoEdificio.BARRACON,
    TipoEdificio.ASERRADERO,
    TipoEdificio.TORRE,
    TipoEdificio.HERRERIA,
  ];
  const Z_EDIFICIOS_BASE = 32;
  const PASO_COLUMNA = 7;
  const PASO_BANDO = 3.4;
  const ESTADOS_EDIFICIO: ReadonlyArray<{ etiqueta: string; progreso: number; danio: number; dz: number }> = [
    { etiqueta: 'obra', progreso: 0.45, danio: 0, dz: 0 },
    { etiqueta: 'sano', progreso: 1, danio: 0, dz: 7 },
    { etiqueta: 'dañado', progreso: 1, danio: 0.75, dz: 14 },
  ];

  TIPOS_EDIFICIO.forEach((tipo, columna) => {
    const xBase = (columna - (TIPOS_EDIFICIO.length - 1) / 2) * PASO_COLUMNA;
    for (const [bando, dx] of [
      [Bando.HUMANOS, -PASO_BANDO / 2],
      [Bando.ORCOS, PASO_BANDO / 2],
    ] as const) {
      for (const estado of ESTADOS_EDIFICIO) {
        const modelo = fabrica.crearEdificio(tipo, bando);
        const x = xBase + dx;
        const z = Z_EDIFICIOS_BASE + estado.dz;
        modelo.raiz.position.set(x, 0, z);
        modelo.raiz.rotation.y = Math.PI;
        modelo.fijarProgresoObra(estado.progreso);
        modelo.fijarDanio(estado.danio);
        escena.add(modelo.raiz);
        modelosEdificio.push(modelo);
        anadirEtiqueta(`${nombreEdificio(tipo, bando)} · ${estado.etiqueta}`, bando, x, modelo.altura + 0.4, z);
      }
    }
  });

  // --- Zona de adornos ---
  const ADORNOS: readonly [string, string][] = [
    ['pino', 'Pino'],
    ['roble', 'Roble'],
    ['tocon', 'Tocón'],
    ['roca-grande', 'Roca grande'],
    ['roca-pequena', 'Roca pequeña'],
    ['veta-oro', 'Veta de oro'],
    ['arbusto', 'Arbusto'],
    ['hueso', 'Hueso'],
  ];
  const Z_ADORNOS = 72;
  ADORNOS.forEach(([clave, etiqueta], i) => {
    const x = (i - (ADORNOS.length - 1) / 2) * 2.1;
    const objeto = fabrica.crearAdorno(clave, i * 971 + 13);
    objeto.position.set(x, 0, Z_ADORNOS);
    objeto.rotation.y = (i * 0.7) % (Math.PI * 2);
    escena.add(objeto);
    anadirEtiqueta(etiqueta, Bando.NEUTRAL, x, 1.6, Z_ADORNOS);
  });

  // --- Controles de depuración: arrastrar para orbitar, rueda para acercar. ---
  let arrastrando = false;
  let ultimoX = 0;
  let ultimoY = 0;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    arrastrando = true;
    ultimoX = e.clientX;
    ultimoY = e.clientY;
  });
  window.addEventListener('pointerup', () => (arrastrando = false));
  window.addEventListener('pointermove', (e) => {
    if (!arrastrando) return;
    cam.azimut -= (e.clientX - ultimoX) * 0.006;
    cam.inclinacion = limitar(cam.inclinacion - (e.clientY - ultimoY) * 0.005, 0.15, 1.45);
    ultimoX = e.clientX;
    ultimoY = e.clientY;
  });
  renderer.domElement.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      cam.distancia = limitar(cam.distancia * (e.deltaY > 0 ? 1.12 : 0.89), 4, 140);
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    const paso = cam.distancia * 0.05;
    if (e.code === 'KeyW') cam.z -= paso;
    if (e.code === 'KeyS') cam.z += paso;
    if (e.code === 'KeyA') cam.x -= paso;
    if (e.code === 'KeyD') cam.x += paso;
  });

  function redimensionar(): void {
    const ancho = lienzo!.clientWidth || window.innerWidth;
    const alto = lienzo!.clientHeight || window.innerHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setSize(ancho, alto, false);
    camara.aspect = ancho / Math.max(1, alto);
    camara.updateProjectionMatrix();
  }
  window.addEventListener('resize', redimensionar);
  redimensionar();

  // --- Bucle ---
  const telemetria = { fps: 0, msRender: 0, msSimulacion: 0 };
  let tiempoGlobal = 0;
  let ultimo = performance.now();
  let acumulado = 0;
  let fotogramas = 0;

  function poseParaControlador(c: ControladorUnidad): PoseUnidad {
    let estado: EstadoUnidad;
    let tiempoEstado: number;

    if (estadoForzado === 'ciclo') {
      const fase = tiempoGlobal + c.desfase * DURACION_CICLO * CICLO_ESTADOS.length;
      const indice = Math.floor(fase / DURACION_CICLO) % CICLO_ESTADOS.length;
      estado = CICLO_ESTADOS[indice]!;
      tiempoEstado = fase % DURACION_CICLO;
    } else if (estadoForzado !== null) {
      estado = estadoForzado;
      tiempoEstado = tiempoGlobal + c.desfase * 2.7;
    } else {
      estado = c.estadoBase;
      tiempoEstado = tiempoGlobal + c.desfase * 2.7;
    }

    return {
      estado,
      tiempoEstado,
      rapidez: estado === EstadoUnidad.CAMINANDO ? c.rapidez : 0,
      saludNormalizada: 1,
      tiempoGlobal,
      desfase: c.desfase,
    };
  }

  function fotograma(): void {
    requestAnimationFrame(fotograma);

    const ahora = performance.now();
    const dt = Math.min(0.1, (ahora - ultimo) / 1000);
    ultimo = ahora;
    tiempoGlobal += dt;

    for (const c of controladoresUnidad) c.modelo.aplicarPose(poseParaControlador(c));

    aplicarCamara();

    renderer.info.reset();
    const inicioRender = performance.now();
    renderer.render(escena, camara);
    telemetria.msRender = performance.now() - inicioRender;

    fotogramas++;
    acumulado += dt;
    if (acumulado >= 0.5) {
      telemetria.fps = fotogramas / acumulado;
      acumulado = 0;
      fotogramas = 0;
    }
  }
  fotograma();

  const banco = {
    escena,
    camara,
    renderer,
    fabrica,
    controladoresUnidad,
    modelosEdificio,
    cam,
    saltarA(x: number, z: number, distancia?: number): void {
      cam.x = x;
      cam.z = z;
      if (distancia) cam.distancia = distancia;
    },
    // Compatibilidad con `tools/capturar.mjs`, que mueve la cámara a través de
    // `window.juego.camara` con la misma API que `CamaraJuego`.
    bucle: telemetria,
  };

  const juego = {
    bucle: telemetria,
    camara: {
      saltarA: banco.saltarA,
      get distancia(): number {
        return cam.distancia;
      },
      set distancia(v: number) {
        cam.distancia = v;
      },
      acercar(factor: number): void {
        cam.distancia = limitar(cam.distancia * factor, 4, 140);
      },
    },
    renderizador: {
      escala: 1,
      calidad: { nivel: 'alto' as const },
      instantanea(): { llamadas: number; triangulos: number; texturas: number; programas: number } {
        const info = renderer.info;
        return {
          llamadas: info.render.calls,
          triangulos: info.render.triangles,
          texturas: info.memory.textures,
          programas: info.programs?.length ?? 0,
        };
      },
    },
    mundo: {
      contarActivas: (): number => controladoresUnidad.length + modelosEdificio.length,
    },
  };

  Object.assign(window as unknown as Record<string, unknown>, { banco, juego });

  console.info(
    `[banco-modelos] unidades=${controladoresUnidad.length} edificios=${modelosEdificio.length} vista=${vista} estado=${estadoParam ?? '(por defecto)'}`,
  );
}

try {
  arrancar();
} catch (error) {
  fallar(error);
}
