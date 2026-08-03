import * as THREE from 'three';
import { Bando, EstadoUnidad, TipoUnidad } from '../../sim/tipos';
import { limitar01 } from '../../core/math';
import type { ModeloUnidad, PoseUnidad } from './contrato';
import type { Acabado, Paleta } from './materiales';
import { BancoMateriales, paletaDe, variarColor } from './materiales';
import {
  Ensamblador,
  cajaEn,
  capsula,
  cilindro,
  cono,
  cupula,
  esfera,
  girarX,
  girarY,
  girarZ,
  liberarGeometrias,
  mover,
  nodo,
  prisma,
  toro,
} from './piezas';
import {
  calcularPose,
  crearPoseEsqueleto,
  faseCuadrupedo,
  flexionCuadrupedo,
  perfil,
  salidaAtras,
  suavizar,
  type PerfilAnimacion,
  type PoseEsqueleto,
} from './animacion';

/**
 * Modelos de unidades.
 *
 * Cada tipo+bando se construye una única vez como «plantilla»: una jerarquía de
 * `THREE.Group` nombrados con las mallas ya fusionadas por `Ensamblador` colgando de
 * los nodos que corresponde. Cada instancia en el mundo es un `plantilla.clone(true)`:
 * Three.js clona los `Group` y copia las `Mesh` por referencia a la misma geometría y
 * el mismo material, así que cien soldados comparten una sola malla de torso y cien
 * transformaciones distintas.
 *
 * La pose se calcula con `calcularPose` (de `animacion.ts`) en un `PoseEsqueleto`
 * reutilizado a nivel de módulo —no se reserva memoria en el fotograma caliente— y
 * se vuelca en las rotaciones de los nodos, localizados por nombre una sola vez al
 * crear cada instancia (no en cada fotograma).
 */

// --- Geometría auxiliar de miembros ---

/** Extremidad como cápsula que cuelga desde el nodo del pivote hasta `-largo`. */
function miembro(radio: number, largo: number, color: number, segmentos = 8): THREE.BufferGeometry {
  const cilindrico = Math.max(0.015, largo - radio * 2);
  return mover(capsula(radio, cilindrico, color, segmentos), 0, -largo / 2, 0);
}

const SIGNO_LADO: readonly [number, number] = [-1, 1];

// --- Proporciones del bípedo ---

interface ProporcionesBipedo {
  alturaCadera: number;
  alturaHombro: number;
  anchoHombros: number;
  anchoCadera: number;
  fondoTorso: number;
  radioMuslo: number;
  largoMuslo: number;
  radioPantorrilla: number;
  largoPantorrilla: number;
  radioBrazoSup: number;
  largoBrazoSup: number;
  radioBrazoInf: number;
  largoBrazoInf: number;
  radioCabeza: number;
}

function proporcionesHumanas(): ProporcionesBipedo {
  return {
    alturaCadera: 0.5,
    alturaHombro: 0.34,
    anchoHombros: 0.4,
    anchoCadera: 0.22,
    fondoTorso: 0.2,
    radioMuslo: 0.075,
    largoMuslo: 0.27,
    radioPantorrilla: 0.058,
    largoPantorrilla: 0.25,
    radioBrazoSup: 0.062,
    largoBrazoSup: 0.22,
    radioBrazoInf: 0.05,
    largoBrazoInf: 0.2,
    radioCabeza: 0.115,
  };
}

function proporcionesOrcas(): ProporcionesBipedo {
  return {
    alturaCadera: 0.44,
    alturaHombro: 0.37,
    anchoHombros: 0.54,
    anchoCadera: 0.3,
    fondoTorso: 0.26,
    radioMuslo: 0.1,
    largoMuslo: 0.24,
    radioPantorrilla: 0.088,
    largoPantorrilla: 0.21,
    radioBrazoSup: 0.095,
    largoBrazoSup: 0.25,
    radioBrazoInf: 0.078,
    largoBrazoInf: 0.23,
    radioCabeza: 0.14,
  };
}

function escalarProp(p: ProporcionesBipedo, f: number): ProporcionesBipedo {
  return {
    alturaCadera: p.alturaCadera * f,
    alturaHombro: p.alturaHombro * f,
    anchoHombros: p.anchoHombros * f,
    anchoCadera: p.anchoCadera * f,
    fondoTorso: p.fondoTorso * f,
    radioMuslo: p.radioMuslo * f,
    largoMuslo: p.largoMuslo * f,
    radioPantorrilla: p.radioPantorrilla * f,
    largoPantorrilla: p.largoPantorrilla * f,
    radioBrazoSup: p.radioBrazoSup * f,
    largoBrazoSup: p.largoBrazoSup * f,
    radioBrazoInf: p.radioBrazoInf * f,
    largoBrazoInf: p.largoBrazoInf * f,
    radioCabeza: p.radioCabeza * f,
  };
}

function proporcionesPara(tipo: TipoUnidad, bando: Bando): ProporcionesBipedo {
  const base = bando === Bando.ORCOS ? proporcionesOrcas() : proporcionesHumanas();
  const factor =
    tipo === TipoUnidad.CAMPESINO
      ? 0.93
      : tipo === TipoUnidad.ARQUERO
        ? 0.96
        : tipo === TipoUnidad.JINETE
          ? 0.97
          : 1;
  return escalarProp(base, factor);
}

// --- Esqueleto: jerarquía de nodos con nombre ---

interface NodosBipedo {
  raiz: THREE.Group;
  cuerpo: THREE.Group;
  torso: THREE.Group;
  cabeza: THREE.Group;
  hombro: readonly [THREE.Group, THREE.Group];
  codo: readonly [THREE.Group, THREE.Group];
  arma: readonly [THREE.Group, THREE.Group];
  cadera: readonly [THREE.Group, THREE.Group];
  rodilla: readonly [THREE.Group, THREE.Group];
  capa: THREE.Group | null;
}

function crearEsqueletoBipedo(prop: ProporcionesBipedo, nombreRaiz: string, conCapa: boolean): NodosBipedo {
  const raiz = nodo(nombreRaiz);
  const cuerpo = nodo('cuerpo');
  raiz.add(cuerpo);

  const torso = nodo('torso', 0, prop.alturaCadera, 0);
  cuerpo.add(torso);

  const cabeza = nodo('cabeza', 0, prop.alturaHombro, 0);
  torso.add(cabeza);

  const hombro: [THREE.Group, THREE.Group] = [
    nodo('hombroI', -prop.anchoHombros / 2, prop.alturaHombro * 0.92, prop.fondoTorso * 0.04),
    nodo('hombroD', prop.anchoHombros / 2, prop.alturaHombro * 0.92, prop.fondoTorso * 0.04),
  ];
  torso.add(hombro[0], hombro[1]);

  const codo: [THREE.Group, THREE.Group] = [
    nodo('codoI', 0, -prop.largoBrazoSup, 0),
    nodo('codoD', 0, -prop.largoBrazoSup, 0),
  ];
  hombro[0].add(codo[0]);
  hombro[1].add(codo[1]);

  const arma: [THREE.Group, THREE.Group] = [
    nodo('armaI', 0, -prop.largoBrazoInf, 0),
    nodo('armaD', 0, -prop.largoBrazoInf, 0),
  ];
  codo[0].add(arma[0]);
  codo[1].add(arma[1]);

  const cadera: [THREE.Group, THREE.Group] = [
    nodo('caderaI', -prop.anchoCadera / 2, prop.alturaCadera, 0),
    nodo('caderaD', prop.anchoCadera / 2, prop.alturaCadera, 0),
  ];
  cuerpo.add(cadera[0], cadera[1]);

  const rodilla: [THREE.Group, THREE.Group] = [
    nodo('rodillaI', 0, -prop.largoMuslo, 0),
    nodo('rodillaD', 0, -prop.largoMuslo, 0),
  ];
  cadera[0].add(rodilla[0]);
  cadera[1].add(rodilla[1]);

  let capa: THREE.Group | null = null;
  if (conCapa) {
    capa = nodo('capa', 0, prop.alturaHombro * 0.9, -prop.fondoTorso * 0.42);
    torso.add(capa);
  }

  return { raiz, cuerpo, torso, cabeza, hombro, codo, arma, cadera, rodilla, capa };
}

