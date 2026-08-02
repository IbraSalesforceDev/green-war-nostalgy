import { Azar } from '../core/rng';
import { limitar, ruidoFractal } from '../core/math';
import { MapaJuego } from './mapa';
import { Bloqueo, TipoCasilla } from './tipos';

/**
 * Generador de mapas de escaramuza.
 *
 * Genera mapas rotacionalmente simétricos: lo que hay en (x, z) se copia en
 * (ancho-1-x, alto-1-z). La simetría no es un capricho estético, es la única forma
 * honesta de que una escaramuza 1 contra 1 se decida por el juego y no por a quién
 * le tocó la esquina con más oro.
 */

export interface PuntoInicio {
  /** Casilla donde nace el ayuntamiento (esquina de su huella). */
  cx: number;
  cz: number;
  /** Veta de oro principal asignada a esta base. */
  minaX: number;
  minaZ: number;
}

export interface MapaGenerado {
  mapa: MapaJuego;
  inicios: PuntoInicio[];
  /** Casillas con árbol, para que la fábrica cree los yacimientos. */
  arboles: Array<[number, number]>;
  /** Casillas con veta de oro. */
  minas: Array<[number, number]>;
  /** Rocas decorativas que además bloquean el paso. */
  rocas: Array<[number, number]>;
}

export interface OpcionesGeneracion {
  ancho: number;
  alto: number;
  semilla: number;
  /** Densidad de bosque, de 0 a 1. */
  densidadBosque?: number;
  /** Cuántos niveles de altura como máximo. */
  nivelesMaximos?: number;
}

export function generarMapa(opciones: OpcionesGeneracion): MapaGenerado {
  const { ancho, alto, semilla } = opciones;
  const densidadBosque = opciones.densidadBosque ?? 0.34;
  const nivelesMaximos = opciones.nivelesMaximos ?? 2;

  const mapa = new MapaJuego(ancho, alto);
  const azar = new Azar(semilla);

  // Las bases van en esquinas opuestas, retiradas del borde para que quepa la economía.
  const margen = 12;
  const inicios: PuntoInicio[] = [
    { cx: margen, cz: margen, minaX: margen + 7, minaZ: margen + 2 },
    {
      cx: ancho - margen - 4,
      cz: alto - margen - 4,
      minaX: ancho - margen - 8,
      minaZ: alto - margen - 3,
    },
  ];

  generarRelieve(mapa, semilla, nivelesMaximos, inicios);
  generarAgua(mapa, semilla);
  tallarAcantilados(mapa);
  abrirRampas(mapa, azar);

  const arboles = sembrarBosque(mapa, semilla, densidadBosque, inicios);
  const minas = colocarMinas(mapa, inicios, azar);
  const rocas = esparcirRocas(mapa, azar, inicios);

  aplanarZonasDeInicio(mapa, inicios);
  sellarBordes(mapa);
  marcarBloqueosDeTerreno(mapa);

  // Ni árboles ni rocas deben tapar la salida de una base recién nacida.
  const arbolesFiltrados = arboles.filter(([x, z]) => !cercaDeInicio(x, z, inicios, 7));
  const rocasFiltradas = rocas.filter(([x, z]) => !cercaDeInicio(x, z, inicios, 9));

  return { mapa, inicios, arboles: arbolesFiltrados, minas, rocas: rocasFiltradas };
}

// --- Fases de generación ---

function generarRelieve(
  mapa: MapaJuego,
  semilla: number,
  nivelesMaximos: number,
  inicios: PuntoInicio[],
): void {
  const escala = 0.055;

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);

      // Ruido simetrizado: se promedia el valor del punto con el de su reflejo, así
      // el relieve queda idéntico para ambos jugadores sin que se note el espejo.
      const rx = mapa.ancho - 1 - cx;
      const rz = mapa.alto - 1 - cz;
      const a = ruidoFractal(cx * escala, cz * escala, 4, 0.5, 2, semilla);
      const b = ruidoFractal(rx * escala, rz * escala, 4, 0.5, 2, semilla);
      let h = (a + b) * 0.5;

      // Aplanamos alrededor de las bases antes incluso de cuantizar: una base sobre
      // una ladera es una fuente inagotable de edificios imposibles de colocar.
      const suavizado = factorAplanado(cx, cz, inicios, 10, 16);
      h = h * (1 - suavizado) + 0.42 * suavizado;

      const nivel = Math.floor(limitar(h, 0, 0.999) * (nivelesMaximos + 1));
      mapa.niveles[i] = Math.min(nivel, nivelesMaximos);
      mapa.casillas[i] = TipoCasilla.HIERBA;
      mapa.variacion[i] = Math.floor(ruidoFractal(cx * 0.7, cz * 0.7, 2, 0.5, 2, semilla + 91) * 255);
    }
  }
}

