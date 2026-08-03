import * as THREE from 'three';
import { Bando, TipoEdificio } from '../../sim/tipos';
import { fichaEdificio } from '../../sim/datos/edificios';
import type { ModeloEdificio } from './contrato';
import type { Acabado, Paleta } from './materiales';
import { BancoMateriales, paletaDe, variarColor } from './materiales';
import {
  Ensamblador,
  almenas,
  caja,
  cajaEn,
  cilindro,
  cono,
  empalizada,
  esfera,
  girarX,
  girarY,
  girarZ,
  liberarGeometrias,
  mover,
  nodo,
  pilaTroncos,
  prisma,
  techoDosAguas,
} from './piezas';

/**
 * Modelos de edificios.
 *
 * Mismo patrón que las unidades: una plantilla por tipo+bando, compartida entre
 * todas las instancias vía `clone(true)`, con los nodos localizados por nombre.
 * Los edificios no se animan por rotación de piezas, pero sí cambian de aspecto en
 * tres ejes que no pueden tocar el material compartido —el color de vértice ya está
 * horneado y un material es de toda la escena—: progreso de obra, daño y nivel de
 * detalle se resuelven todos con visibilidad y escala de nodos, nunca mutando el
 * `MeshStandardMaterial` del banco.
 *
 * Jerarquía de cada plantilla:
 *   raiz
 *    ├─ cimientos   (siempre visible: la losa y la tierra removida)
 *    ├─ andamio     (visible mientras la obra no ha terminado)
 *    └─ estructura  (el edificio acabado; su escala Y sigue el progreso de obra)
 *         ├─ ...piezas normales...
 *         └─ ...piezas de daño, ocultas hasta que `fijarDanio` las revela...
 */

interface NodosEdificio {
  raiz: THREE.Group;
  cimientos: THREE.Group;
  andamio: THREE.Group;
  estructura: THREE.Group;
}

function crearEsqueletoEdificio(nombre: string): NodosEdificio {
  const raiz = nodo(nombre);
  const cimientos = nodo('cimientos');
  const andamio = nodo('andamio');
  const estructura = nodo('estructura');
  raiz.add(cimientos, andamio, estructura);
  return { raiz, cimientos, andamio, estructura };
}

function resolverNodosEdificio(raizClon: THREE.Object3D): NodosEdificio {
  const g = (n: string): THREE.Group => raizClon.getObjectByName(n) as THREE.Group;
  return {
    raiz: raizClon as THREE.Group,
    cimientos: g('cimientos'),
    andamio: g('andamio'),
    estructura: g('estructura'),
  };
}

function aplicarDetalle(raiz: THREE.Object3D, nivel: 0 | 1 | 2): void {
  raiz.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (!(m as THREE.Mesh).isMesh) return;
    const d = (m.userData.detalle as 0 | 1 | 2 | undefined) ?? 2;
    m.visible = d >= nivel;
  });
}

// --- Cimientos y andamio: comunes a todos los edificios ---

function construirCimientos(ancho: number, fondo: number, banco: BancoMateriales, nombre: string, target: THREE.Group): void {
  const ens = new Ensamblador();
  const losa = cajaEn(ancho * 1.06, 0.08, fondo * 1.06, 0, -0.02, 0, 0x6b6255);
  ens.anadir(losa, 'mate', { sombra: false });
  ens.volcarEn(target, banco, `${nombre}-cimientos`);
}