function resolverNodosBipedo(raizClon: THREE.Object3D): NodosBipedo {
  const g = (n: string): THREE.Group => raizClon.getObjectByName(n) as THREE.Group;
  return {
    raiz: raizClon as THREE.Group,
    cuerpo: g('cuerpo'),
    torso: g('torso'),
    cabeza: g('cabeza'),
    hombro: [g('hombroI'), g('hombroD')],
    codo: [g('codoI'), g('codoD')],
    arma: [g('armaI'), g('armaD')],
    cadera: [g('caderaI'), g('caderaD')],
    rodilla: [g('rodillaI'), g('rodillaD')],
    capa: (raizClon.getObjectByName('capa') as THREE.Group | undefined) ?? null,
  };
}

function aplicarPoseEnNodosBipedo(n: NodosBipedo, p: PoseEsqueleto): void {
  n.cuerpo.position.y = p.alturaCuerpo;
  n.cuerpo.rotation.set(p.vuelcoCuerpo, p.giroCuerpo, p.balanceoCuerpo);

  n.torso.rotation.set(p.torsoCabeceo, p.torsoGiro, p.torsoBalanceo);
  n.cabeza.rotation.set(p.cabezaCabeceo, p.cabezaGiro, 0);

  for (const lado of [0, 1] as const) {
    const s = SIGNO_LADO[lado];
    n.hombro[lado].rotation.set(p.hombro[lado], 0, s * p.abduccion[lado]);
    n.codo[lado].rotation.x = p.codo[lado];
  }
  // El latigazo de muñeca solo afecta a la mano del arma (derecha por convenio).
  n.arma[1].rotation.z = p.arma;
  n.arma[0].rotation.z = p.arma * 0.15;

  for (const lado of [0, 1] as const) {
    n.cadera[lado].rotation.x = p.muslo[lado];
    n.rodilla[lado].rotation.x = p.pantorrilla[lado];
  }

  if (n.capa) n.capa.rotation.x = 0.4 + p.capa;
}

function aplicarDetalle(raiz: THREE.Object3D, nivel: 0 | 1 | 2): void {
  raiz.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!(m as THREE.Mesh).isMesh) return;
    const d = (m.userData.detalle as 0 | 1 | 2 | undefined) ?? 2;
    m.visible = d >= nivel;
  });
}

// --- Piezas de vestuario y armamento ---

/** Torso troncocónico: más ancho en el hombro que en la cadera, la silueta heroica. */
function anadirTorso(
  ens: Ensamblador,
  prop: ProporcionesBipedo,
  colorPrenda: Acabado,
  colorTronco: number,
  colorCinturon: number,
): void {
  const cuerpo = prisma(
    prop.anchoCadera * 1.05,
    prop.fondoTorso * 0.85,
    prop.anchoHombros * 0.96,
    prop.fondoTorso,
    prop.alturaHombro,
    colorTronco,
  );
  ens.anadir(cuerpo, colorPrenda, { sombra: true });

  const cinturon = cajaEn(
    prop.anchoCadera * 1.1,
    prop.alturaHombro * 0.12,
    prop.fondoTorso * 0.92,
    0,
    prop.alturaHombro * 0.18,
    0,
    colorCinturon,
  );
  ens.anadir(cinturon, 'mate', { detalle: 1 });
}

function anadirCabeza(
  ens: Ensamblador,
  prop: ProporcionesBipedo,
  paleta: Paleta,
  orco: boolean,
  casco: 'ninguno' | 'yelmo' | 'capucha' | 'melena',
): void {
  const cabeza = esfera(prop.radioCabeza, orco ? paleta.piel : paleta.piel, 9, 7);
  ens.anadir(cabeza, 'piel', { sombra: true });

  if (orco) {
    // Mandíbula prominente y colmillos: la firma orca reconocible a distancia.
    const mandibula = cajaEn(
      prop.radioCabeza * 1.15,
      prop.radioCabeza * 0.5,
      prop.radioCabeza * 1.05,
      0,
      -prop.radioCabeza * 0.55,
      prop.radioCabeza * 0.2,
      paleta.pielOscura,
    );
    ens.anadir(mandibula, 'piel', { detalle: 1 });
    for (const lado of [-1, 1]) {
      const colmillo = cono(prop.radioCabeza * 0.09, prop.radioCabeza * 0.28, paleta.hueso, 5);
      girarX(colmillo, Math.PI);
      mover(colmillo, lado * prop.radioCabeza * 0.32, -prop.radioCabeza * 0.35, prop.radioCabeza * 0.75);
      ens.anadir(colmillo, 'mate', { detalle: 0 });
    }
  }

  if (casco === 'yelmo') {
    const yelmo = cupula(prop.radioCabeza * 1.14, paleta.metal, 10, 6);
    mover(yelmo, 0, prop.radioCabeza * 0.15, 0);
    ens.anadir(yelmo, 'metal', { sombra: true });
    const cimera = cajaEn(
      0.02,
      prop.radioCabeza * 0.55,
      prop.radioCabeza * 1.15,
      0,
      prop.radioCabeza * 1.15,
      0,
      paleta.bandera,
    );
    ens.anadir(cimera, 'mate', { detalle: 0 });
  } else if (casco === 'capucha') {
    const capucha = cupula(prop.radioCabeza * 1.18, paleta.telaOscura, 9, 6);
    mover(capucha, 0, prop.radioCabeza * 0.1, -prop.radioCabeza * 0.08);
    ens.anadir(capucha, 'mate', { sombra: true });
  } else if (casco === 'melena') {
    const melena = cupula(prop.radioCabeza * 1.05, paleta.pelo, 8, 5);
    girarX(melena, Math.PI);
    mover(melena, 0, -prop.radioCabeza * 0.35, -prop.radioCabeza * 0.35);
    ens.anadir(melena, 'mate', { detalle: 1 });
  }
}

function anadirBrazo(
  ens: Ensamblador,
  prop: ProporcionesBipedo,
  colorManga: number,
  colorPiel: number,
  orco: boolean,
): void {
  const sup = miembro(prop.radioBrazoSup, prop.largoBrazoSup, orco ? colorPiel : colorManga);
  ens.anadir(sup, orco ? 'piel' : 'mate', { sombra: true });
}

function anadirAntebrazoYMano(
  ens: Ensamblador,
  prop: ProporcionesBipedo,
  color: number,
  acabado: Acabado,
): void {
  const inf = miembro(prop.radioBrazoInf, prop.largoBrazoInf, color);
  ens.anadir(inf, acabado, { sombra: true });
}

