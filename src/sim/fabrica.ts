import { TAU } from '../core/math';
import {
  MADERA_POR_ARBOL,
  ORO_POR_MINA,
  TAM_CASILLA,
  VIDA_INICIAL_OBRA,
} from './constantes';
import { fichaEdificio } from './datos/edificios';
import { fichaUnidad } from './datos/unidades';
import type { MapaGenerado } from './generador';
import { MapaJuego } from './mapa';
import { Mundo } from './mundo';
import {
  BANDOS_JUGABLES,
  Bando,
  Bloqueo,
  Clase,
  ENTIDAD_NULA,
  Entidad,
  EstadoUnidad,
  Orden,
  TipoEdificio,
  TipoRecurso,
  TipoUnidad,
  TipoYacimiento,
  indiceDe,
} from './tipos';

/**
 * Fábrica de entidades.
 *
 * Es el único sitio del proyecto que sabe traducir una ficha (`FichaUnidad`,
 * `FichaEdificio`) a las filas de los arrays paralelos del mundo. Si mañana una
 * unidad gana un campo nuevo, se toca aquí y en ningún otro lugar.
 *
 * También es el dueño del contrato «entidad ↔ rejilla»: quien crea un edificio o un
 * yacimiento marca su huella y su bloqueo, y quien lo retira los limpia. Que esa
 * pareja de operaciones viva en el mismo fichero es lo que evita la plaga clásica de
 * los RTS: casillas fantasma que siguen bloqueadas después de que el edificio muriera.
 */

// --- Ajustes propios de la fábrica (no existían en constantes.ts) ---

/** Campesinos con los que arranca cada bando. */
export const OBREROS_INICIALES = 5;

/** Distancia en casillas a la que nacen los campesinos alrededor del ayuntamiento. */
export const RADIO_APARICION_INICIAL = 3.6;

/** Radios de colisión de lo que no es unidad ni edificio. */
export const RADIO_ARBOL = 0.42;
export const RADIO_MINA = 0.75;
export const RADIO_ADORNO = 0.5;

/** Radio de visión que aporta un yacimiento neutral: ninguno. */
const VISION_YACIMIENTO = 0;

// --- Utilidades públicas ---

export function recursoDeYacimiento(tipo: TipoYacimiento): TipoRecurso {
  return tipo === TipoYacimiento.MINA_ORO ? TipoRecurso.ORO : TipoRecurso.MADERA;
}

export function reservaInicial(tipo: TipoYacimiento): number {
  return tipo === TipoYacimiento.MINA_ORO ? ORO_POR_MINA : MADERA_POR_ARBOL;
}

/** Centro en unidades de mundo de un edificio cuya huella empieza en (cx, cz). */
export function centroDeHuella(cx: number, lado: number): number {
  return (cx + lado * 0.5) * TAM_CASILLA;
}

// --- Creación ---

export function crearUnidad(
  mundo: Mundo,
  tipo: TipoUnidad,
  bando: Bando,
  x: number,
  z: number,
): Entidad {
  const ficha = fichaUnidad(tipo);
  const entidad = mundo.crear(Clase.UNIDAD, bando, x, z);
  if (entidad === ENTIDAD_NULA) return ENTIDAD_NULA;
  const i = indiceDe(entidad);

  mundo.tipo[i] = tipo;
  mundo.radio[i] = ficha.radio;
  mundo.vida[i] = ficha.vida;
  mundo.vidaMaxima[i] = ficha.vida;
  mundo.armadura[i] = ficha.armadura;
  mundo.tipoArmadura[i] = ficha.tipoArmadura;
  mundo.danioMin[i] = ficha.danioMin;
  mundo.danioMax[i] = ficha.danioMax;
  mundo.tipoDanio[i] = ficha.tipoDanio;
  mundo.alcance[i] = ficha.alcance;
  mundo.cadencia[i] = ficha.cadencia;
  mundo.vision[i] = ficha.vision;
  mundo.velocidad[i] = ficha.velocidad;
  mundo.velocidadGiro[i] = ficha.velocidadGiro;
  mundo.huella[i] = 1;
  mundo.casillaX[i] = mundo.mapa.aCasilla(x);
  mundo.casillaZ[i] = mundo.mapa.aCasilla(z);
  mundo.anclaX[i] = x;
  mundo.anclaZ[i] = z;
  mundo.progresoObra[i] = 1;
  mundo.estado[i] = EstadoUnidad.INACTIVO;
  mundo.orden[i] = Orden.NINGUNA;

  const estado = mundo.estadoDe(bando);
  estado.poblacion += ficha.coste.poblacion;

  return entidad;
}

