import * as THREE from 'three';
import { hash2 } from '../../core/math';
import { PALETA_NEUTRAL } from './materiales';
import { BancoMateriales, variarColor } from './materiales';
import {
  Ensamblador,
  cilindro,
  cono,
  esfera,
  girarX,
  girarZ,
  liberarGeometrias,
  mover,
  nodo,
  roca as rocaGeo,
} from './piezas';

/**
 * Adornos del mapa: árboles, rocas, tocones y vetas de oro.
 *
 * Cada clave tiene una única geometría base compartida; la variedad entre
 * instancias viene de la `semilla` (el índice de la entidad, ya determinista) que
 * escala y gira ligeramente cada copia sin generar una malla nueva por objeto.
 */

export interface FabricaAdornosInterna {
  crear(clave: string, semilla: number): THREE.Object3D;
  liberar(): void;
}

function construirPino(banco: BancoMateriales): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('pino');

  const ens = new Ensamblador();
  const tronco = cilindro(0.05, 0.09, 0.55, paleta.madera, 6);
  ens.anadir(tronco, 'facetado', { sombra: true });

  // Tres conos apilados con solape: la silueta de abeto clásica, mucho más
  // reconocible a distancia que un único cono.
  const alturas = [0.85, 0.95, 0.72];
  const radios = [0.42, 0.32, 0.22];
  let y = 0.42;
  for (let i = 0; i < 3; i++) {
    const copa = cono(radios[i]!, alturas[i]!, variarColor(0x2f5b2c, i * 0.03 - 0.03), 8);
    mover(copa, 0, y, 0);
    ens.anadir(copa, 'facetado', { sombra: true });
    y += alturas[i]! * 0.62;
  }
  ens.volcarEn(raiz, banco, 'pino');
  return raiz;
}

function construirRoble(banco: BancoMateriales): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('roble');

  const ens = new Ensamblador();
  const tronco = cilindro(0.075, 0.13, 0.62, paleta.maderaOscura, 7);
  ens.anadir(tronco, 'facetado', { sombra: true });

  // Copa como aglomerado de esferas facetadas: más orgánica que una sola bola.
  const nucleos: Array<[number, number, number, number]> = [
    [0, 0.95, 0, 0.42],
    [0.28, 0.82, 0.1, 0.3],
    [-0.26, 0.85, -0.14, 0.32],
    [0.05, 1.15, -0.2, 0.3],
    [-0.1, 1.1, 0.22, 0.28],
  ];
  for (const [x, y, z, r] of nucleos) {
    const bola = esfera(r, variarColor(0x3d6b26, hash2(x * 13, z * 7, 3) * 0.1 - 0.05), 8, 6);
    mover(bola, x, y, z);
    ens.anadir(bola, 'facetado', { sombra: true });
  }
  ens.volcarEn(raiz, banco, 'roble');
  return raiz;
}

function construirTocon(banco: BancoMateriales): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('tocon');
  const ens = new Ensamblador();

  const base = cilindro(0.14, 0.17, 0.22, paleta.maderaOscura, 8);
  ens.anadir(base, 'facetado', { sombra: true });
  const corte = cilindro(0.135, 0.135, 0.01, variarColor(paleta.madera, 0.15), 8);
  mover(corte, 0, 0.22, 0);
  ens.anadir(corte, 'facetado', { detalle: 1 });

  // Un par de raíces asomando: rompe el cilindro perfecto.
  for (const lado of [-1, 1]) {
    const raizVisible = cilindro(0.03, 0.05, 0.16, paleta.maderaOscura, 5);
    girarZ(raizVisible, lado * 1.1);
    mover(raizVisible, lado * 0.14, 0.03, 0.05 * lado);
    ens.anadir(raizVisible, 'facetado', { detalle: 1 });
  }

  ens.volcarEn(raiz, banco, 'tocon');
  return raiz;
}

function construirRocaGrande(banco: BancoMateriales, semillaBase: number): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('roca-grande');
  const ens = new Ensamblador();
  const principal = rocaGeo(0.45, paleta.piedra, semillaBase, 0.3, 1);
  ens.anadir(principal, 'facetado', { sombra: true });
  const secundaria = rocaGeo(0.22, variarColor(paleta.piedra, -0.08), semillaBase + 11, 0.32, 1);
  mover(secundaria, 0.32, -0.1, 0.18);
  ens.anadir(secundaria, 'facetado', { sombra: true });
  ens.volcarEn(raiz, banco, 'roca-grande');
  return raiz;
}

function construirRocaPequena(banco: BancoMateriales, semillaBase: number): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('roca-pequena');
  const ens = new Ensamblador();
  const piedra = rocaGeo(0.18, paleta.piedra, semillaBase, 0.34, 0);
  ens.anadir(piedra, 'facetado', { sombra: true });
  ens.volcarEn(raiz, banco, 'roca-pequena');
  return raiz;
}