function anadirMano(ens: Ensamblador, prop: ProporcionesBipedo, colorPiel: number): void {
  const puno = esfera(prop.radioBrazoInf * 0.85, colorPiel, 7, 5);
  ens.anadir(puno, 'piel', { detalle: 1 });
}

function anadirPierna(
  ens: Ensamblador,
  prop: ProporcionesBipedo,
  colorMuslo: number,
  acabadoMuslo: Acabado,
): void {
  const muslo = miembro(prop.radioMuslo, prop.largoMuslo, colorMuslo);
  ens.anadir(muslo, acabadoMuslo, { sombra: true });
}

function anadirPantorrillaYBota(
  ensRodilla: Ensamblador,
  prop: ProporcionesBipedo,
  colorPantorrilla: number,
  acabadoPantorrilla: Acabado,
  colorBota: number,
): void {
  const pantorrilla = miembro(prop.radioPantorrilla, prop.largoPantorrilla, colorPantorrilla);
  ensRodilla.anadir(pantorrilla, acabadoPantorrilla, { sombra: true });

  const bota = cajaEn(
    prop.radioPantorrilla * 2.1,
    prop.radioPantorrilla * 1.5,
    prop.radioPantorrilla * 3,
    0,
    -prop.largoPantorrilla + prop.radioPantorrilla * 0.6,
    prop.radioPantorrilla * 0.9,
    colorBota,
  );
  ensRodilla.anadir(bota, 'mate', { detalle: 1 });
}

// --- Armamento ---

function anadirEspada(ens: Ensamblador, paleta: Paleta, escala: number): void {
  const largoHoja = 0.46 * escala;
  const hoja = prisma(0.05 * escala, 0.014 * escala, 0.012 * escala, 0.006 * escala, largoHoja, paleta.metal);
  mover(hoja, 0, 0.05 * escala, 0);
  ens.anadir(hoja, 'metal', { sombra: true });

  const guarda = cajaEn(0.17 * escala, 0.028 * escala, 0.03 * escala, 0, 0.05 * escala, 0, paleta.metalOscuro);
  ens.anadir(guarda, 'metal', { detalle: 1 });

  const empunadura = cilindro(0.018 * escala, 0.02 * escala, 0.09 * escala, paleta.cueroOscuro, 6);
  mover(empunadura, 0, -0.04 * escala, 0);
  ens.anadir(empunadura, 'mate', { detalle: 1 });

  const pomo = esfera(0.026 * escala, paleta.metalOscuro, 6, 5);
  mover(pomo, 0, -0.09 * escala, 0);
  ens.anadir(pomo, 'metal', { detalle: 0 });
}

function anadirEscudo(ens: Ensamblador, paleta: Paleta, escala: number, redondo: boolean): void {
  const radio = (redondo ? 0.16 : 0.14) * escala;
  const disco = redondo
    ? cilindro(radio, radio, 0.03 * escala, paleta.metal, 12)
    : cono(radio, 0.05 * escala, paleta.metal, 6);
  girarX(disco, Math.PI / 2);
  mover(disco, -0.03 * escala, -0.02 * escala, 0.05 * escala);
  ens.anadir(disco, 'metal', { sombra: true });

  const emblema = esfera(radio * 0.28, paleta.bandera, 8, 6);
  mover(emblema, -0.03 * escala, -0.02 * escala, 0.05 * escala + 0.031 * escala);
  ens.anadir(emblema, 'mate', { detalle: 0 });
}

function anadirHacha(ens: Ensamblador, paleta: Paleta, escala: number): void {
  const largoAsta = 0.48 * escala;
  const asta = cilindro(0.022 * escala, 0.028 * escala, largoAsta, paleta.maderaOscura, 6);
  mover(asta, 0, -0.05 * escala, 0);
  ens.anadir(asta, 'mate', { sombra: true });

  const anchoHoja = 0.24 * escala;
  const hoja = prisma(anchoHoja, 0.022 * escala, anchoHoja * 0.12, 0.022 * escala, 0.19 * escala, paleta.metal);
  girarZ(hoja, Math.PI / 2);
  mover(hoja, 0.02 * escala, largoAsta * 0.62, 0);
  ens.anadir(hoja, 'metal', { sombra: true });
}

function anadirHachaArrojadiza(ens: Ensamblador, paleta: Paleta, escala: number): void {
  const largoAsta = 0.22 * escala;
  const asta = cilindro(0.016 * escala, 0.02 * escala, largoAsta, paleta.maderaOscura, 5);
  mover(asta, 0, -0.02 * escala, 0);
  ens.anadir(asta, 'mate', { sombra: true });

  const hoja = prisma(0.14 * escala, 0.016 * escala, 0.02 * escala, 0.016 * escala, 0.11 * escala, paleta.metal);
  girarZ(hoja, Math.PI / 2);
  mover(hoja, 0.01 * escala, largoAsta * 0.5, 0);
  ens.anadir(hoja, 'metal', { detalle: 1 });
}

function anadirArco(ens: Ensamblador, paleta: Paleta, escala: number): void {
  // Dos brazos curvos hechos de tramos rectos concatenados y angulados: a la
  // distancia de juego una polilínea de tres tramos ya lee como un arco tensado.
  const largos = [0.16, 0.14, 0.1];
  for (const lado of [-1, 1]) {
    let y = 0.02 * escala;
    let x = 0;
    for (let i = 0; i < largos.length; i++) {
      const largo = largos[i]! * escala;
      const angulo = lado * (0.22 + i * 0.34);
      const tramo = cilindro(
        0.014 * escala * (1 - i * 0.15),
        0.017 * escala * (1 - i * 0.1),
        largo,
        paleta.madera,
        6,
      );
      girarZ(tramo, angulo);
      // Cada tramo nace donde terminó el anterior, así la polilínea encadena sin
      // huecos en vez de salir todos del mismo punto.
      mover(tramo, x, y, 0);
      ens.anadir(tramo, 'mate', { sombra: true });
      x += Math.sin(angulo) * largo;
      y += Math.cos(angulo) * largo;
    }
  }
  const empunadura = cilindro(0.02 * escala, 0.02 * escala, 0.16 * escala, paleta.cueroOscuro, 6);
  mover(empunadura, 0, -0.06 * escala, 0);
  ens.anadir(empunadura, 'mate', { detalle: 1 });
}

function anadirFlecha(ens: Ensamblador, paleta: Paleta, escala: number): void {
  const asta = cilindro(0.008 * escala, 0.008 * escala, 0.5 * escala, paleta.madera, 5);
  girarX(asta, Math.PI / 2);
  mover(asta, 0, 0, 0.25 * escala);
  ens.anadir(asta, 'mate', { detalle: 1 });
  const punta = cono(0.014 * escala, 0.04 * escala, paleta.metal, 5);
  girarX(punta, -Math.PI / 2);
  mover(punta, 0, 0, 0.5 * escala);
  ens.anadir(punta, 'metal', { detalle: 0 });
}

function anadirLanza(ens: Ensamblador, paleta: Paleta, escala: number, largoTotal: number): void {
  const asta = cilindro(0.02 * escala, 0.024 * escala, largoTotal, paleta.maderaOscura, 6);
  girarX(asta, Math.PI / 2);
  mover(asta, 0, 0, -largoTotal * 0.35);
  ens.anadir(asta, 'mate', { sombra: true });

  const punta = cono(0.035 * escala, 0.16 * escala, paleta.metal, 6);
  girarX(punta, -Math.PI / 2);
  mover(punta, 0, 0, largoTotal * 0.5);
  ens.anadir(punta, 'metal', { sombra: true });

  const banderin = cajaEn(0.001, 0.1 * escala, 0.16 * escala, 0, 0.05 * escala, largoTotal * 0.36, paleta.bandera);
  ens.anadir(banderin, 'mate', { detalle: 0 });
}