function generarAgua(mapa: MapaJuego, semilla: number): void {
  const escala = 0.038;
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      if (mapa.niveles[i] > 0) continue;

      const rx = mapa.ancho - 1 - cx;
      const rz = mapa.alto - 1 - cz;
      const a = ruidoFractal(cx * escala + 100, cz * escala + 100, 3, 0.5, 2, semilla + 7);
      const b = ruidoFractal(rx * escala + 100, rz * escala + 100, 3, 0.5, 2, semilla + 7);
      const valor = (a + b) * 0.5;

      if (valor < 0.31) {
        mapa.casillas[i] = TipoCasilla.AGUA_PROFUNDA;
      } else if (valor < 0.36) {
        mapa.casillas[i] = TipoCasilla.AGUA_BAJA;
      }
    }
  }
}

/**
 * Marca como acantilado toda casilla de nivel alto que linde con una más baja.
 * Es lo que convierte un cambio de altura en una pared visible y en una barrera real.
 */
function tallarAcantilados(mapa: MapaJuego): void {
  const original = new Uint8Array(mapa.niveles);
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      if (mapa.casillas[i] === TipoCasilla.AGUA_PROFUNDA) continue;
      const nivel = original[i];
      let esBorde = false;
      for (let d = 0; d < 4 && !esBorde; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const nz = cz + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!mapa.dentro(nx, nz)) continue;
        if (original[mapa.indice(nx, nz)] < nivel) esBorde = true;
      }
      if (esBorde) mapa.casillas[i] = TipoCasilla.ACANTILADO;
    }
  }
}

/**
 * Abre rampas en los acantilados.
 * Sin rampas el mapa se parte en mesetas incomunicadas; con demasiadas, la altura deja
 * de significar nada. Una cada doce casillas de borde es un buen término medio.
 */
function abrirRampas(mapa: MapaJuego, azar: Azar): void {
  const candidatas: number[] = [];
  for (let cz = 1; cz < mapa.alto - 1; cz++) {
    for (let cx = 1; cx < mapa.ancho - 1; cx++) {
      const i = mapa.indice(cx, cz);
      if (mapa.casillas[i] !== TipoCasilla.ACANTILADO) continue;
      candidatas.push(i);
    }
  }

  azar.barajar(candidatas);
  const cuantas = Math.floor(candidatas.length / 12);

  for (let k = 0; k < cuantas; k++) {
    const i = candidatas[k]!;
    const cx = i % mapa.ancho;
    const cz = Math.floor(i / mapa.ancho);

    // Una rampa ocupa un pequeño parche para que quepan unidades en formación.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (!mapa.dentro(x, z)) continue;
        const j = mapa.indice(x, z);
        if (mapa.casillas[j] === TipoCasilla.AGUA_PROFUNDA) continue;
        mapa.casillas[j] = TipoCasilla.TIERRA;
        mapa.rampas[j] = 1;
      }
    }
  }
}

function sembrarBosque(
  mapa: MapaJuego,
  semilla: number,
  densidad: number,
  inicios: PuntoInicio[],
): Array<[number, number]> {
  const arboles: Array<[number, number]> = [];
  const escala = 0.09;

  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      const i = mapa.indice(cx, cz);
      const tipo = mapa.casillas[i];
      if (tipo !== TipoCasilla.HIERBA) continue;
      if (mapa.rampas[i] === 1) continue;

      const rx = mapa.ancho - 1 - cx;
      const rz = mapa.alto - 1 - cz;
      const a = ruidoFractal(cx * escala + 50, cz * escala + 50, 3, 0.55, 2, semilla + 23);
      const b = ruidoFractal(rx * escala + 50, rz * escala + 50, 3, 0.55, 2, semilla + 23);
      const valor = (a + b) * 0.5;

      // Cerca de las bases el bosque se aclara: cada jugador necesita sitio para construir.
      const despeje = factorAplanado(cx, cz, inicios, 8, 14);
      if (valor > 1 - densidad + despeje * 0.5) {
        mapa.casillas[i] = TipoCasilla.BOSQUE;
        arboles.push([cx, cz]);
      }
    }
  }

  return arboles;
}

function colocarMinas(
  mapa: MapaJuego,
  inicios: PuntoInicio[],
  azar: Azar,
): Array<[number, number]> {
  const minas: Array<[number, number]> = [];

  // Una veta garantizada junto a cada base.
  for (const inicio of inicios) {
    const punto = buscarSitioLlano(mapa, inicio.minaX, inicio.minaZ, 6);
    if (punto) {
      minas.push(punto);
      inicio.minaX = punto[0];
      inicio.minaZ = punto[1];
    }
  }

  // Vetas de expansión, en pares simétricos para no favorecer a nadie.
  const objetivos = 3;
  let intentos = 0;
  while (minas.length < inicios.length + objetivos * 2 && intentos < 400) {
    intentos++;
    const cx = azar.entero(6, Math.floor(mapa.ancho / 2));
    const cz = azar.entero(6, mapa.alto - 7);
    const punto = buscarSitioLlano(mapa, cx, cz, 4);
    if (!punto) continue;
    if (cercaDeInicio(punto[0], punto[1], inicios, 14)) continue;
    if (minas.some(([mx, mz]) => Math.hypot(mx - punto[0], mz - punto[1]) < 14)) continue;

    const espejo: [number, number] = [mapa.ancho - 1 - punto[0], mapa.alto - 1 - punto[1]];
    if (!mapa.dentro(espejo[0], espejo[1])) continue;

    minas.push(punto, espejo);
  }

  return minas;
}