function construirVetaOro(banco: BancoMateriales, semillaBase: number): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('veta-oro');
  const ens = new Ensamblador();

  const roca1 = rocaGeo(0.5, paleta.piedraOscura, semillaBase, 0.26, 1);
  ens.anadir(roca1, 'facetado', { sombra: true });
  const roca2 = rocaGeo(0.3, variarColor(paleta.piedraOscura, -0.06), semillaBase + 5, 0.3, 1);
  mover(roca2, -0.3, -0.12, -0.2);
  ens.anadir(roca2, 'facetado', { sombra: true });

  // Vetas doradas asomando entre las grietas: 'brillo' ya lleva emisión propia
  // horneada en el material compartido, así que el oro reluce sin luces extra.
  for (let i = 0; i < 5; i++) {
    const angulo = hash2(i, 1, semillaBase) * Math.PI * 2;
    const radio = 0.28 + hash2(i, 2, semillaBase) * 0.18;
    const veta = esfera(0.05 + hash2(i, 3, semillaBase) * 0.04, 0xf0c34a, 7, 5);
    mover(veta, Math.cos(angulo) * radio, 0.05 + hash2(i, 4, semillaBase) * 0.25, Math.sin(angulo) * radio * 0.6);
    ens.anadir(veta, 'brillo', { detalle: 1 });
  }

  ens.volcarEn(raiz, banco, 'veta-oro');
  return raiz;
}

function construirArbusto(banco: BancoMateriales, semillaBase: number): THREE.Object3D {
  const raiz = nodo('arbusto');
  const ens = new Ensamblador();
  for (let i = 0; i < 4; i++) {
    const radio = 0.12 + hash2(i, 6, semillaBase) * 0.06;
    const bola = esfera(radio, variarColor(0x4a7a2e, hash2(i, 8, semillaBase) * 0.08 - 0.04), 7, 5);
    const angulo = (i / 4) * Math.PI * 2;
    mover(bola, Math.cos(angulo) * 0.1, radio * 0.8, Math.sin(angulo) * 0.1);
    ens.anadir(bola, 'facetado', { sombra: false });
  }
  ens.volcarEn(raiz, banco, 'arbusto');
  return raiz;
}

function construirHueso(banco: BancoMateriales): THREE.Object3D {
  const paleta = PALETA_NEUTRAL;
  const raiz = nodo('hueso');
  const ens = new Ensamblador();
  const eje = cilindro(0.025, 0.03, 0.32, paleta.hueso, 6);
  girarX(eje, Math.PI / 2);
  ens.anadir(eje, 'mate', { sombra: false });
  for (const lado of [-1, 1]) {
    for (const desfase of [-0.03, 0.03]) {
      const bulbo = esfera(0.045, paleta.hueso, 6, 5);
      mover(bulbo, desfase, 0, (lado * 0.16));
      ens.anadir(bulbo, 'mate', { detalle: 1 });
    }
  }
  const craneo = esfera(0.09, paleta.hueso, 7, 6);
  mover(craneo, 0.16, 0.03, 0);
  ens.anadir(craneo, 'mate', { sombra: false });
  ens.volcarEn(raiz, banco, 'hueso');
  return raiz;
}

export function crearFabricaAdornos(banco: BancoMateriales): FabricaAdornosInterna {
  const plantillas = new Map<string, THREE.Object3D>();

  function obtener(clave: string, semilla: number): THREE.Object3D {
    let p = plantillas.get(clave);
    if (!p) {
      switch (clave) {
        case 'pino':
          p = construirPino(banco);
          break;
        case 'roble':
          p = construirRoble(banco);
          break;
        case 'tocon':
          p = construirTocon(banco);
          break;
        case 'roca-grande':
          p = construirRocaGrande(banco, semilla);
          break;
        case 'roca-pequena':
        case 'roca':
          p = construirRocaPequena(banco, semilla);
          break;
        case 'mina':
        case 'veta-oro':
          p = construirVetaOro(banco, semilla);
          break;
        case 'arbusto':
          p = construirArbusto(banco, semilla);
          break;
        case 'hueso':
          p = construirHueso(banco);
          break;
        case 'arbol':
        default:
          // Alterna pino/roble determinísticamente: un bosque de un solo árbol
          // repetido se lee de inmediato como artificial.
          p = hash2(semilla, 17, 5) > 0.5 ? construirRoble(banco) : construirPino(banco);
          break;
      }
      plantillas.set(clave, p);
    }
    return p;
  }

  return {
    crear(clave: string, semilla: number): THREE.Object3D {
      const base = obtener(clave, semilla);
      const copia = base.clone(true);
      // Variedad barata: escala y giro deterministas por semilla, sin generar
      // geometría nueva.
      const escala = 0.85 + hash2(semilla, 91, 2) * 0.35;
      copia.scale.setScalar(escala);
      // El giro en Y lo fija `entidades.ts` por índice de entidad; aquí solo se
      // varía el tamaño para no repetir clones idénticos unos junto a otros.
      return copia;
    },

    liberar(): void {
      for (const p of plantillas.values()) liberarGeometrias(p);
      plantillas.clear();
    },
  };
}