function anadirHerramienta(ens: Ensamblador, paleta: Paleta, escala: number): void {
  // Pico/azada genérico: sirve tanto para picar mineral como para cavar o talar.
  const mango = cilindro(0.018 * escala, 0.02 * escala, 0.5 * escala, paleta.madera, 6);
  mover(mango, 0, -0.06 * escala, 0);
  ens.anadir(mango, 'mate', { sombra: true });

  const cabezal = prisma(0.05 * escala, 0.05 * escala, 0.02 * escala, 0.02 * escala, 0.22 * escala, paleta.metalOscuro);
  girarZ(cabezal, Math.PI / 2);
  mover(cabezal, 0.03 * escala, 0.38 * escala, 0);
  ens.anadir(cabezal, 'metal', { sombra: true });
}

// --- Perfil de animación por tipo/bando ---

function perfilPara(tipo: TipoUnidad, bando: Bando): PerfilAnimacion {
  const orco = bando === Bando.ORCOS;
  switch (tipo) {
    case TipoUnidad.CAMPESINO:
      return perfil({
        estilo: 'espada',
        trabajo: 'picar',
        periodoAtaque: 1.3,
        periodoTrabajo: orco ? 0.95 : 1.05,
        cadenciaPaso: orco ? 2.3 : 2.6,
        zancada: orco ? 0.48 : 0.56,
        braceo: 0.4,
        encorvado: orco ? 0.22 : 0.05,
        abduccionBase: orco ? 0.16 : 0.08,
        rebote: 0.95,
        respiracion: 1,
      });
    case TipoUnidad.SOLDADO:
      return perfil({
        estilo: orco ? 'hacha' : 'espada',
        trabajo: 'picar',
        periodoAtaque: orco ? 1.35 : 1.15,
        periodoTrabajo: 1.1,
        cadenciaPaso: orco ? 2.2 : 2.5,
        zancada: orco ? 0.55 : 0.62,
        braceo: 0.55,
        encorvado: orco ? 0.26 : 0.07,
        abduccionBase: orco ? 0.2 : 0.11,
        rebote: 1.05,
        respiracion: 0.9,
      });
    case TipoUnidad.ARQUERO:
      return perfil({
        estilo: orco ? 'lanzamiento' : 'arco',
        trabajo: 'picar',
        periodoAtaque: orco ? 1.1 : 1.4,
        periodoTrabajo: 1.1,
        cadenciaPaso: orco ? 2.3 : 2.6,
        zancada: orco ? 0.5 : 0.58,
        braceo: 0.48,
        encorvado: orco ? 0.24 : 0.05,
        abduccionBase: orco ? 0.18 : 0.09,
        rebote: 1,
        respiracion: 1,
      });
    case TipoUnidad.JINETE:
      return perfil({
        estilo: orco ? 'hacha' : 'lanza',
        trabajo: 'picar',
        periodoAtaque: orco ? 1.3 : 1.5,
        periodoTrabajo: 1.1,
        cadenciaPaso: 2.4,
        zancada: 0.4,
        braceo: 0.3,
        encorvado: orco ? 0.18 : 0.04,
        abduccionBase: orco ? 0.14 : 0.08,
        rebote: 0.6,
        respiracion: 0.8,
      });
    default:
      return perfil({
        estilo: 'maquina',
        trabajo: 'picar',
        periodoAtaque: 3.6,
        periodoTrabajo: 1,
        cadenciaPaso: 1.4,
        zancada: 0.1,
        braceo: 0,
        encorvado: 0,
        abduccionBase: 0,
        rebote: 0.3,
        respiracion: 0.3,
      });
  }
}

// --- Constructores de plantilla por tipo ---

interface PlantillaUnidad {
  plantilla: THREE.Object3D;
  altura: number;
  perfil: PerfilAnimacion;
  tipoRig: 'biped' | 'jinete' | 'maquina';
}

function construirCampesino(bando: Bando, banco: BancoMateriales): PlantillaUnidad {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const prop = proporcionesPara(TipoUnidad.CAMPESINO, bando);
  const nodos = crearEsqueletoBipedo(prop, `campesino-${bando}`, false);

  const ensTorso = new Ensamblador();
  anadirTorso(ensTorso, prop, 'mate', variarColor(paleta.tela, -0.05), paleta.cueroOscuro);
  ensTorso.volcarEn(nodos.torso, banco, 'campesino-torso');

  const ensCabeza = new Ensamblador();
  anadirCabeza(ensCabeza, prop, paleta, orco, orco ? 'ninguno' : 'ninguno');
  ensCabeza.volcarEn(nodos.cabeza, banco, 'campesino-cabeza');

  for (const lado of [0, 1] as const) {
    const ensHombro = new Ensamblador();
    anadirBrazo(ensHombro, prop, paleta.tela, paleta.piel, orco);
    ensHombro.volcarEn(nodos.hombro[lado], banco, `campesino-brazo${lado}`);

    const ensCodo = new Ensamblador();
    anadirAntebrazoYMano(ensCodo, prop, orco ? paleta.piel : paleta.tela, orco ? 'piel' : 'mate');
    ensCodo.volcarEn(nodos.codo[lado], banco, `campesino-antebrazo${lado}`);

    const ensArma = new Ensamblador();
    anadirMano(ensArma, prop, paleta.piel);
    if (lado === 1) anadirHerramienta(ensArma, paleta, 0.92);
    ensArma.volcarEn(nodos.arma[lado], banco, `campesino-mano${lado}`);
  }

  for (const lado of [0, 1] as const) {
    const ensCadera = new Ensamblador();
    anadirPierna(ensCadera, prop, paleta.telaOscura, 'mate');
    ensCadera.volcarEn(nodos.cadera[lado], banco, `campesino-muslo${lado}`);

    const ensRodilla = new Ensamblador();
    anadirPantorrillaYBota(ensRodilla, prop, paleta.telaOscura, 'mate', paleta.cueroOscuro);
    ensRodilla.volcarEn(nodos.rodilla[lado], banco, `campesino-pantorrilla${lado}`);
  }

  return {
    plantilla: nodos.raiz,
    altura: prop.alturaCadera + prop.alturaHombro + prop.radioCabeza * 2.1,
    perfil: perfilPara(TipoUnidad.CAMPESINO, bando),
    tipoRig: 'biped',
  };
}