/** Andamio genérico: postes en las esquinas, travesaños y una plataforma a media altura. */
function construirAndamio(
  ancho: number,
  fondo: number,
  alto: number,
  banco: BancoMateriales,
  nombre: string,
  target: THREE.Group,
): void {
  const ens = new Ensamblador();
  const colorPalo = 0x8a6a3c;
  const esquinas: Array<[number, number]> = [
    [-ancho / 2, -fondo / 2],
    [ancho / 2, -fondo / 2],
    [-ancho / 2, fondo / 2],
    [ancho / 2, fondo / 2],
  ];
  for (const [x, z] of esquinas) {
    const poste = cilindro(0.035, 0.045, alto * 1.05, colorPalo, 6);
    mover(poste, x, 0, z);
    ens.anadir(poste, 'mate', { sombra: true });
  }
  // Travesaños horizontales a dos alturas y la plataforma de trabajo.
  for (const y of [alto * 0.4, alto * 0.75]) {
    for (const [x1, z1, x2, z2] of [
      [-ancho / 2, -fondo / 2, ancho / 2, -fondo / 2],
      [-ancho / 2, fondo / 2, ancho / 2, fondo / 2],
      [-ancho / 2, -fondo / 2, -ancho / 2, fondo / 2],
      [ancho / 2, -fondo / 2, ancho / 2, fondo / 2],
    ] as Array<[number, number, number, number]>) {
      const dx = x2 - x1;
      const dz = z2 - z1;
      const largo = Math.hypot(dx, dz);
      const travesano = cilindro(0.022, 0.022, largo, colorPalo, 5);
      girarZ(travesano, Math.PI / 2);
      girarY(travesano, Math.atan2(dz, dx) + Math.PI / 2);
      mover(travesano, (x1 + x2) / 2, y, (z1 + z2) / 2);
      ens.anadir(travesano, 'mate', { detalle: 1 });
    }
  }
  const plataforma = cajaEn(ancho * 0.94, 0.03, fondo * 0.3, 0, alto * 0.42, -fondo * 0.3, colorPalo);
  ens.anadir(plataforma, 'mate', { detalle: 1 });
  ens.volcarEn(target, banco, `${nombre}-andamio`);
}

// --- Daño: piezas discretas que se revelan por fracción, sin tocar el material ---

function anadirDanio(
  estructura: THREE.Group,
  ancho: number,
  fondo: number,
  altoMuro: number,
  paleta: Paleta,
  banco: BancoMateriales,
  nombre: string,
): void {
  const grietas = nodo('danio-grietas');
  const ensG = new Ensamblador();
  for (let i = 0; i < 3; i++) {
    const grieta = cajaEn(0.02, altoMuro * 0.55, 0.06, ancho * (0.2 * i - 0.2), altoMuro * 0.4, fondo / 2 + 0.01, 0x1a1712);
    girarZ(grieta, (i - 1) * 0.25);
    ensG.anadir(grieta, 'mate', { detalle: 0 });
  }
  ensG.volcarEn(grietas, banco, `${nombre}-grietas`);
  grietas.visible = false;
  estructura.add(grietas);

  const escombros = nodo('danio-escombros', 0, 0, fondo / 2 + 0.35);
  const ensE = new Ensamblador();
  for (let i = 0; i < 5; i++) {
    const trozo = caja(0.14 + (i % 2) * 0.06, 0.1, 0.14, variarColor(paleta.piedraOscura, (i % 3) * 0.06 - 0.06));
    mover(trozo, (i - 2) * 0.14, 0.05, (i % 2) * 0.12);
    girarY(trozo, i * 0.7);
    ensE.anadir(trozo, 'facetado', { sombra: false });
  }
  ensE.volcarEn(escombros, banco, `${nombre}-escombros`);
  escombros.visible = false;
  estructura.add(escombros);

  const agujero = nodo('danio-agujero');
  const ensA = new Ensamblador();
  const boquete = cajaEn(ancho * 0.26, altoMuro * 0.34, 0.1, ancho * 0.1, altoMuro * 0.42, fondo / 2, 0x0c0a08);
  ensA.anadir(boquete, 'mate', { detalle: 0 });
  ensA.volcarEn(agujero, banco, `${nombre}-agujero`);
  agujero.visible = false;
  estructura.add(agujero);
}

interface RefsDanio {
  grietas: THREE.Object3D | null;
  escombros: THREE.Object3D | null;
  agujero: THREE.Object3D | null;
  tejadoIntacto: THREE.Object3D | null;
  tejadoHundido: THREE.Object3D | null;
}

function resolverDanio(estructura: THREE.Object3D): RefsDanio {
  return {
    grietas: estructura.getObjectByName('danio-grietas') ?? null,
    escombros: estructura.getObjectByName('danio-escombros') ?? null,
    agujero: estructura.getObjectByName('danio-agujero') ?? null,
    tejadoIntacto: estructura.getObjectByName('tejado-intacto') ?? null,
    tejadoHundido: estructura.getObjectByName('tejado-hundido') ?? null,
  };
}