export function crearEdificio(
  mundo: Mundo,
  tipo: TipoEdificio,
  bando: Bando,
  cx: number,
  cz: number,
  terminado = true,
): Entidad {
  const ficha = fichaEdificio(tipo);
  const lado = ficha.huella;
  const x = centroDeHuella(cx, lado);
  const z = centroDeHuella(cz, lado);

  const entidad = mundo.crear(Clase.EDIFICIO, bando, x, z);
  if (entidad === ENTIDAD_NULA) return ENTIDAD_NULA;
  const i = indiceDe(entidad);

  mundo.tipo[i] = tipo;
  // El radio de un edificio es el de su círculo inscrito: sirve para que los obreros
  // y los atacantes se paren en el borde y no intenten meterse dentro.
  mundo.radio[i] = lado * 0.5 * TAM_CASILLA;
  mundo.vidaMaxima[i] = ficha.vida;
  mundo.vida[i] = terminado ? ficha.vida : ficha.vida * VIDA_INICIAL_OBRA;
  mundo.armadura[i] = ficha.armadura;
  mundo.tipoArmadura[i] = ficha.tipoArmadura;
  mundo.danioMin[i] = ficha.danioMin;
  mundo.danioMax[i] = ficha.danioMax;
  mundo.tipoDanio[i] = ficha.tipoDanio;
  mundo.alcance[i] = ficha.alcanceAtaque;
  mundo.cadencia[i] = ficha.cadencia;
  mundo.vision[i] = ficha.vision;
  mundo.velocidad[i] = 0;
  mundo.huella[i] = lado;
  mundo.casillaX[i] = cx;
  mundo.casillaZ[i] = cz;
  mundo.anclaX[i] = x;
  mundo.anclaZ[i] = z;
  mundo.progresoObra[i] = terminado ? 1 : 0;
  mundo.obrerosEnObra[i] = 0;
  mundo.estado[i] = terminado ? EstadoUnidad.INACTIVO : EstadoUnidad.EN_OBRAS;

  mundo.mapa.marcarHuella(
    cx,
    cz,
    lado,
    terminado ? Bloqueo.EDIFICIO : Bloqueo.OBRA,
    entidad,
  );

  if (terminado) registrarEdificioTerminado(mundo, i);

  return entidad;
}

export function crearYacimiento(
  mundo: Mundo,
  tipo: TipoYacimiento,
  cx: number,
  cz: number,
): Entidad {
  const mapa = mundo.mapa;
  if (!mapa.dentro(cx, cz)) return ENTIDAD_NULA;
  // Nunca dos yacimientos en la misma casilla ni encima de un edificio.
  if (mapa.bloqueoEn(cx, cz) !== Bloqueo.LIBRE) return ENTIDAD_NULA;

  const x = mapa.centroCasilla(cx);
  const z = mapa.centroCasilla(cz);
  const entidad = mundo.crear(Clase.YACIMIENTO, Bando.NEUTRAL, x, z);
  if (entidad === ENTIDAD_NULA) return ENTIDAD_NULA;
  const i = indiceDe(entidad);

  mundo.tipo[i] = tipo;
  mundo.radio[i] = tipo === TipoYacimiento.MINA_ORO ? RADIO_MINA : RADIO_ARBOL;
  mundo.vida[i] = 1;
  mundo.vidaMaxima[i] = 1;
  mundo.vision[i] = VISION_YACIMIENTO;
  mundo.huella[i] = 1;
  mundo.casillaX[i] = cx;
  mundo.casillaZ[i] = cz;
  mundo.reserva[i] = reservaInicial(tipo);
  mundo.ocupacionYacimiento[i] = 0;
  mundo.progresoObra[i] = 1;
  mundo.estado[i] = EstadoUnidad.INACTIVO;

  mapa.marcarBloqueo(cx, cz, Bloqueo.YACIMIENTO, entidad);

  return entidad;
}

/**
 * Decoración con presencia real en la rejilla: rocas, tocones, ruinas.
 * `variante` la interpreta el render; la simulación solo necesita saber que ocupa sitio.
 */