function construirSoldado(bando: Bando, banco: BancoMateriales): PlantillaUnidad {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const prop = proporcionesPara(TipoUnidad.SOLDADO, bando);
  const nodos = crearEsqueletoBipedo(prop, `soldado-${bando}`, true);

  const ensTorso = new Ensamblador();
  anadirTorso(ensTorso, prop, orco ? 'piel' : 'metal', orco ? paleta.piel : paleta.metal, paleta.cueroOscuro);
  // Pauldrones: la placa de hombro es lo único que además lleva el color de bando,
  // como una capa corta, para no teñir la coraza entera.
  const peto = cajaEn(prop.anchoHombros * 0.5, prop.alturaHombro * 0.34, prop.fondoTorso * 0.35, 0, prop.alturaHombro * 0.62, prop.fondoTorso * 0.42, paleta.bandera);
  ensTorso.anadir(peto, 'mate', { detalle: 1 });
  ensTorso.volcarEn(nodos.torso, banco, 'soldado-torso');

  const ensCabeza = new Ensamblador();
  anadirCabeza(ensCabeza, prop, paleta, orco, 'yelmo');
  ensCabeza.volcarEn(nodos.cabeza, banco, 'soldado-cabeza');

  for (const lado of [0, 1] as const) {
    const ensHombro = new Ensamblador();
    anadirBrazo(ensHombro, prop, paleta.tela, paleta.piel, orco);
    if (orco) {
      // Hombrera de hierro tosco solo en el brazo del arma: un toque de metal sobre
      // la piel desnuda, no una armadura completa.
      const hombrera = cupula(prop.radioBrazoSup * 1.2, paleta.metalOscuro, 8, 5);
      hombrera.rotateX(Math.PI);
      mover(hombrera, 0, -0.01, 0);
      ensHombro.anadir(hombrera, 'metal', { detalle: 1 });
    }
    ensHombro.volcarEn(nodos.hombro[lado], banco, `soldado-brazo${lado}`);

    const ensCodo = new Ensamblador();
    anadirAntebrazoYMano(ensCodo, prop, orco ? paleta.piel : paleta.metal, orco ? 'piel' : 'metal');
    ensCodo.volcarEn(nodos.codo[lado], banco, `soldado-antebrazo${lado}`);

    const ensArma = new Ensamblador();
    anadirMano(ensArma, prop, paleta.piel);
    if (lado === 1) {
      if (orco) anadirHacha(ensArma, paleta, 1.05);
      else anadirEspada(ensArma, paleta, 1);
    } else {
      anadirEscudo(ensArma, paleta, 1, !orco);
    }
    ensArma.volcarEn(nodos.arma[lado], banco, `soldado-mano${lado}`);
  }

  for (const lado of [0, 1] as const) {
    const ensCadera = new Ensamblador();
    anadirPierna(ensCadera, prop, orco ? paleta.piel : paleta.telaOscura, orco ? 'piel' : 'mate');
    ensCadera.volcarEn(nodos.cadera[lado], banco, `soldado-muslo${lado}`);

    const ensRodilla = new Ensamblador();
    anadirPantorrillaYBota(ensRodilla, prop, orco ? paleta.cuero : paleta.metal, orco ? 'mate' : 'metal', paleta.cueroOscuro);
    ensRodilla.volcarEn(nodos.rodilla[lado], banco, `soldado-pantorrilla${lado}`);
  }

  return {
    plantilla: nodos.raiz,
    altura: prop.alturaCadera + prop.alturaHombro + prop.radioCabeza * 2.3,
    perfil: perfilPara(TipoUnidad.SOLDADO, bando),
    tipoRig: 'biped',
  };
}

function construirArquero(bando: Bando, banco: BancoMateriales): PlantillaUnidad {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const prop = proporcionesPara(TipoUnidad.ARQUERO, bando);
  const nodos = crearEsqueletoBipedo(prop, `arquero-${bando}`, true);

  const ensTorso = new Ensamblador();
  anadirTorso(ensTorso, prop, 'mate', variarColor(paleta.cuero, 0.04), paleta.cueroOscuro);
  ensTorso.volcarEn(nodos.torso, banco, 'arquero-torso');

  const ensCabeza = new Ensamblador();
  anadirCabeza(ensCabeza, prop, paleta, orco, 'capucha');
  ensCabeza.volcarEn(nodos.cabeza, banco, 'arquero-cabeza');

  for (const lado of [0, 1] as const) {
    const ensHombro = new Ensamblador();
    anadirBrazo(ensHombro, prop, paleta.cuero, paleta.piel, orco);
    ensHombro.volcarEn(nodos.hombro[lado], banco, `arquero-brazo${lado}`);

    const ensCodo = new Ensamblador();
    anadirAntebrazoYMano(ensCodo, prop, orco ? paleta.piel : paleta.cuero, orco ? 'piel' : 'mate');
    ensCodo.volcarEn(nodos.codo[lado], banco, `arquero-antebrazo${lado}`);

    const ensArma = new Ensamblador();
    anadirMano(ensArma, prop, paleta.piel);
    if (orco) {
      // El lanzador de hachas orco lleva un hacha en cada mano: una lista para
      // lanzar, la otra de reserva.
      anadirHachaArrojadiza(ensArma, paleta, 0.95);
    } else if (lado === 0) {
      anadirArco(ensArma, paleta, 1);
    } else {
      anadirFlecha(ensArma, paleta, 0.5);
    }
    ensArma.volcarEn(nodos.arma[lado], banco, `arquero-mano${lado}`);
  }

  for (const lado of [0, 1] as const) {
    const ensCadera = new Ensamblador();
    anadirPierna(ensCadera, prop, orco ? paleta.piel : paleta.telaOscura, orco ? 'piel' : 'mate');
    ensCadera.volcarEn(nodos.cadera[lado], banco, `arquero-muslo${lado}`);

    const ensRodilla = new Ensamblador();
    anadirPantorrillaYBota(ensRodilla, prop, paleta.telaOscura, 'mate', paleta.cueroOscuro);
    ensRodilla.volcarEn(nodos.rodilla[lado], banco, `arquero-pantorrilla${lado}`);
  }

  return {
    plantilla: nodos.raiz,
    altura: prop.alturaCadera + prop.alturaHombro + prop.radioCabeza * 2.2,
    perfil: perfilPara(TipoUnidad.ARQUERO, bando),
    tipoRig: 'biped',
  };
}

// --- Jinete: jinete bípedo reducido + montura cuadrúpeda ---

interface NodosMontura {
  raiz: THREE.Group;
  cuerpo: THREE.Group;
  pata: readonly [THREE.Group, THREE.Group, THREE.Group, THREE.Group];
  cola: THREE.Group;
  jinete: NodosBipedo;
}

function crearEsqueletoJinete(prop: ProporcionesBipedo, alturaLomo: number, largoMontura: number, nombreRaiz: string): NodosMontura {
  const raiz = nodo(nombreRaiz);
  const cuerpo = nodo('cuerpo');
  raiz.add(cuerpo);

  const patas: THREE.Group[] = [];
  const offsetsX: number[] = [-0.16, 0.16, -0.16, 0.16];
  const offsetsZ: number[] = [largoMontura * 0.32, largoMontura * 0.32, -largoMontura * 0.32, -largoMontura * 0.32];
  for (let i = 0; i < 4; i++) {
    const pata = nodo(`pata${i}`, offsetsX[i], alturaLomo, offsetsZ[i]);
    cuerpo.add(pata);
    patas.push(pata);
  }

  const cola = nodo('cola', 0, alturaLomo * 0.85, -largoMontura * 0.52);
  cuerpo.add(cola);

  // El jinete se monta como un bípedo reducido: mismas piernas y torso, sin nodo de
  // rodilla independiente (van fijas, abrazando la montura), colgado del lomo.
  const jineteRaiz = nodo('jinete', 0, alturaLomo, largoMontura * 0.05);
  cuerpo.add(jineteRaiz);
  const jinete = crearEsqueletoBipedoInterno(prop, jineteRaiz, true);

  return {
    raiz,
    cuerpo,
    pata: [patas[0]!, patas[1]!, patas[2]!, patas[3]!],
    cola,
    jinete,
  };
}

