import { EstadoUnidad } from '../../sim/tipos';
import { TAU, limitar01, mezclar } from '../../core/math';
import type { PoseUnidad } from './contrato';

/**
 * Curvas y ciclos de animación.
 *
 * La regla que gobierna este archivo: **nada de senos puros**. Un golpe de espada
 * animado con un seno parece un metrónomo, porque el seno reparte la energía por
 * igual en toda la trayectoria y la vida no funciona así. Un golpe real tiene tres
 * tiempos —anticipación lenta hacia atrás, caída acelerada, recuperación con
 * rebote— y la lectura del ataque depende por completo de que esos tres tiempos
 * tengan duraciones distintas.
 *
 * El seno sí es correcto para lo que de verdad oscila: la respiración y el
 * balanceo del reposo.
 */

// --- Suavizados ---

export function suavizar(t: number): number {
  const u = limitar01(t);
  return u * u * (3 - 2 * u);
}

export function entradaCubica(t: number): number {
  const u = limitar01(t);
  return u * u * u;
}

export function salidaCubica(t: number): number {
  const u = 1 - limitar01(t);
  return 1 - u * u * u;
}

export function entradaCuartica(t: number): number {
  const u = limitar01(t);
  return u * u * u * u;
}

/** Sale pasándose del objetivo y vuelve: el remate de cualquier movimiento con peso. */
export function salidaAtras(t: number, fuerza = 1.7): number {
  const u = limitar01(t) - 1;
  return u * u * ((fuerza + 1) * u + fuerza) + 1;
}

/** Entra retrocediendo primero. La anticipación en estado puro. */
export function entradaAtras(t: number, fuerza = 1.7): number {
  const u = limitar01(t);
  return u * u * ((fuerza + 1) * u - fuerza);
}

/** Rebote amortiguado. Para impactos y aterrizajes. */
export function salidaElastica(t: number, periodo = 0.32): number {
  const u = limitar01(t);
  if (u === 0 || u === 1) return u;
  return Math.pow(2, -9 * u) * Math.sin(((u - periodo / 4) * TAU) / periodo) + 1;
}

/** Interpolación entre dos valores con la curva que se le pase. */
export function conCurva(a: number, b: number, t: number, curva: (t: number) => number): number {
  return mezclar(a, b, curva(t));
}

// --- Perfiles de golpe ---

/**
 * Curva maestra del golpe cuerpo a cuerpo, normalizada en [0, 1].
 *
 * Devuelve −1 con el arma totalmente cargada atrás, +1 en el instante del impacto
 * y 0 en guardia. El reparto de tiempos (38 % cargar, 14 % caer, 48 % recuperar)
 * es lo que da la sensación de peso: cargar cuesta, caer es instantáneo.
 */
export function curvaGolpe(t: number): number {
  const u = limitar01(t);
  if (u < 0.38) {
    // Anticipación: el arma sube y va atrás desacelerando, como si pesara.
    return -salidaCubica(u / 0.38);
  }
  if (u < 0.52) {
    // Caída: aceleración pura, y se pasa un poco del objetivo por inercia.
    const v = (u - 0.38) / 0.14;
    return -1 + 2.18 * (v * v);
  }
  // Recuperación: vuelve a guardia con un temblor decreciente.
  const v = (u - 0.52) / 0.48;
  return 1.18 * (1 - salidaCubica(v)) * Math.cos(v * 3.1) * (1 - v * 0.35);
}

/**
 * Curva del arco: tensar, sostener, soltar.
 * Devuelve la tensión de la cuerda en [0, 1]. La suelta ocupa un 4 % del ciclo,
 * y ese contraste brutal entre tensar y soltar es todo el efecto.
 */
export function curvaArco(t: number): number {
  const u = limitar01(t);
  if (u < 0.52) return salidaCubica(u / 0.52);
  if (u < 0.62) return 1;
  if (u < 0.66) return 1 - entradaCuartica((u - 0.62) / 0.04) * 1;
  return 0;
}

/**
 * Curva del lanzamiento (hacha orca, jabalina): carga por encima del hombro y
 * suelta con el brazo completamente extendido al frente.
 * Devuelve −1 cargado atrás, +1 brazo extendido.
 */