function aplicarDanio(refs: RefsDanio, fraccion: number): void {
  if (refs.grietas) refs.grietas.visible = fraccion > 0.2;
  if (refs.escombros) {
    refs.escombros.visible = fraccion > 0.35;
    const s = 0.55 + Math.min(1, fraccion) * 0.6;
    refs.escombros.scale.setScalar(s);
  }
  if (refs.agujero) refs.agujero.visible = fraccion > 0.68;
  if (refs.tejadoHundido && refs.tejadoIntacto) {
    const hundido = fraccion > 0.55;
    refs.tejadoIntacto.visible = !hundido;
    refs.tejadoHundido.visible = hundido;
  }
}

// --- Tejado hundido: variante deformada del tejado a dos aguas, para el daño alto ---

function anadirTejados(
  ancho: number,
  fondo: number,
  altoBase: number,
  altoTejado: number,
  grosor: number,
  colorFaldon: number,
  colorHastial: number,
  acabado: Acabado,
  estructura: THREE.Group,
  banco: BancoMateriales,
  nombre: string,
): void {
  // Tejado intacto: se vuelca en su propio nodo con nombre para poder ocultarlo.
  const intacto = nodo('tejado-intacto', 0, altoBase, 0);
  const ensI = new Ensamblador();
  ensI.anadir(techoDosAguas(ancho, fondo, altoTejado, grosor, colorFaldon, colorHastial), acabado, { sombra: true });
  ensI.volcarEn(intacto, banco, `${nombre}-tejado`);
  estructura.add(intacto);

  // Tejado hundido: el mismo techo aplastado y ladeado, con una brecha oscura en el
  // centro. Se aprovecha la misma silueta para que el cambio se lea como daño y no
  // como un edificio distinto.
  const hundido = nodo('tejado-hundido', 0, altoBase, 0);
  const ensH = new Ensamblador();
  const techoRoto = techoDosAguas(ancho, fondo, altoTejado * 0.55, grosor, variarColor(colorFaldon, -0.18), colorHastial);
  techoRoto.rotateZ(0.09);
  ensH.anadir(techoRoto, acabado, { sombra: true });
  const brecha = cajaEn(ancho * 0.32, altoTejado * 0.5, fondo * 0.4, 0, altoTejado * 0.2, 0, 0x0c0a08);
  ensH.anadir(brecha, 'mate', { detalle: 0 });
  ensH.volcarEn(hundido, banco, `${nombre}-tejado-roto`);
  hundido.visible = false;
  estructura.add(hundido);
}

// --- Construcción por tipo ---