/** Variante de `crearEsqueletoBipedo` que cuelga de un nodo raíz ya existente. */
function crearEsqueletoBipedoInterno(prop: ProporcionesBipedo, raiz: THREE.Group, conCapa: boolean): NodosBipedo {
  const cuerpo = nodo('cuerpo');
  raiz.add(cuerpo);

  const torso = nodo('torso', 0, prop.alturaCadera * 0.25, 0);
  cuerpo.add(torso);

  const cabeza = nodo('cabeza', 0, prop.alturaHombro, 0);
  torso.add(cabeza);

  const hombro: [THREE.Group, THREE.Group] = [
    nodo('hombroI', -prop.anchoHombros / 2, prop.alturaHombro * 0.92, prop.fondoTorso * 0.04),
    nodo('hombroD', prop.anchoHombros / 2, prop.alturaHombro * 0.92, prop.fondoTorso * 0.04),
  ];
  torso.add(hombro[0], hombro[1]);

  const codo: [THREE.Group, THREE.Group] = [
    nodo('codoI', 0, -prop.largoBrazoSup, 0),
    nodo('codoD', 0, -prop.largoBrazoSup, 0),
  ];
  hombro[0].add(codo[0]);
  hombro[1].add(codo[1]);

  const arma: [THREE.Group, THREE.Group] = [
    nodo('armaI', 0, -prop.largoBrazoInf, 0),
    nodo('armaD', 0, -prop.largoBrazoInf, 0),
  ];
  codo[0].add(arma[0]);
  codo[1].add(arma[1]);

  // Piernas fijas: cuelgan a los lados de la montura sin nodo de rodilla animado.
  const cadera: [THREE.Group, THREE.Group] = [
    nodo('caderaI', -prop.anchoCadera * 0.75, prop.alturaCadera * 0.25, 0),
    nodo('caderaD', prop.anchoCadera * 0.75, prop.alturaCadera * 0.25, 0),
  ];
  cuerpo.add(cadera[0], cadera[1]);
  const rodilla: [THREE.Group, THREE.Group] = [
    nodo('rodillaI', 0, -prop.largoMuslo * 0.6, prop.largoMuslo * 0.3),
    nodo('rodillaD', 0, -prop.largoMuslo * 0.6, prop.largoMuslo * 0.3),
  ];
  cadera[0].add(rodilla[0]);
  cadera[1].add(rodilla[1]);

  let capa: THREE.Group | null = null;
  if (conCapa) {
    capa = nodo('capa', 0, prop.alturaHombro * 0.9, -prop.fondoTorso * 0.42);
    torso.add(capa);
  }

  return { raiz, cuerpo, torso, cabeza, hombro, codo, arma, cadera, rodilla, capa };
}

function resolverNodosJinete(raizClon: THREE.Object3D): NodosMontura {
  const g = (n: string): THREE.Group => raizClon.getObjectByName(n) as THREE.Group;
  const jineteRaiz = g('jinete');
  return {
    raiz: raizClon as THREE.Group,
    cuerpo: g('cuerpo'),
    pata: [g('pata0'), g('pata1'), g('pata2'), g('pata3')],
    cola: g('cola'),
    jinete: resolverNodosBipedo(jineteRaiz),
  };
}

function construirJinete(bando: Bando, banco: BancoMateriales): PlantillaUnidad {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const prop = proporcionesPara(TipoUnidad.JINETE, bando);

  const largoMontura = orco ? 0.72 : 0.85;
  const altoMontura = orco ? 0.5 : 0.62;
  const nodos = crearEsqueletoJinete(prop, altoMontura, largoMontura, `jinete-${bando}`);

  // --- Montura ---
  const colorPelaje = orco ? 0x4a4a48 : 0x6b4a30;
  const colorPelajeOscuro = orco ? 0x2c2c2b : 0x4a3320;

  const ensCuerpo = new Ensamblador();
  const torsoMontura = prisma(
    altoMontura * 0.62,
    largoMontura * 1.05,
    altoMontura * 0.5,
    largoMontura * 0.85,
    altoMontura * 0.62,
    colorPelaje,
  );
  girarX(torsoMontura, Math.PI / 2);
  mover(torsoMontura, 0, altoMontura * 0.72, 0);
  ensCuerpo.anadir(torsoMontura, 'facetado', { sombra: true });

  const cuello = prisma(altoMontura * 0.34, altoMontura * 0.34, altoMontura * 0.24, altoMontura * 0.24, altoMontura * 0.55, colorPelaje);
  girarX(cuello, orco ? -0.5 : -0.75);
  mover(cuello, 0, altoMontura * 1.02, largoMontura * 0.42);
  ensCuerpo.anadir(cuello, 'facetado', { sombra: true });

  const cabezaMontura = orco
    ? cono(altoMontura * 0.22, altoMontura * 0.42, colorPelaje, 7)
    : prisma(altoMontura * 0.2, altoMontura * 0.24, altoMontura * 0.1, altoMontura * 0.14, altoMontura * 0.42, colorPelaje);
  girarX(cabezaMontura, Math.PI / 2 - (orco ? 0.3 : 0.15));
  mover(cabezaMontura, 0, altoMontura * (orco ? 1.5 : 1.55), largoMontura * (orco ? 0.78 : 0.9));
  ensCuerpo.anadir(cabezaMontura, 'facetado', { sombra: true });

  if (orco) {
    for (const lado of [-1, 1]) {
      const oreja = cono(0.03, 0.09, colorPelajeOscuro, 5);
      mover(oreja, lado * 0.05, altoMontura * 1.72, largoMontura * 0.72);
      ensCuerpo.anadir(oreja, 'facetado', { detalle: 1 });
    }
  } else {
    for (const lado of [-1, 1]) {
      const oreja = cono(0.025, 0.1, colorPelajeOscuro, 5);
      mover(oreja, lado * 0.045, altoMontura * 1.78, largoMontura * 0.85);
      ensCuerpo.anadir(oreja, 'facetado', { detalle: 1 });
    }
    // Crin.
    const crin = prisma(0.02, altoMontura * 0.3, 0.02, altoMontura * 0.05, altoMontura * 0.7, colorPelajeOscuro);
    girarX(crin, -0.7);
    mover(crin, 0, altoMontura * 1.35, largoMontura * 0.55);
    ensCuerpo.anadir(crin, 'facetado', { detalle: 1 });
  }

  // Gualdrapa: silla de montar en el color de bando.
  const gualdrapa = cajaEn(altoMontura * 0.58, altoMontura * 0.14, largoMontura * 0.62, 0, altoMontura * 1.04, 0, paleta.bandera);
  ensCuerpo.anadir(gualdrapa, 'mate', { detalle: 1 });

  ensCuerpo.volcarEn(nodos.cuerpo, banco, 'jinete-montura');

  const ensCola = new Ensamblador();
  const cola = cono(0.05, largoMontura * 0.55, colorPelajeOscuro, 6);
  girarX(cola, Math.PI * 0.42);
  mover(cola, 0, -largoMontura * 0.1, -largoMontura * 0.05);
  ensCola.anadir(cola, 'facetado', { sombra: false });
  ensCola.volcarEn(nodos.cola, banco, 'jinete-cola');

  const radioPata = altoMontura * 0.09;
  for (let i = 0; i < 4; i++) {
    const ens = new Ensamblador();
    const muslo = miembro(radioPata * 1.1, altoMontura * 0.55, colorPelaje);
    ens.anadir(muslo, 'facetado', { sombra: true });
    const pezuna = cajaEn(radioPata * 1.8, radioPata * 1.2, radioPata * 2, 0, -altoMontura * 0.55 + radioPata * 0.5, radioPata * 0.4, colorPelajeOscuro);
    ens.anadir(pezuna, 'mate', { detalle: 1 });
    ens.volcarEn(nodos.pata[i], banco, `jinete-pata${i}`);
  }

  // --- Jinete ---
  const j = nodos.jinete;
  const ensTorso = new Ensamblador();
  anadirTorso(ensTorso, prop, orco ? 'piel' : 'metal', orco ? paleta.piel : paleta.metal, paleta.cueroOscuro);
  ensTorso.volcarEn(j.torso, banco, 'jinete-torso');

  const ensCabeza = new Ensamblador();
  anadirCabeza(ensCabeza, prop, paleta, orco, 'yelmo');
  ensCabeza.volcarEn(j.cabeza, banco, 'jinete-cabeza');

  for (const lado of [0, 1] as const) {
    const ensHombro = new Ensamblador();
    anadirBrazo(ensHombro, prop, paleta.tela, paleta.piel, orco);
    ensHombro.volcarEn(j.hombro[lado], banco, `jinete-brazo${lado}`);

    const ensCodo = new Ensamblador();
    anadirAntebrazoYMano(ensCodo, prop, orco ? paleta.piel : paleta.metal, orco ? 'piel' : 'metal');
    ensCodo.volcarEn(j.codo[lado], banco, `jinete-antebrazo${lado}`);

    const ensArma = new Ensamblador();
    anadirMano(ensArma, prop, paleta.piel);
    if (lado === 1) {
      if (orco) anadirHacha(ensArma, paleta, 1.05);
      else anadirLanza(ensArma, paleta, 1.1, 1.5);
    } else {
      anadirEscudo(ensArma, paleta, 0.85, !orco);
    }
    ensArma.volcarEn(j.arma[lado], banco, `jinete-mano${lado}`);
  }

  for (const lado of [0, 1] as const) {
    const ensCadera = new Ensamblador();
    anadirPierna(ensCadera, prop, orco ? paleta.piel : paleta.telaOscura, orco ? 'piel' : 'mate');
    ensCadera.volcarEn(j.cadera[lado], banco, `jinete-muslo${lado}`);
    const ensRodilla = new Ensamblador();
    anadirPantorrillaYBota(ensRodilla, prop, orco ? paleta.cuero : paleta.metal, orco ? 'mate' : 'metal', paleta.cueroOscuro);
    ensRodilla.volcarEn(j.rodilla[lado], banco, `jinete-pantorrilla${lado}`);
  }

  return {
    plantilla: nodos.raiz,
    altura: altoMontura * 1.85 + prop.radioCabeza * 2,
    perfil: perfilPara(TipoUnidad.JINETE, bando),
    tipoRig: 'jinete',
  };
}