function esparcirRocas(
  mapa: MapaJuego,
  azar: Azar,
  inicios: PuntoInicio[],
): Array<[number, number]> {
  const rocas: Array<[number, number]> = [];
  const cuantas = Math.floor((mapa.ancho * mapa.alto) / 900);

  for (let k = 0; k < cuantas; k++) {
    const cx = azar.entero(3, Math.floor(mapa.ancho / 2));
    const cz = azar.entero(3, mapa.alto - 4);
    const i = mapa.indice(cx, cz);
    if (mapa.casillas[i] !== TipoCasilla.HIERBA) continue;
    if (cercaDeInicio(cx, cz, inicios, 10)) continue;

    rocas.push([cx, cz]);
    const ex = mapa.ancho - 1 - cx;
    const ez = mapa.alto - 1 - cz;
    if (mapa.dentro(ex, ez) && mapa.casillas[mapa.indice(ex, ez)] === TipoCasilla.HIERBA) {
      rocas.push([ex, ez]);
    }
  }

  return rocas;
}

/** Deja un claro de tierra pisada alrededor de cada base. */
function aplanarZonasDeInicio(mapa: MapaJuego, inicios: PuntoInicio[]): void {
  for (const inicio of inicios) {
    const centroX = inicio.cx + 2;
    const centroZ = inicio.cz + 2;
    const nivel = mapa.nivelEn(centroX, centroZ);
    const radio = 8;

    for (let dz = -radio; dz <= radio; dz++) {
      for (let dx = -radio; dx <= radio; dx++) {
        const cx = centroX + dx;
        const cz = centroZ + dz;
        if (!mapa.dentro(cx, cz)) continue;
        if (dx * dx + dz * dz > radio * radio) continue;
        const i = mapa.indice(cx, cz);
        mapa.niveles[i] = nivel;
        mapa.rampas[i] = 0;
        if (mapa.casillas[i] !== TipoCasilla.BOSQUE) {
          // El centro queda como tierra batida; el anillo exterior vuelve a hierba.
          mapa.casillas[i] = dx * dx + dz * dz < 20 ? TipoCasilla.TIERRA : TipoCasilla.HIERBA;
        }
      }
    }
  }
}

/** Un anillo de roca infranqueable impide que las unidades salgan del mapa. */
function sellarBordes(mapa: MapaJuego): void {
  for (let cz = 0; cz < mapa.alto; cz++) {
    for (let cx = 0; cx < mapa.ancho; cx++) {
      if (cx > 1 && cz > 1 && cx < mapa.ancho - 2 && cz < mapa.alto - 2) continue;
      const i = mapa.indice(cx, cz);
      mapa.casillas[i] = TipoCasilla.ROCA;
      mapa.niveles[i] = Math.max(mapa.niveles[i], 1);
    }
  }
}

function marcarBloqueosDeTerreno(mapa: MapaJuego): void {
  for (let i = 0; i < mapa.numCasillas; i++) {
    const tipo = mapa.casillas[i] as TipoCasilla;
    const bloquea =
      tipo === TipoCasilla.ROCA ||
      tipo === TipoCasilla.ACANTILADO ||
      tipo === TipoCasilla.AGUA_PROFUNDA;
    if (bloquea) mapa.bloqueos[i] |= Bloqueo.TERRENO;
  }
}

// --- Auxiliares ---

/** 1 en el centro de una base, 0 más allá de `radioExterior`. */
function factorAplanado(
  cx: number,
  cz: number,
  inicios: PuntoInicio[],
  radioInterior: number,
  radioExterior: number,
): number {
  let maximo = 0;
  for (const inicio of inicios) {
    const d = Math.hypot(cx - (inicio.cx + 2), cz - (inicio.cz + 2));
    if (d >= radioExterior) continue;
    const t = 1 - limitar((d - radioInterior) / (radioExterior - radioInterior), 0, 1);
    if (t > maximo) maximo = t;
  }
  return maximo;
}

function cercaDeInicio(
  cx: number,
  cz: number,
  inicios: PuntoInicio[],
  radio: number,
): boolean {
  for (const inicio of inicios) {
    if (Math.hypot(cx - (inicio.cx + 2), cz - (inicio.cz + 2)) < radio) return true;
  }
  return false;
}

/** Busca en espiral una casilla de hierba o tierra libre cerca del punto dado. */
function buscarSitioLlano(
  mapa: MapaJuego,
  cx: number,
  cz: number,
  radioMaximo: number,
): [number, number] | null {
  const aceptable = (x: number, z: number): boolean => {
    if (!mapa.dentro(x, z)) return false;
    const t = mapa.casillas[mapa.indice(x, z)] as TipoCasilla;
    return t === TipoCasilla.HIERBA || t === TipoCasilla.TIERRA;
  };

  if (aceptable(cx, cz)) return [cx, cz];
  for (let r = 1; r <= radioMaximo; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (aceptable(cx + dx, cz + dz)) return [cx + dx, cz + dz];
      }
    }
  }
  return null;
}