function construirAyuntamiento(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.AYUNTAMIENTO).huella * 0.86;
  const nombre = `ayuntamiento-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const altoMuro = orco ? 1.5 : 1.75;
  const altoTejado = orco ? 1.1 : 1.35;

  construirCimientos(huella, huella, banco, nombre, n.cimientos);
  construirAndamio(huella, huella, altoMuro + altoTejado, banco, nombre, n.andamio);

  const ens = new Ensamblador();
  const cuerpoPrincipal = prisma(huella, huella, huella * 0.92, huella * 0.92, altoMuro, orco ? paleta.madera : paleta.piedra);
  ens.anadir(cuerpoPrincipal, orco ? 'facetado' : 'mate', { sombra: true });

  // Variación de sillares/tablones: cuatro franjas de tono ligeramente distinto.
  for (let i = 0; i < 4; i++) {
    const franja = cajaEn(
      huella * 0.995,
      altoMuro * 0.18,
      0.01,
      0,
      altoMuro * (0.15 + i * 0.2),
      huella / 2 + 0.005,
      variarColor(orco ? paleta.madera : paleta.piedra, (i % 2 === 0 ? 1 : -1) * 0.04),
    );
    ens.anadir(franja, orco ? 'facetado' : 'mate', { detalle: 1 });
  }

  const puerta = cajaEn(huella * 0.28, altoMuro * 0.62, 0.1, 0, altoMuro * 0.31, huella / 2, 0x2a1c10);
  ens.anadir(puerta, 'mate', { detalle: 1 });

  if (orco) {
    // Cráneo de trofeo sobre el dintel y postes con calaveras a los lados.
    const craneo = esfera(huella * 0.07, paleta.hueso, 8, 6);
    mover(craneo, 0, altoMuro * 0.7, huella / 2 + 0.05);
    ens.anadir(craneo, 'mate', { detalle: 0 });
    for (const lado of [-1, 1]) {
      const poste = cilindro(0.04, 0.05, altoMuro * 1.3, paleta.maderaOscura, 6);
      mover(poste, (lado * huella) / 2 + lado * 0.15, 0, huella / 2 + 0.1);
      ens.anadir(poste, 'mate', { sombra: true });
      const calavera = esfera(0.09, paleta.hueso, 7, 5);
      mover(calavera, (lado * huella) / 2 + lado * 0.15, altoMuro * 1.28, huella / 2 + 0.1);
      ens.anadir(calavera, 'mate', { detalle: 0 });
    }
  } else {
    // Almenas rematando el muro y un estandarte en un mástil corto.
    const corona = almenas(huella * 1.0, huella * 1.0, altoMuro * 0.14, 0.07, paleta.piedraOscura);
    mover(corona, 0, altoMuro, 0);
    ens.anadir(corona, 'mate', { detalle: 1 });
  }

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);

  anadirTejados(
        huella * 0.98,
    huella * 0.98,
    altoMuro,
    altoTejado,
    0.05,
    orco ? paleta.tejado : paleta.tejado,
    orco ? paleta.tejadoOscuro : paleta.tejadoOscuro,
    orco ? 'facetado' : 'mate',
    n.estructura,
    banco,
    nombre,
  );

  // Mástil y estandarte, siempre en el color de bando: la seña de identidad del
  // edificio más importante de la base.
  const ensMastil = new Ensamblador();
  const mastil = cilindro(0.02, 0.025, altoTejado * 1.2, 0x5c4023, 6);
  mover(mastil, 0, altoMuro + altoTejado * 0.3, 0);
  ensMastil.anadir(mastil, 'mate', { sombra: true });
  const bandera = cajaEn(0.28, 0.4, 0.015, 0.15, altoMuro + altoTejado * 1.1, 0, paleta.bandera);
  ensMastil.anadir(bandera, 'mate', { detalle: 1 });
  ensMastil.volcarEn(n.estructura, banco, `${nombre}-estandarte`);

  anadirDanio(n.estructura, huella, huella, altoMuro, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoMuro + altoTejado };
}

function construirGranja(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.GRANJA).huella * 0.82;
  const nombre = `granja-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const altoMuro = orco ? 0.62 : 0.72;
  const altoTejado = orco ? 0.55 : 0.62;

  construirCimientos(huella, huella, banco, nombre, n.cimientos);
  construirAndamio(huella, huella, altoMuro + altoTejado, banco, nombre, n.andamio);

  const ens = new Ensamblador();
  const cuerpo = caja(huella, altoMuro, huella, orco ? paleta.madera : variarColor(paleta.piedraClara, 0.03));
  mover(cuerpo, 0, altoMuro / 2, 0);
  ens.anadir(cuerpo, orco ? 'facetado' : 'mate', { sombra: true });

  const puerta = cajaEn(huella * 0.34, altoMuro * 0.66, 0.06, 0, altoMuro * 0.33, huella / 2, 0x2a1c10);
  ens.anadir(puerta, 'mate', { detalle: 1 });

  // Cerca perimetral: legible como granja incluso sin animales.
  for (let i = -1; i <= 1; i += 2) {
    const poste = cilindro(0.02, 0.02, 0.28, paleta.maderaOscura, 5);
    mover(poste, (i * huella) / 1.6, 0, huella / 2 + 0.3);
    ens.anadir(poste, 'mate', { detalle: 1 });
  }
  const barrote = cajaEn(huella * 1.1, 0.03, 0.02, 0, 0.2, huella / 2 + 0.3, paleta.maderaOscura);
  ens.anadir(barrote, 'mate', { detalle: 1 });

  if (orco) {
    const craneo = esfera(0.06, paleta.hueso, 6, 5);
    mover(craneo, 0, altoMuro + 0.02, huella / 2 - 0.05);
    ens.anadir(craneo, 'mate', { detalle: 0 });
  }

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);

  anadirTejados(
        huella * 1.02,
    huella * 1.02,
    altoMuro,
    altoTejado,
    0.035,
    paleta.tejado,
    paleta.tejadoOscuro,
    orco ? 'facetado' : 'mate',
    n.estructura,
    banco,
    nombre,
  );

  anadirDanio(n.estructura, huella, huella, altoMuro, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoMuro + altoTejado };
}