export function curvaLanzamiento(t: number): number {
  const u = limitar01(t);
  if (u < 0.45) return -salidaCubica(u / 0.45);
  if (u < 0.56) {
    const v = (u - 0.45) / 0.11;
    return -1 + 2.2 * entradaCubica(v) + 0.9 * v;
  }
  const v = (u - 0.56) / 0.44;
  return 1.1 * (1 - suavizar(v));
}

/**
 * Curva del brazo de la catapulta: se arma despacio contra la resistencia de las
 * cuerdas, se traba un instante y se dispara de golpe.
 * 0 = brazo en reposo levantado, 1 = brazo totalmente armado hacia atrás.
 */
export function curvaCatapulta(t: number): number {
  const u = limitar01(t);
  if (u < 0.55) return salidaCubica(u / 0.55);
  if (u < 0.62) return 1 + Math.sin((u - 0.55) * 90) * 0.02; // vibración de la traba
  if (u < 0.7) return 1 - entradaCuartica((u - 0.62) / 0.08);
  // El brazo rebota contra el travesaño y se queda temblando.
  return Math.max(0, (1 - salidaElastica((u - 0.7) / 0.3)) * -0.22);
}

/**
 * Curva del picar: alzar la herramienta cuesta, dejarla caer no.
 * Devuelve −1 arriba, +1 en el momento del impacto contra la roca.
 */
export function curvaPicar(t: number): number {
  const u = limitar01(t);
  if (u < 0.46) return -salidaCubica(u / 0.46);
  if (u < 0.58) {
    const v = (u - 0.46) / 0.12;
    return -1 + 2.1 * (v * v);
  }
  const v = (u - 0.58) / 0.42;
  // Rebote seco del mango contra la piedra antes de volver a alzarse.
  return 1.1 * (1 - salidaCubica(v)) * Math.cos(v * 4.2) * (1 - v * 0.4);
}

/**
 * Mirada de reposo: la cabeza pasa la mayor parte del tiempo al frente y de vez en
 * cuando se gira a un lado, se queda mirando y vuelve. Es el detalle que convierte
 * una figura quieta en una figura viva.
 */
export function curvaMirada(t: number): number {
  const u = t - Math.floor(t);
  if (u < 0.34) return 0;
  if (u < 0.42) return salidaCubica((u - 0.34) / 0.08);
  if (u < 0.62) return 1;
  if (u < 0.72) return 1 - suavizar((u - 0.62) / 0.1);
  if (u < 0.8) return -suavizar((u - 0.72) / 0.08);
  if (u < 0.92) return -1;
  return -(1 - suavizar((u - 0.92) / 0.08));
}

// --- Pose del esqueleto rígido ---

/**
 * Estado articular de un bípedo. Los índices son 0 = izquierda, 1 = derecha.
 *
 * Signos, fijados de una vez para todo el módulo (modelo mirando a +Z):
 *   - `muslo`, `pantorrilla`, `hombro`: positivo lleva el miembro hacia **atrás**.
 *   - `codo`: negativo **flexiona** (la mano se acerca al pecho).
 *   - `torsoCabeceo`, `cabeza Cabeceo`: positivo inclina hacia **delante**.
 *   - `abduccion`: positivo separa el brazo del costado.
 */
export interface PoseEsqueleto {
  /** Desplazamiento vertical del cuerpo entero: rebote del paso, hundimiento al morir. */
  alturaCuerpo: number;
  /** Balanceo lateral del cuerpo entero (rotación en Z). */
  balanceoCuerpo: number;
  /** Vuelco del cuerpo entero (rotación en X). Lo usa sobre todo la muerte. */
  vuelcoCuerpo: number;
  /** Giro del cuerpo entero sobre su eje (rotación en Y). */
  giroCuerpo: number;

  muslo: [number, number];
  pantorrilla: [number, number];
  hombro: [number, number];
  abduccion: [number, number];
  codo: [number, number];

  torsoCabeceo: number;
  torsoGiro: number;
  torsoBalanceo: number;

  cabezaCabeceo: number;
  cabezaGiro: number;