export function crearAdorno(
  mundo: Mundo,
  variante: number,
  cx: number,
  cz: number,
  bloquea = true,
): Entidad {
  const mapa = mundo.mapa;
  if (!mapa.dentro(cx, cz)) return ENTIDAD_NULA;
  if (bloquea && mapa.bloqueoEn(cx, cz) !== Bloqueo.LIBRE) return ENTIDAD_NULA;

  const x = mapa.centroCasilla(cx);
  const z = mapa.centroCasilla(cz);
  const entidad = mundo.crear(Clase.ADORNO, Bando.NEUTRAL, x, z);
  if (entidad === ENTIDAD_NULA) return ENTIDAD_NULA;
  const i = indiceDe(entidad);

  mundo.tipo[i] = variante;
  mundo.radio[i] = RADIO_ADORNO;
  mundo.vida[i] = 1;
  mundo.vidaMaxima[i] = 1;
  mundo.huella[i] = 1;
  mundo.casillaX[i] = cx;
  mundo.casillaZ[i] = cz;
  mundo.progresoObra[i] = 1;

  if (bloquea) mapa.marcarBloqueo(cx, cz, Bloqueo.TERRENO, entidad);

  return entidad;
}

// --- Retirada ---

/**
 * Retira una entidad del mundo dejando la rejilla y la contabilidad limpias.
 *
 * Todo el que destruya algo debe pasar por aquí; llamar a `mundo.destruir` a pelo
 * deja la huella marcada para siempre.
 */
export function retirarEntidad(mundo: Mundo, i: number): void {
  const entidad = mundo.entidadDeIndice(i);
  if (entidad === ENTIDAD_NULA) return;

  const clase = mundo.clase[i];
  const mapa = mundo.mapa;

  if (clase === Clase.EDIFICIO) {
    mapa.limpiarHuella(
      mundo.casillaX[i],
      mundo.casillaZ[i],
      mundo.huella[i],
      Bloqueo.EDIFICIO | Bloqueo.OBRA,
    );
    mundo.destruir(entidad);
    recalcularPoblacionMaxima(mundo, mundo.bando[i] as Bando);
    return;
  }

  if (clase === Clase.YACIMIENTO) {
    mapa.limpiarBloqueo(mundo.casillaX[i], mundo.casillaZ[i], Bloqueo.YACIMIENTO);
    mundo.destruir(entidad);
    return;
  }

  if (clase === Clase.ADORNO) {
    mapa.limpiarBloqueo(mundo.casillaX[i], mundo.casillaZ[i], Bloqueo.TERRENO);
    mundo.destruir(entidad);
    return;
  }

  if (clase === Clase.UNIDAD) {
    const ficha = fichaUnidad(mundo.tipo[i] as TipoUnidad);
    const estado = mundo.estadoDe(mundo.bando[i] as Bando);
    estado.poblacion = Math.max(0, estado.poblacion - ficha.coste.poblacion);
    // Un obrero que muere con una veta reservada debe soltarla.
    liberarYacimientoMemorizado(mundo, i);
  }

  mundo.destruir(entidad);
}

/** Devuelve la plaza que el obrero tenía reservada en su yacimiento. */
export function liberarYacimientoMemorizado(mundo: Mundo, i: number): void {
  const yacimiento = mundo.yacimientoMemorizado[i];
  if (yacimiento !== 0 && mundo.esValida(yacimiento)) {
    const y = indiceDe(yacimiento);
    if (mundo.ocupacionYacimiento[y] > 0) mundo.ocupacionYacimiento[y]--;
  }
  mundo.yacimientoMemorizado[i] = 0;
}

// --- Contabilidad de bando ---

/**
 * Registra un edificio recién terminado: desbloquea su rama tecnológica y recalcula
 * el techo de población.
 */
export function registrarEdificioTerminado(mundo: Mundo, i: number): void {
  const bando = mundo.bando[i] as Bando;
  if (bando === Bando.NEUTRAL) return;
  const estado = mundo.estadoDe(bando);
  estado.edificiosDisponibles.add(mundo.tipo[i] as TipoEdificio);
  estado.edificiosConstruidos++;
  recalcularPoblacionMaxima(mundo, bando);
}

/**
 * Recuenta el techo de población desde cero.
 *
 * Recalcular en vez de ir sumando y restando es deliberado: es una operación rara
 * (solo al terminar o perder un edificio) y elimina de raíz cualquier deriva del
 * contador, que en un RTS se traduce en «no puedo entrenar y no sé por qué».
 */