function construirBarracon(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.BARRACON).huella * 0.84;
  const nombre = `barracon-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const ancho = huella;
  const fondo = huella * 1.15;
  const altoMuro = orco ? 1.05 : 1.2;
  const altoTejado = orco ? 0.7 : 0.85;

  construirCimientos(ancho, fondo, banco, nombre, n.cimientos);
  construirAndamio(ancho, fondo, altoMuro + altoTejado, banco, nombre, n.andamio);

  const ens = new Ensamblador();

  if (orco) {
    // Fosa de combate: empalizada rodeando un foso hundido, sin tejado propiamente.
    const foso = cilindro(ancho * 0.46, ancho * 0.5, altoMuro * 0.3, variarColor(paleta.maderaOscura, -0.1), 10);
    mover(foso, 0, -altoMuro * 0.15, 0);
    ens.anadir(foso, 'facetado', { sombra: false });
    const muroInterior = cilindro(ancho * 0.5, ancho * 0.46, altoMuro * 0.55, paleta.maderaOscura, 10);
    ens.anadir(muroInterior, 'facetado', { sombra: true });

    const cabana = prisma(ancho * 0.5, fondo * 0.4, ancho * 0.42, fondo * 0.36, altoMuro * 0.9, paleta.madera);
    mover(cabana, 0, 0, -fondo * 0.28);
    ens.anadir(cabana, 'facetado', { sombra: true });

    const empal = empalizada(ancho * 1.08, fondo * 1.08, altoMuro * 1.1, 0.045, paleta.maderaOscura, bando * 97 + 3);
    ens.anadir(empal, 'facetado', { sombra: true });

    for (const lado of [-1, 1]) {
      const totem = cilindro(0.05, 0.06, altoMuro * 1.7, paleta.maderaOscura, 6);
      mover(totem, (lado * ancho) / 2.1, 0, fondo / 2);
      ens.anadir(totem, 'mate', { sombra: true });
      const craneo = esfera(0.09, paleta.hueso, 7, 5);
      mover(craneo, (lado * ancho) / 2.1, altoMuro * 1.65, fondo / 2);
      ens.anadir(craneo, 'mate', { detalle: 0 });
    }
  } else {
    const cuerpo = prisma(ancho, fondo, ancho * 0.94, fondo * 0.94, altoMuro, paleta.piedra);
    ens.anadir(cuerpo, 'mate', { sombra: true });

    const corona = almenas(ancho * 0.99, fondo * 0.99, altoMuro * 0.12, 0.06, paleta.piedraOscura);
    mover(corona, 0, altoMuro, 0);
    ens.anadir(corona, 'mate', { detalle: 1 });

    const puerta = cajaEn(ancho * 0.3, altoMuro * 0.6, 0.08, 0, altoMuro * 0.3, fondo / 2, 0x2a1c10);
    ens.anadir(puerta, 'mate', { detalle: 1 });

    // Rack de armas junto a la puerta: dos lanzas cruzadas y un escudo.
    for (const lado of [-1, 1]) {
      const lanza = cilindro(0.014, 0.014, 0.62, paleta.maderaOscura, 5);
      girarZ(lanza, lado * 0.35);
      mover(lanza, (lado * ancho) / 3, 0.31, fondo / 2 + 0.06);
      ens.anadir(lanza, 'mate', { detalle: 1 });
    }
    const estandarte = cajaEn(0.02, 0.5, 0.34, ancho * 0.4, altoMuro * 0.75, fondo / 2 + 0.03, paleta.bandera);
    ens.anadir(estandarte, 'mate', { detalle: 1 });
  }

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);

  if (!orco) {
    anadirTejados(
      ancho * 1.0,
      fondo * 1.0,
      altoMuro,
      altoTejado,
      0.045,
      paleta.tejado,
      paleta.tejadoOscuro,
      'mate',
      n.estructura,
      banco,
      nombre,
    );
  }

  anadirDanio(n.estructura, ancho, fondo, altoMuro, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoMuro + (orco ? altoMuro * 0.6 : altoTejado) };
}

function construirAserradero(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.ASERRADERO).huella * 0.84;
  const nombre = `aserradero-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const ancho = huella;
  const fondo = huella;
  const altoMuro = orco ? 0.85 : 0.95;
  const altoTejado = orco ? 0.55 : 0.65;

  construirCimientos(ancho, fondo, banco, nombre, n.cimientos);
  construirAndamio(ancho, fondo, altoMuro + altoTejado, banco, nombre, n.andamio);

  const ens = new Ensamblador();
  const cuerpo = prisma(ancho * 0.72, fondo * 0.6, ancho * 0.68, fondo * 0.56, altoMuro, orco ? paleta.madera : paleta.piedra);
  mover(cuerpo, 0, 0, -fondo * 0.16);
  ens.anadir(cuerpo, orco ? 'facetado' : 'mate', { sombra: true });

  const puerta = cajaEn(ancho * 0.24, altoMuro * 0.6, 0.06, 0, altoMuro * 0.3, -fondo * 0.16 + fondo * 0.3, 0x2a1c10);
  ens.anadir(puerta, 'mate', { detalle: 1 });

  // La sierra circular: la firma visual del aserradero, siempre a la vista.
  const sierra = cilindro(ancho * 0.16, ancho * 0.16, 0.025, paleta.metal, 14);
  girarX(sierra, Math.PI / 2);
  mover(sierra, ancho * 0.28, altoMuro * 0.55, fondo * 0.26);
  ens.anadir(sierra, 'metal', { sombra: true });
  const soporteSierra = cilindro(0.03, 0.035, altoMuro * 0.55, paleta.maderaOscura, 6);
  mover(soporteSierra, ancho * 0.28, 0, fondo * 0.26);
  ens.anadir(soporteSierra, 'mate', { detalle: 1 });

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);

  const ensTroncos = new Ensamblador();
  ensTroncos.anadir(
    pilaTroncos(3, fondo * 0.62, ancho * 0.075, paleta.madera, variarColor(paleta.madera, -0.25)),
    'facetado',
    { sombra: true },
  );
  const nodoTroncos = nodo('pila-troncos', -ancho * 0.28, 0, fondo * 0.14);
  ensTroncos.volcarEn(nodoTroncos, banco, `${nombre}-troncos`);
  n.estructura.add(nodoTroncos);

  if (!orco) {
    anadirTejados(
      ancho * 0.76,
      fondo * 0.64,
      altoMuro,
      altoTejado,
      0.035,
      paleta.tejado,
      paleta.tejadoOscuro,
      'mate',
      n.estructura,
      banco,
      nombre,
    );
    // El techo se centra sobre el cuerpo, desplazado igual que él.
    const tejadoIntacto = n.estructura.getObjectByName('tejado-intacto');
    const tejadoRoto = n.estructura.getObjectByName('tejado-hundido');
    tejadoIntacto?.position.set(0, altoMuro, -fondo * 0.16);
    tejadoRoto?.position.set(0, altoMuro, -fondo * 0.16);
  } else {
    const ensTecho = new Ensamblador();
    const techoPlano = cajaEn(ancho * 0.78, 0.06, fondo * 0.64, 0, altoMuro, -fondo * 0.16, paleta.tejado);
    ensTecho.anadir(techoPlano, 'facetado', { sombra: true });
    ensTecho.volcarEn(n.estructura, banco, `${nombre}-techo`);
  }

  anadirDanio(n.estructura, ancho * 0.72, fondo * 0.6, altoMuro, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoMuro + altoTejado };
}