  /** Rotación extra del arma dentro de la mano: el latigazo de muñeca. */
  arma: number;
  /** Tensión de un mecanismo en [0, 1]: cuerda del arco, brazo de la catapulta. */
  tension: number;
  /** Desviación de la capa o de los faldones, por inercia. */
  capa: number;
}

export function crearPoseEsqueleto(): PoseEsqueleto {
  return {
    alturaCuerpo: 0,
    balanceoCuerpo: 0,
    vuelcoCuerpo: 0,
    giroCuerpo: 0,
    muslo: [0, 0],
    pantorrilla: [0, 0],
    hombro: [0, 0],
    abduccion: [0, 0],
    codo: [0, 0],
    torsoCabeceo: 0,
    torsoGiro: 0,
    torsoBalanceo: 0,
    cabezaCabeceo: 0,
    cabezaGiro: 0,
    arma: 0,
    tension: 0,
    capa: 0,
  };
}

/** Estilo de ataque; decide qué curva gobierna los brazos. */
export type EstiloAtaque = 'espada' | 'hacha' | 'arco' | 'lanzamiento' | 'lanza' | 'maquina';

/** Estilo de recolección. */
export type EstiloTrabajo = 'picar' | 'talar';

/**
 * Rasgos de movimiento de una unidad. Es lo que hace que un orco y un humano con el
 * mismo esqueleto se muevan de forma reconociblemente distinta.
 */
export interface PerfilAnimacion {
  estilo: EstiloAtaque;
  trabajo: EstiloTrabajo;
  /** Segundos que dura un ciclo completo de ataque. */
  periodoAtaque: number;
  /** Segundos por ciclo de recolección o de martilleo. */
  periodoTrabajo: number;
  /** Pasos por segundo y por casilla/segundo de rapidez. */
  cadenciaPaso: number;
  /** Amplitud de la zancada, en radianes. */
  zancada: number;
  /** Amplitud del braceo. */
  braceo: number;
  /** Inclinación permanente del torso. Los orcos caminan encorvados. */
  encorvado: number;
  /** Separación permanente de los brazos: los orcos no pueden juntarlos. */
  abduccionBase: number;
  /** Multiplicador del rebote vertical al caminar. */
  rebote: number;
  /** Amplitud de la respiración en reposo. */
  respiracion: number;
}

export const PERFIL_BASE: PerfilAnimacion = {
  estilo: 'espada',
  trabajo: 'picar',
  periodoAtaque: 1.2,
  periodoTrabajo: 1.1,
  cadenciaPaso: 2.6,
  zancada: 0.62,
  braceo: 0.5,
  encorvado: 0.06,
  abduccionBase: 0.1,
  rebote: 1,
  respiracion: 1,
};

export function perfil(cambios: Partial<PerfilAnimacion>): PerfilAnimacion {
  return { ...PERFIL_BASE, ...cambios };
}

/** Deja la pose en reposo absoluto. Punto de partida de cada fotograma. */
function limpiar(p: PoseEsqueleto): void {
  p.alturaCuerpo = 0;
  p.balanceoCuerpo = 0;
  p.vuelcoCuerpo = 0;
  p.giroCuerpo = 0;
  p.muslo[0] = 0;
  p.muslo[1] = 0;
  p.pantorrilla[0] = 0;
  p.pantorrilla[1] = 0;
  p.hombro[0] = 0;
  p.hombro[1] = 0;
  p.abduccion[0] = 0;
  p.abduccion[1] = 0;
  p.codo[0] = 0;
  p.codo[1] = 0;
  p.torsoCabeceo = 0;
  p.torsoGiro = 0;
  p.torsoBalanceo = 0;
  p.cabezaCabeceo = 0;
  p.cabezaGiro = 0;
  p.arma = 0;
  p.tension = 0;
  p.capa = 0;
}

/**
 * Calcula la pose del fotograma. Es la función caliente del módulo: se llama una vez
 * por unidad visible, así que no reserva memoria ni construye objetos.
 */