export function recalcularPoblacionMaxima(mundo: Mundo, bando: Bando): void {
  if (bando === Bando.NEUTRAL) return;
  const estado = mundo.estadoDe(bando);
  let total = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== Clase.EDIFICIO) continue;
    if (mundo.bando[i] !== bando) continue;
    if (mundo.progresoObra[i] < 1) continue;
    if (mundo.vida[i] <= 0) continue;
    total += fichaEdificio(mundo.tipo[i] as TipoEdificio).poblacionQueAporta;
  }
  estado.poblacionMaxima = Math.min(total, estado.limitePoblacion);
}

// --- Poblado inicial del mapa ---

/**
 * Convierte lo que devuelve `generarMapa` en entidades vivas.
 *
 * El orden importa: primero los yacimientos y las rocas (que bloquean casillas), y
 * después las bases, para que un ayuntamiento nunca nazca encima de un árbol.
 */
export function poblarMapaInicial(mundo: Mundo, generado: MapaGenerado): void {
  for (let k = 0; k < generado.minas.length; k++) {
    const par = generado.minas[k];
    crearYacimiento(mundo, TipoYacimiento.MINA_ORO, par[0], par[1]);
  }

  for (let k = 0; k < generado.arboles.length; k++) {
    const par = generado.arboles[k];
    crearYacimiento(mundo, TipoYacimiento.ARBOL, par[0], par[1]);
  }

  for (let k = 0; k < generado.rocas.length; k++) {
    const par = generado.rocas[k];
    // La variante la elige el azar de la simulación: mismo mapa, mismas rocas.
    crearAdorno(mundo, mundo.azar.entero(0, 2), par[0], par[1], true);
  }

  for (let k = 0; k < generado.inicios.length; k++) {
    const inicio = generado.inicios[k];
    const bando = BANDOS_JUGABLES[k % BANDOS_JUGABLES.length];
    fundarBase(mundo, bando, inicio.cx, inicio.cz, inicio.minaX, inicio.minaZ);
  }
}

/** Ayuntamiento más su cuadrilla de campesinos, mirando hacia la veta asignada. */
export function fundarBase(
  mundo: Mundo,
  bando: Bando,
  cx: number,
  cz: number,
  minaX: number,
  minaZ: number,
): Entidad {
  const mapa = mundo.mapa;
  const lado = fichaEdificio(TipoEdificio.AYUNTAMIENTO).huella;

  const sitio = buscarHuecoParaHuella(mapa, cx, cz, lado, 8);
  const ox = sitio ? sitio[0] : cx;
  const oz = sitio ? sitio[1] : cz;

  const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, bando, ox, oz, true);
  if (ayuntamiento === ENTIDAD_NULA) return ENTIDAD_NULA;

  const centroX = centroDeHuella(ox, lado);
  const centroZ = centroDeHuella(oz, lado);

  // Los campesinos aparecen en abanico hacia la veta: el primer viaje ya sale bien
  // orientado y el jugador ve movimiento útil desde el segundo cero.
  const anguloBase = Math.atan2(
    mapa.centroCasilla(minaX) - centroX,
    mapa.centroCasilla(minaZ) - centroZ,
  );
  const radio = lado * 0.5 + RADIO_APARICION_INICIAL;

  for (let k = 0; k < OBREROS_INICIALES; k++) {
    const desvio = ((k - (OBREROS_INICIALES - 1) * 0.5) / OBREROS_INICIALES) * TAU * 0.45;
    const angulo = anguloBase + desvio;
    const px = centroX + Math.sin(angulo) * radio;
    const pz = centroZ + Math.cos(angulo) * radio;
    const casilla = mapa.casillaLibreMasCercana(mapa.aCasilla(px), mapa.aCasilla(pz), 10);
    if (!casilla) continue;
    crearUnidad(
      mundo,
      TipoUnidad.CAMPESINO,
      bando,
      mapa.centroCasilla(casilla[0]),
      mapa.centroCasilla(casilla[1]),
    );
  }

  return ayuntamiento;
}

/** Busca en espiral un hueco donde quepa una huella cuadrada de lado `lado`. */
export function buscarHuecoParaHuella(
  mapa: MapaJuego,
  cx: number,
  cz: number,
  lado: number,
  radioMaximo: number,
): [number, number] | null {
  if (mapa.cabeEdificio(cx, cz, lado)) return [cx, cz];
  for (let r = 1; r <= radioMaximo; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (mapa.cabeEdificio(cx + dx, cz + dz, lado)) return [cx + dx, cz + dz];
      }
    }
  }
  return null;
}