// --- Catapulta / trabuquete: máquina sin bípedo ---

interface NodosMaquina {
  raiz: THREE.Group;
  cuerpo: THREE.Group;
  brazo: THREE.Group;
  ruedas: readonly THREE.Group[];
}

function construirCatapulta(bando: Bando, banco: BancoMateriales): PlantillaUnidad {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);

  const raiz = nodo(`maquina-${bando}`);
  const cuerpo = nodo('cuerpo');
  raiz.add(cuerpo);

  const largo = 0.95;
  const ancho = 0.55;
  const altoChasis = 0.22;
  const ejeBrazoY = orco ? 0.55 : 0.42;
  const ejeBrazoZ = orco ? -largo * 0.18 : 0;

  const brazo = nodo('brazo', 0, ejeBrazoY, ejeBrazoZ);
  cuerpo.add(brazo);

  const ruedas: THREE.Group[] = [];
  for (const lado of [-1, 1]) {
    const rueda = nodo(`rueda${lado > 0 ? 'D' : 'I'}`, (lado * ancho) / 2, 0.18, largo * 0.12);
    cuerpo.add(rueda);
    ruedas.push(rueda);
  }

  const ensChasis = new Ensamblador();
  const base = cajaEn(ancho, altoChasis, largo, 0, 0.18, 0, paleta.maderaOscura);
  ensChasis.anadir(base, 'mate', { sombra: true });

  const largueroIzq = cajaEn(0.06, 0.5, largo * 0.9, -ancho * 0.42, 0.5, 0, paleta.madera);
  const largueroDer = cajaEn(0.06, 0.5, largo * 0.9, ancho * 0.42, 0.5, 0, paleta.madera);
  ensChasis.anadir(largueroIzq, 'mate', { sombra: true });
  ensChasis.anadir(largueroDer, 'mate', { sombra: true });

  if (orco) {
    // El trabuquete orco lleva un cráneo clavado en la proa: decoración cruda.
    const craneo = esfera(0.08, paleta.hueso, 8, 6);
    mover(craneo, 0, 0.42, -largo * 0.46);
    ensChasis.anadir(craneo, 'mate', { detalle: 0 });
  } else {
    // Refuerzos de acero en las esquinas del chasis humano.
    for (const lado of [-1, 1]) {
      const refuerzo = cajaEn(0.08, 0.5, 0.08, (lado * ancho) / 2 - lado * 0.04, 0.5, largo * 0.44, paleta.metal);
      ensChasis.anadir(refuerzo, 'metal', { detalle: 1 });
    }
  }

  ensChasis.volcarEn(cuerpo, banco, 'catapulta-chasis');

  const ensBrazo = new Ensamblador();
  if (orco) {
    // Trabuquete: brazo largo, contrapeso corto atrás, honda larga adelante.
    const viga = cilindro(0.05, 0.06, 1.1, paleta.maderaOscura, 6);
    girarX(viga, Math.PI / 2);
    mover(viga, 0, 0, 0.35);
    ensBrazo.anadir(viga, 'mate', { sombra: true });
    const contrapeso = cajaEn(0.26, 0.26, 0.22, 0, 0, -0.65, paleta.piedraOscura);
    ensBrazo.anadir(contrapeso, 'facetado', { sombra: true });
    const honda = cajaEn(0.16, 0.05, 0.22, 0, -0.02, 0.9, paleta.cueroOscuro);
    ensBrazo.anadir(honda, 'mate', { detalle: 1 });
  } else {
    // Onagro: brazo corto con cuchara al frente, torsión de cuerdas en la base.
    const viga = cilindro(0.045, 0.055, 0.85, paleta.madera, 6);
    girarX(viga, Math.PI / 2);
    mover(viga, 0, 0, 0.3);
    ensBrazo.anadir(viga, 'mate', { sombra: true });
    const cuchara = cono(0.14, 0.16, paleta.metalOscuro, 8);
    girarX(cuchara, Math.PI);
    mover(cuchara, 0, 0.05, 0.75);
    ensBrazo.anadir(cuchara, 'metal', { sombra: true });
    const torsion = toro(0.1, 0.03, paleta.cueroOscuro, 5, 10);
    girarY(torsion, Math.PI / 2);
    ensBrazo.anadir(torsion, 'mate', { detalle: 1 });
  }
  // Proyectil de piedra a la espera.
  const roca = esfera(0.09, paleta.piedra, 7, 5);
  mover(roca, 0, 0.02, orco ? 0.9 : 0.75);
  ensBrazo.anadir(roca, 'facetado', { detalle: 1 });

  ensBrazo.volcarEn(brazo, banco, 'catapulta-brazo');

  for (let i = 0; i < ruedas.length; i++) {
    const ens = new Ensamblador();
    const rueda = cilindro(0.18, 0.18, 0.07, paleta.maderaOscura, 10);
    girarZ(rueda, Math.PI / 2);
    mover(rueda, (i === 0 ? -1 : 1) * 0.02, 0, 0);
    ens.anadir(rueda, 'mate', { sombra: true });
    for (let r = 0; r < 5; r++) {
      const radio = cajaEn(0.02, 0.15, 0.02, 0, 0, 0, paleta.madera);
      girarX(radio, (r / 5) * Math.PI * 2);
      ens.anadir(radio, 'mate', { detalle: 1 });
    }
    ens.volcarEn(ruedas[i]!, banco, `catapulta-rueda${i}`);
  }

  return {
    plantilla: raiz,
    altura: ejeBrazoY + 0.5,
    perfil: perfilPara(TipoUnidad.CATAPULTA, bando),
    tipoRig: 'maquina',
  };
}