export function calcularPose(
  salida: PoseEsqueleto,
  pose: PoseUnidad,
  perfilUnidad: PerfilAnimacion,
): void {
  limpiar(salida);

  // El encorvado y la separación de brazos son constitucionales: se aplican siempre,
  // menos cuando la unidad ya está en el suelo.
  if (pose.estado !== EstadoUnidad.MURIENDO) {
    salida.torsoCabeceo = perfilUnidad.encorvado;
    salida.abduccion[0] = perfilUnidad.abduccionBase;
    salida.abduccion[1] = perfilUnidad.abduccionBase;
  }

  switch (pose.estado) {
    case EstadoUnidad.CAMINANDO:
      caminar(salida, pose, perfilUnidad);
      break;
    case EstadoUnidad.ATACANDO:
      atacar(salida, pose, perfilUnidad);
      break;
    case EstadoUnidad.RECOLECTANDO:
      recolectar(salida, pose, perfilUnidad);
      break;
    case EstadoUnidad.CONSTRUYENDO:
      construir(salida, pose, perfilUnidad);
      break;
    case EstadoUnidad.MURIENDO:
      morir(salida, pose, perfilUnidad);
      break;
    default:
      reposar(salida, pose, perfilUnidad);
      break;
  }
}

// --- Ciclos ---

function reposar(p: PoseEsqueleto, pose: PoseUnidad, perfilUnidad: PerfilAnimacion): void {
  const t = pose.tiempoGlobal + pose.desfase * 9.1;

  // Respiración: dos senos desfasados evitan que el pecho suba y baje como un pistón.
  const aire = Math.sin(t * 1.55) * 0.6 + Math.sin(t * 0.83 + 1.7) * 0.4;
  const amp = perfilUnidad.respiracion;

  p.alturaCuerpo += aire * 0.011 * amp;
  p.torsoCabeceo += -aire * 0.035 * amp;
  p.balanceoCuerpo += Math.sin(t * 0.62 + pose.desfase * 4) * 0.022;
  p.torsoGiro += Math.sin(t * 0.44 + 2.1) * 0.03;

  // Los brazos acompañan la respiración separándose un poco del costado.
  p.abduccion[0] += 0.035 + aire * 0.018 * amp;
  p.abduccion[1] += 0.035 + aire * 0.018 * amp;
  p.hombro[0] += aire * 0.02;
  p.hombro[1] += aire * 0.02;
  p.codo[0] += -0.16;
  p.codo[1] += -0.16;

  // Peso repartido: una pierna algo adelantada rompe la simetría de maniquí.
  p.muslo[0] += -0.06;
  p.muslo[1] += 0.05;
  p.pantorrilla[0] += 0.05;
  p.pantorrilla[1] += 0.1;

  // La mirada se pasea. El ciclo dura ~7 s y cada unidad lo empieza donde le toca.
  const mirada = curvaMirada(t / 7 + pose.desfase);
  p.cabezaGiro += mirada * 0.58;
  p.cabezaCabeceo += -aire * 0.03 + Math.abs(mirada) * 0.05;

  // Herida: encogerse un poco vende que la unidad está a punto de caer.
  const herida = 1 - Math.min(1, pose.saludNormalizada / 0.4);
  if (herida > 0) {
    p.torsoCabeceo += herida * 0.18;
    p.alturaCuerpo -= herida * 0.02;
    p.cabezaCabeceo += herida * 0.12;
  }
}