function construirTorre(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.TORRE).huella * 0.7;
  const nombre = `torre-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const altoTotal = orco ? 2.6 : 3.1;

  construirCimientos(huella, huella, banco, nombre, n.cimientos);
  construirAndamio(huella, huella, altoTotal, banco, nombre, n.andamio);

  const ens = new Ensamblador();

  if (orco) {
    // Atalaya sobre zancos: una plataforma en alto sostenida por cuatro postes.
    const alturaZancos = altoTotal * 0.62;
    for (const [x, z] of [
      [-huella * 0.36, -huella * 0.36],
      [huella * 0.36, -huella * 0.36],
      [-huella * 0.36, huella * 0.36],
      [huella * 0.36, huella * 0.36],
    ]) {
      const zanco = cilindro(0.05, 0.07, alturaZancos, paleta.maderaOscura, 6);
      mover(zanco, x!, 0, z!);
      ens.anadir(zanco, 'facetado', { sombra: true });
    }
    const plataforma = cajaEn(huella * 0.92, 0.1, huella * 0.92, 0, alturaZancos, 0, paleta.madera);
    ens.anadir(plataforma, 'facetado', { sombra: true });
    const cabina = prisma(huella * 0.7, huella * 0.7, huella * 0.5, huella * 0.5, altoTotal * 0.3, paleta.madera);
    mover(cabina, 0, alturaZancos, 0);
    ens.anadir(cabina, 'facetado', { sombra: true });
    const techo = cono(huella * 0.55, altoTotal * 0.16, paleta.tejado, 6);
    mover(techo, 0, alturaZancos + altoTotal * 0.3, 0);
    ens.anadir(techo, 'facetado', { sombra: true });
    const craneo = esfera(0.09, paleta.hueso, 7, 5);
    mover(craneo, 0, alturaZancos + 0.05, huella / 2);
    ens.anadir(craneo, 'mate', { detalle: 0 });
    for (const lado of [-1, 1]) {
      const empalDeco = cilindro(0.025, 0.03, 0.4, paleta.maderaOscura, 5);
      girarZ(empalDeco, lado * 0.15);
      mover(empalDeco, (lado * huella) / 2, 0, huella / 2);
      ens.anadir(empalDeco, 'facetado', { detalle: 1 });
    }
  } else {
    const fuste = prisma(huella, huella, huella * 0.78, huella * 0.78, altoTotal * 0.82, paleta.piedra);
    ens.anadir(fuste, 'mate', { sombra: true });
    for (let i = 0; i < 3; i++) {
      const franja = cajaEn(huella * 0.995, altoTotal * 0.1, 0.01, 0, altoTotal * (0.2 + i * 0.24), huella / 2 + 0.005, variarColor(paleta.piedra, (i % 2 === 0 ? 1 : -1) * 0.04));
      ens.anadir(franja, 'mate', { detalle: 1 });
    }
    for (const lado of [-1, 1]) {
      const aspillera = cajaEn(0.04, huella * 0.22, 0.1, (lado * huella) / 3, altoTotal * 0.5, huella / 2, 0x141210);
      ens.anadir(aspillera, 'mate', { detalle: 1 });
    }
    const corona = almenas(huella * 0.86, huella * 0.86, altoTotal * 0.1, 0.055, paleta.piedraOscura);
    mover(corona, 0, altoTotal * 0.82, 0);
    ens.anadir(corona, 'mate', { detalle: 1 });
    const mastil = cilindro(0.018, 0.02, altoTotal * 0.2, 0x5c4023, 5);
    mover(mastil, 0, altoTotal * 0.82, 0);
    ens.anadir(mastil, 'mate', { sombra: false });
    const bandera = cajaEn(0.2, 0.28, 0.012, 0.1, altoTotal * 0.94, 0, paleta.bandera);
    ens.anadir(bandera, 'mate', { detalle: 1 });
  }

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);
  anadirDanio(n.estructura, huella, huella, altoTotal * 0.7, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoTotal };
}

function construirHerreria(bando: Bando, banco: BancoMateriales): { plantilla: THREE.Group; altura: number } {
  const orco = bando === Bando.ORCOS;
  const paleta = paletaDe(bando);
  const huella = fichaEdificio(TipoEdificio.HERRERIA).huella * 0.84;
  const nombre = `herreria-${bando}`;
  const n = crearEsqueletoEdificio(nombre);

  const ancho = huella;
  const fondo = huella * 0.9;
  const altoMuro = orco ? 0.85 : 0.98;
  const altoTejado = orco ? 0.5 : 0.6;

  construirCimientos(ancho, fondo, banco, nombre, n.cimientos);
  construirAndamio(ancho, fondo, altoMuro + altoTejado, banco, nombre, n.andamio);

  const ens = new Ensamblador();
  const cuerpo = prisma(ancho, fondo, ancho * 0.94, fondo * 0.94, altoMuro, orco ? paleta.madera : paleta.piedra);
  ens.anadir(cuerpo, orco ? 'facetado' : 'mate', { sombra: true });

  const puerta = cajaEn(ancho * 0.26, altoMuro * 0.62, 0.06, 0, altoMuro * 0.31, fondo / 2, 0x2a1c10);
  ens.anadir(puerta, 'mate', { detalle: 1 });

  // Chimenea con brasas: el acabado 'brillo' ya lleva emisión horneada en el
  // material compartido, así que el rescoldo brilla sin tocar ningún material.
  const chimenea = cilindro(0.09, 0.11, altoMuro * 1.3, orco ? paleta.piedraOscura : paleta.piedra, 8);
  mover(chimenea, ancho * 0.34, 0, -fondo * 0.3);
  ens.anadir(chimenea, orco ? 'facetado' : 'mate', { sombra: true });
  const brasas = esfera(0.05, 0xff7a1a, 8, 6);
  mover(brasas, ancho * 0.34, altoMuro * 1.28, -fondo * 0.3);
  ens.anadir(brasas, 'brillo', { detalle: 0 });

  // Yunque frente a la puerta: identifica la herrería a cualquier distancia.
  const yunqueBase = cilindro(0.05, 0.06, 0.16, paleta.maderaOscura, 6);
  mover(yunqueBase, 0, 0, fondo / 2 + 0.3);
  ens.anadir(yunqueBase, 'mate', { detalle: 1 });
  const yunqueCuerpo = prisma(0.16, 0.08, 0.2, 0.05, 0.1, paleta.metalOscuro);
  mover(yunqueCuerpo, 0, 0.16, fondo / 2 + 0.3);
  ens.anadir(yunqueCuerpo, 'metal', { sombra: true });

  if (orco) {
    const craneo = esfera(0.07, paleta.hueso, 7, 5);
    mover(craneo, -ancho * 0.3, altoMuro + 0.02, 0);
    ens.anadir(craneo, 'mate', { detalle: 0 });
  }

  ens.volcarEn(n.estructura, banco, `${nombre}-cuerpo`);

  anadirTejados(
        ancho * 1.02,
    fondo * 1.02,
    altoMuro,
    altoTejado,
    0.04,
    paleta.tejado,
    paleta.tejadoOscuro,
    orco ? 'facetado' : 'mate',
    n.estructura,
    banco,
    nombre,
  );

  anadirDanio(n.estructura, ancho, fondo, altoMuro, paleta, banco, nombre);

  return { plantilla: n.raiz, altura: altoMuro + altoTejado };
}

// --- Fábrica ---

export interface FabricaEdificiosInterna {
  crear(tipo: TipoEdificio, bando: Bando): ModeloEdificio;
  liberar(): void;
}

export function crearFabricaEdificios(banco: BancoMateriales): FabricaEdificiosInterna {
  const plantillas = new Map<string, { plantilla: THREE.Group; altura: number }>();

  function obtener(tipo: TipoEdificio, bando: Bando): { plantilla: THREE.Group; altura: number } {
    const clave = `${tipo}:${bando}`;
    let p = plantillas.get(clave);
    if (!p) {
      switch (tipo) {
        case TipoEdificio.AYUNTAMIENTO:
          p = construirAyuntamiento(bando, banco);
          break;
        case TipoEdificio.GRANJA:
          p = construirGranja(bando, banco);
          break;
        case TipoEdificio.BARRACON:
          p = construirBarracon(bando, banco);
          break;
        case TipoEdificio.ASERRADERO:
          p = construirAserradero(bando, banco);
          break;
        case TipoEdificio.TORRE:
          p = construirTorre(bando, banco);
          break;
        default:
          p = construirHerreria(bando, banco);
          break;
      }
      plantillas.set(clave, p);
    }
    return p;
  }

  return {
    crear(tipo: TipoEdificio, bando: Bando): ModeloEdificio {
      const base = obtener(tipo, bando);
      const raiz = base.plantilla.clone(true);
      const nodos = resolverNodosEdificio(raiz);
      const danio = resolverDanio(nodos.estructura);

      let ultimoProgreso = -1;

      return {
        raiz,
        altura: base.altura,
        fijarProgresoObra(progreso: number): void {
          if (progreso === ultimoProgreso) return;
          ultimoProgreso = progreso;
          nodos.estructura.scale.y = Math.max(0.05, progreso);
          nodos.estructura.visible = progreso > 0.02;
          nodos.andamio.visible = progreso < 0.97;
        },
        fijarDanio(fraccion: number): void {
          aplicarDanio(danio, fraccion);
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