function resolverNodosMaquina(raizClon: THREE.Object3D): NodosMaquina {
  const g = (n: string): THREE.Group => raizClon.getObjectByName(n) as THREE.Group;
  return {
    raiz: raizClon as THREE.Group,
    cuerpo: g('cuerpo'),
    brazo: g('brazo'),
    ruedas: [g('ruedaI'), g('ruedaD')],
  };
}

// --- Fábrica ---

export interface FabricaUnidadesInterna {
  crear(tipo: TipoUnidad, bando: Bando): ModeloUnidad;
  liberar(): void;
}

const _pose: PoseEsqueleto = crearPoseEsqueleto();

export function crearFabricaUnidades(banco: BancoMateriales): FabricaUnidadesInterna {
  const plantillas = new Map<string, PlantillaUnidad>();

  function obtenerPlantilla(tipo: TipoUnidad, bando: Bando): PlantillaUnidad {
    const clave = `${tipo}:${bando}`;
    let p = plantillas.get(clave);
    if (!p) {
      switch (tipo) {
        case TipoUnidad.CAMPESINO:
          p = construirCampesino(bando, banco);
          break;
        case TipoUnidad.SOLDADO:
          p = construirSoldado(bando, banco);
          break;
        case TipoUnidad.ARQUERO:
          p = construirArquero(bando, banco);
          break;
        case TipoUnidad.JINETE:
          p = construirJinete(bando, banco);
          break;
        default:
          p = construirCatapulta(bando, banco);
          break;
      }
      plantillas.set(clave, p);
    }
    return p;
  }

  return {
    crear(tipo: TipoUnidad, bando: Bando): ModeloUnidad {
      const base = obtenerPlantilla(tipo, bando);
      const raiz = base.plantilla.clone(true);

      if (base.tipoRig === 'biped') {
        const nodos = resolverNodosBipedo(raiz);
        return {
          raiz,
          altura: base.altura,
          aplicarPose(pose: PoseUnidad): void {
            calcularPose(_pose, pose, base.perfil);
            aplicarPoseEnNodosBipedo(nodos, _pose);
          },
          fijarDetalle(nivel: 0 | 1 | 2): void {
            aplicarDetalle(raiz, nivel);
          },
          liberar(): void {
            raiz.clear();
          },
        };
      }

      if (base.tipoRig === 'jinete') {
        const m = resolverNodosJinete(raiz);
        return {
          raiz,
          altura: base.altura,
          aplicarPose(pose: PoseUnidad): void {
            calcularPose(_pose, pose, base.perfil);
            // Cuerpo y jinete comparten el balanceo/vuelco/altura general.
            m.cuerpo.position.y = _pose.alturaCuerpo;
            m.cuerpo.rotation.set(_pose.vuelcoCuerpo, _pose.giroCuerpo, _pose.balanceoCuerpo);
            aplicarPoseEnNodosBipedo(m.jinete, { ..._pose, alturaCuerpo: 0, balanceoCuerpo: 0, vuelcoCuerpo: 0, giroCuerpo: 0 });

            const t = pose.tiempoGlobal;
            if (pose.estado === EstadoUnidad.CAMINANDO) {
              const f = pose.tiempoEstado * 8 * Math.max(0.4, pose.rapidez) * 0.5;
              for (let i = 0; i < 4; i++) {
                m.pata[i]!.rotation.x = faseCuadrupedo(i, f, 0.7) + flexionCuadrupedo(i, f, 0.5);
              }
              m.cola.rotation.x = Math.sin(f * 0.5) * 0.2 - 0.3;
            } else if (pose.estado === EstadoUnidad.MURIENDO) {
              const caida = limitar01(pose.tiempoEstado / 0.9);
              const giro = salidaAtras(caida, 0.8) * -1.3;
              m.cuerpo.rotation.x = giro;
              for (let i = 0; i < 4; i++) m.pata[i]!.rotation.x = suavizar(caida) * (i < 2 ? 0.9 : -0.5);
              m.cola.rotation.x = -0.2;
            } else {
              const respiro = Math.sin(t * 1.1 + pose.desfase * 6) * 0.03;
              for (let i = 0; i < 4; i++) m.pata[i]!.rotation.x = respiro * (i % 2 === 0 ? 1 : -1) * 0.4;
              m.cola.rotation.x = -0.3 + Math.sin(t * 0.9 + pose.desfase * 5) * 0.15;
            }
          },
          fijarDetalle(nivel: 0 | 1 | 2): void {
            aplicarDetalle(raiz, nivel);
          },
          liberar(): void {
            raiz.clear();
          },
        };
      }

      // Máquina de asedio.
      const m = resolverNodosMaquina(raiz);
      return {
        raiz,
        altura: base.altura,
        aplicarPose(pose: PoseUnidad): void {
          calcularPose(_pose, pose, base.perfil);
          m.cuerpo.position.y = _pose.alturaCuerpo;
          m.cuerpo.rotation.z = _pose.balanceoCuerpo * 0.3;

          if (pose.estado === EstadoUnidad.ATACANDO) {
            m.brazo.rotation.x = -0.3 + _pose.tension * 1.3;
          } else if (pose.estado === EstadoUnidad.CAMINANDO) {
            m.brazo.rotation.x = Math.sin(pose.tiempoGlobal * 3) * 0.03 - 0.3;
            const giroRueda = pose.tiempoGlobal * pose.rapidez * 3.2;
            for (const rueda of m.ruedas) rueda.rotation.z = giroRueda;
          } else if (pose.estado === EstadoUnidad.MURIENDO) {
            const caida = limitar01(pose.tiempoEstado / 1.1);
            m.cuerpo.rotation.z = suavizar(caida) * 0.55;
            m.brazo.rotation.x = -0.3 - suavizar(caida) * 0.6;
          } else {
            m.brazo.rotation.x = -0.3 + Math.sin(pose.tiempoGlobal * 0.8 + pose.desfase * 6) * 0.015;
          }
        },
        fijarDetalle(nivel: 0 | 1 | 2): void {
          aplicarDetalle(raiz, nivel);
        },
        liberar(): void {
          raiz.clear();
        },
      };
    },

    liberar(): void {
      for (const p of plantillas.values()) liberarGeometrias(p.plantilla);
      plantillas.clear();
    },
  };
}