function caminar(p: PoseEsqueleto, pose: PoseUnidad, perfilUnidad: PerfilAnimacion): void {
  // La cadencia sigue a la rapidez real: una unidad frenada por la multitud no puede
  // seguir pataleando a velocidad de crucero, es el fallo que más delata a un RTS.
  const rapidez = Math.max(0.35, pose.rapidez);
  const f = pose.tiempoEstado * perfilUnidad.cadenciaPaso * rapidez + pose.desfase * TAU;

  const s = Math.sin(f);
  const c = Math.cos(f);
  const amp = perfilUnidad.zancada * Math.min(1.25, 0.55 + rapidez * 0.16);

  p.muslo[0] += s * amp;
  p.muslo[1] += -s * amp;

  // La rodilla solo se dobla en la fase de recogida, nunca en el apoyo: es la
  // diferencia entre caminar y patinar.
  p.pantorrilla[0] += Math.max(0, s) * amp * 1.5 + 0.06;
  p.pantorrilla[1] += Math.max(0, -s) * amp * 1.5 + 0.06;

  // Contrabalanceo: brazo contrario a la pierna.
  p.hombro[0] += -s * perfilUnidad.braceo;
  p.hombro[1] += s * perfilUnidad.braceo;
  p.codo[0] += -0.24 - Math.max(0, -s) * 0.4;
  p.codo[1] += -0.24 - Math.max(0, s) * 0.4;

  // Rebote: dos apoyos por ciclo, por eso la frecuencia es doble. El valor absoluto
  // del coseno da la caída rápida y la subida rápida propias del paso.
  p.alturaCuerpo += (Math.abs(c) - 0.55) * 0.045 * perfilUnidad.rebote;
  p.balanceoCuerpo += s * 0.06;
  p.torsoGiro += -s * 0.13;
  p.torsoCabeceo += 0.08 + Math.min(0.12, rapidez * 0.02);
  p.cabezaCabeceo += -0.05 - Math.abs(c) * 0.03;
  p.capa = -s * 0.22 - 0.25;
}

function atacar(p: PoseEsqueleto, pose: PoseUnidad, perfilUnidad: PerfilAnimacion): void {
  const t = (pose.tiempoEstado % perfilUnidad.periodoAtaque) / perfilUnidad.periodoAtaque;

  switch (perfilUnidad.estilo) {
    case 'arco': {
      const tension = curvaArco(t);
      p.tension = tension;
      // Brazo del arco: extendido al frente y firme.
      p.hombro[0] += -1.42;
      p.abduccion[0] += 0.16;
      p.codo[0] += -0.12;
      // Brazo de la cuerda: tira hacia atrás y arriba.
      p.hombro[1] += -0.55 + tension * 0.35;
      p.abduccion[1] += 0.42 + tension * 0.5;
      p.codo[1] += -1.15 - tension * 1.15;
      p.torsoGiro += -0.42 - tension * 0.16;
      p.torsoCabeceo += -0.04;
      p.cabezaGiro += 0.34;
      // El culatazo al soltar: el cuerpo se sacude hacia atrás un instante.
      if (t > 0.62 && t < 0.78) {
        const golpe = 1 - suavizar((t - 0.62) / 0.16);
        p.torsoCabeceo += -golpe * 0.16;
        p.alturaCuerpo += golpe * 0.012;
      }
      p.muslo[0] += -0.3;
      p.muslo[1] += 0.22;
      p.pantorrilla[0] += 0.14;
      p.pantorrilla[1] += 0.18;
      break;
    }

    case 'lanzamiento': {
      const g = curvaLanzamiento(t);
      p.hombro[1] += 0.5 - g * 1.85;
      p.abduccion[1] += 0.55 - g * 0.25;
      p.codo[1] += -1.0 + Math.max(0, g) * 0.95 - Math.max(0, -g) * 0.5;
      p.hombro[0] += -0.35 + g * 0.7;
      p.codo[0] += -0.6;
      p.torsoGiro += g * 0.62;
      p.torsoCabeceo += g * 0.28;
      p.muslo[0] += -0.34 + g * 0.2;
      p.muslo[1] += 0.26 - g * 0.16;
      p.pantorrilla[0] += 0.2;
      p.pantorrilla[1] += 0.24;
      p.arma = -g * 0.6;
      break;
    }

    case 'lanza': {
      const g = curvaGolpe(t);
      // La lanza no se levanta: retrocede y sale disparada al frente.
      p.hombro[1] += 0.25 + g * 0.12;
      p.abduccion[1] += 0.28;
      p.codo[1] += -1.5 + Math.max(0, g) * 1.35 + Math.max(0, -g) * 0.35;
      p.hombro[0] += -0.9 - g * 0.25;
      p.codo[0] += -0.5;
      p.torsoGiro += -g * 0.34;
      p.torsoCabeceo += g * 0.14;
      p.muslo[0] += -0.32 - Math.max(0, g) * 0.18;
      p.muslo[1] += 0.24;
      p.pantorrilla[0] += 0.18;
      p.pantorrilla[1] += 0.22;
      break;
    }

    case 'maquina': {
      p.tension = curvaCatapulta(t);
      // La tripulación se agacha al disparar; con un solo cuerpo basta con encoger.
      p.alturaCuerpo += -p.tension * 0.02;
      break;
    }

    default: {
      // Espada y hacha: mismo esquema, el hacha con más recorrido y más peso.
      const pesado = perfilUnidad.estilo === 'hacha';
      const g = curvaGolpe(t);
      const alcance = pesado ? 1.62 : 1.4;

      p.hombro[1] += 0.42 - g * alcance;
      p.abduccion[1] += 0.3 + Math.max(0, -g) * (pesado ? 0.5 : 0.3);
      p.codo[1] += -0.75 + Math.max(0, -g) * 0.55 + Math.max(0, g) * 0.45;

      // El brazo del escudo se cierra sobre el pecho al golpear.
      p.hombro[0] += -0.42 + g * 0.3;
      p.abduccion[0] += 0.2;
      p.codo[0] += -1.25 - Math.max(0, g) * 0.2;

      p.torsoGiro += -g * (pesado ? 0.45 : 0.34);
      p.torsoCabeceo += g * (pesado ? 0.3 : 0.2);
      p.torsoBalanceo += -g * 0.1;
      p.arma = -g * 0.55;

      // Paso de apoyo: el peso se echa sobre la pierna adelantada en el impacto.
      p.muslo[0] += -0.34 - Math.max(0, g) * 0.2;
      p.muslo[1] += 0.28;
      p.pantorrilla[0] += 0.16;
      p.pantorrilla[1] += 0.3;
      p.alturaCuerpo += -Math.max(0, g) * 0.03;
      p.cabezaCabeceo += g * 0.14;
      p.capa = -g * 0.3;
      break;
    }
  }
}

function recolectar(p: PoseEsqueleto, pose: PoseUnidad, perfilUnidad: PerfilAnimacion): void {
  const t = (pose.tiempoEstado % perfilUnidad.periodoTrabajo) / perfilUnidad.periodoTrabajo;
  const g = curvaPicar(t);

  if (perfilUnidad.trabajo === 'talar') {
    // Hachazo lateral: el trabajo viene del giro del tronco, no de los brazos.
    p.torsoGiro += -g * 0.85;
    p.torsoBalanceo += g * 0.3;
    p.torsoCabeceo += 0.25 + Math.max(0, g) * 0.25;
    p.hombro[0] += -1.1 - g * 0.35;
    p.hombro[1] += -1.0 - g * 0.3;
    p.abduccion[0] += 0.32 - g * 0.2;
    p.abduccion[1] += 0.32 - g * 0.2;
    p.codo[0] += -0.5 + Math.max(0, g) * 0.35;
    p.codo[1] += -0.55 + Math.max(0, g) * 0.35;
    p.arma = -g * 0.4;
  } else {
    // Picar: las dos manos suben por encima de la cabeza y caen a plomo.
    p.hombro[0] += -0.55 - g * 1.35;
    p.hombro[1] += -0.6 - g * 1.4;
    p.abduccion[0] += 0.22;
    p.abduccion[1] += 0.22;
    p.codo[0] += -0.9 + Math.max(0, -g) * 0.55 + Math.max(0, g) * 0.5;
    p.codo[1] += -0.95 + Math.max(0, -g) * 0.55 + Math.max(0, g) * 0.5;
    p.torsoCabeceo += 0.3 + Math.max(0, g) * 0.4 - Math.max(0, -g) * 0.22;
    p.torsoGiro += -g * 0.16;
    p.arma = -g * 0.35;
  }

  p.muslo[0] += -0.3;
  p.muslo[1] += 0.24;
  p.pantorrilla[0] += 0.3;
  p.pantorrilla[1] += 0.34;
  p.alturaCuerpo += -0.025 - Math.max(0, g) * 0.03;
  p.cabezaCabeceo += 0.22 + g * 0.1;
}

function construir(p: PoseEsqueleto, pose: PoseUnidad, perfilUnidad: PerfilAnimacion): void {
  // Martillazos: ciclo más corto que el de picar y con un solo brazo, porque la otra
  // mano sujeta lo que se está clavando.
  const periodo = perfilUnidad.periodoTrabajo * 0.62;
  const t = (pose.tiempoEstado % periodo) / periodo;
  const g = curvaPicar(t);

  p.hombro[1] += -0.5 - g * 1.15;
  p.abduccion[1] += 0.3 + Math.max(0, -g) * 0.25;
  p.codo[1] += -1.15 + Math.max(0, g) * 0.75;

  // La mano libre sostiene: casi inmóvil, adelantada y baja.
  p.hombro[0] += -1.0;
  p.abduccion[0] += 0.28;
  p.codo[0] += -0.75;

  p.torsoCabeceo += 0.34 + Math.max(0, g) * 0.16;
  p.torsoGiro += -g * 0.2;
  p.cabezaCabeceo += 0.3;
  p.alturaCuerpo += -0.03;
  p.muslo[0] += -0.36;
  p.muslo[1] += 0.3;
  p.pantorrilla[0] += 0.36;
  p.pantorrilla[1] += 0.4;
  p.arma = -g * 0.45;
}

function morir(p: PoseEsqueleto, pose: PoseUnidad, _perfilUnidad: PerfilAnimacion): void {
  const caida = limitar01(pose.tiempoEstado / 0.85);

  // Cae de espaldas. El `salidaAtras` hace que la espalda rebote contra el suelo en
  // lugar de quedarse clavada, que es lo que delata una caída interpolada a pelo.
  const giro = salidaAtras(caida, 0.9) * -1.48;
  p.vuelcoCuerpo = giro;
  p.giroCuerpo = salidaCubica(caida) * 0.42;
  p.balanceoCuerpo = Math.sin(caida * 5.2) * 0.18 * (1 - caida);

  // Al llegar al suelo se hunde un poco: los cadáveres no flotan sobre la hierba.
  const hundimiento = limitar01((pose.tiempoEstado - 0.8) / 1.6);
  p.alturaCuerpo = -suavizar(hundimiento) * 0.12;

  // Los brazos se abren y quedan muertos; el arma se descuelga.
  const suelto = salidaCubica(limitar01(pose.tiempoEstado / 0.55));
  p.hombro[0] = -0.35 - suelto * 0.9;
  p.hombro[1] = -0.2 - suelto * 1.3;
  p.abduccion[0] = 0.3 + suelto * 0.75;
  p.abduccion[1] = 0.3 + suelto * 0.95;
  p.codo[0] = -0.3 * (1 - suelto);
  p.codo[1] = -0.25 * (1 - suelto);

  p.muslo[0] = -suelto * 0.55;
  p.muslo[1] = -suelto * 0.28;
  p.pantorrilla[0] = suelto * 0.7;
  p.pantorrilla[1] = suelto * 0.4;

  p.torsoCabeceo = suelto * 0.3;
  p.cabezaCabeceo = -0.3 + suelto * 0.75;
  p.cabezaGiro = suelto * 0.5;
  p.arma = suelto * 0.9;
}

/**
 * Ciclo de las patas de una montura (caballo o lobo).
 *
 * Devuelve el ángulo de la pata `indice` (0..3: delantera izq, delantera der,
 * trasera izq, trasera der). El galope se construye con dos parejas desfasadas
 * media zancada, no con cuatro patas alternas: es lo que le da el aire de carrera.
 */
export function faseCuadrupedo(indice: number, f: number, amplitud: number): number {
  const desfases = [0, Math.PI * 0.55, Math.PI * 0.95, Math.PI * 1.5];
  return Math.sin(f + desfases[indice]!) * amplitud;
}

/** Flexión de la pata correspondiente, siempre en la fase de recogida. */
export function flexionCuadrupedo(indice: number, f: number, amplitud: number): number {
  const desfases = [0, Math.PI * 0.55, Math.PI * 0.95, Math.PI * 1.5];
  return Math.max(0, Math.sin(f + desfases[indice]! + 0.7)) * amplitud;
}
