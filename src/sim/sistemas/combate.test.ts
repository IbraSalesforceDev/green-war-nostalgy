import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { crearEdificio, crearUnidad } from '../fabrica';
import { ordenarAtacar } from '../ordenes';
import {
  Bando,
  Bloqueo,
  Entidad,
  EstadoUnidad,
  TipoArmadura,
  TipoDanio,
  TipoEdificio,
  TipoUnidad,
  indiceDe,
} from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { DANIO_MINIMO, SATURACION_ARMADURA, calcularDanio } from './combate';
import { Simulacion } from './orquestador';

const PASO = 0.05;

describe('daño con la tabla de armaduras', () => {
  it('aplica el multiplicador de la tabla tipo de daño / tipo de armadura', () => {
    // Penetrante contra ligera: 1.15. Sin armadura numérica no hay reducción.
    expect(calcularDanio(10, TipoDanio.PENETRANTE, TipoArmadura.LIGERA, 0)).toBeCloseTo(11.5, 6);
    // Cortante contra fortificada: 0.35. Es el castigo de mandar infantería contra muros.
    expect(calcularDanio(100, TipoDanio.CORTANTE, TipoArmadura.FORTIFICADA, 0)).toBeCloseTo(35, 6);
    // Contundente contra fortificada: 1.5. La catapulta hace su trabajo.
    expect(calcularDanio(100, TipoDanio.CONTUNDENTE, TipoArmadura.FORTIFICADA, 0)).toBeCloseTo(
      150,
      6,
    );
    // Penetrante contra pesada: 0.55.
    expect(calcularDanio(100, TipoDanio.PENETRANTE, TipoArmadura.PESADA, 0)).toBeCloseTo(55, 6);
  });

  it('la armadura numérica reduce en porcentaje y nunca deja el daño en cero', () => {
    const conArmadura = calcularDanio(100, TipoDanio.CORTANTE, TipoArmadura.NINGUNA, 20);
    expect(conArmadura).toBeCloseTo(100 * (1 - 20 / (20 + SATURACION_ARMADURA)), 6);

    // Peor cruce posible más armadura enorme: el suelo de daño mínimo sigue en pie.
    const minimo = calcularDanio(1, TipoDanio.PENETRANTE, TipoArmadura.FORTIFICADA, 500);
    expect(minimo).toBe(DANIO_MINIMO);
  });

  it('la armadura de un bando no altera el daño del otro', () => {
    const sinArmadura = calcularDanio(30, TipoDanio.CORTANTE, TipoArmadura.NINGUNA, 0);
    const conArmadura = calcularDanio(30, TipoDanio.CORTANTE, TipoArmadura.NINGUNA, 10);
    expect(conArmadura).toBeLessThan(sinArmadura);
  });
});

describe('sistema de combate', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('un soldado mata a un campesino enemigo y deja cadáver antes de desaparecer', () => {
    const mundo = crearMundoDePruebas(101);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const soldado = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20, 20);
    const victima = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 21, 20);

    let muertes = 0;
    let danios = 0;
    bus.al('muerte', () => muertes++);
    bus.al('danio', () => danios++);

    ordenarAtacar(mundo, [soldado], victima);

    for (let t = 0; t < 200 && muertes === 0; t++) sim.paso(PASO);

    expect(danios).toBeGreaterThan(0);
    expect(muertes).toBe(1);
    // Sigue existiendo como cadáver justo después de morir.
    expect(mundo.esValida(victima)).toBe(true);
    expect(mundo.estado[indiceDe(victima)]).toBe(EstadoUnidad.MURIENDO);
    expect(mundo.estadoDe(Bando.HUMANOS).bajasCausadas).toBe(1);
    expect(mundo.estadoDe(Bando.ORCOS).unidadesPerdidas).toBe(1);

    // Y se desvanece cuando pasa su tiempo en el suelo.
    for (let t = 0; t < 400; t++) sim.paso(PASO);
    expect(mundo.esValida(victima)).toBe(false);
  });

  it('las unidades ociosas entran en combate solas dentro del radio de agresión', () => {
    const mundo = crearMundoDePruebas(202);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const defensor = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20, 20);
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 23, 20);

    for (let t = 0; t < 40; t++) sim.paso(PASO);

    expect(mundo.objetivoActual[indiceDe(defensor)]).not.toBe(0);
  });

  it('quien mantiene la posición dispara pero no persigue', () => {
    const mundo = crearMundoDePruebas(303);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const centinela = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 20, 20);
    crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.ORCOS, 24, 20);

    const i = indiceDe(centinela);
    mundo.orden[i] = 9 /* MANTENER_POSICION */;
    mundo.anclaX[i] = 20;
    mundo.anclaZ[i] = 20;

    for (let t = 0; t < 120; t++) sim.paso(PASO);

    expect(Math.abs(mundo.x[i] - 20)).toBeLessThan(0.2);
    expect(Math.abs(mundo.z[i] - 20)).toBeLessThan(0.2);
  });

  it('un arquero dispara proyectiles y el daño llega con ellos', () => {
    const mundo = crearMundoDePruebas(404);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const arquero = crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 20, 20);
    const blanco = crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 24, 20);

    let proyectiles = 0;
    bus.al('proyectil', (datos) => {
      expect(datos.tipo).toBe('flecha');
      proyectiles++;
    });

    ordenarAtacar(mundo, [arquero], blanco);
    for (let t = 0; t < 60; t++) sim.paso(PASO);

    expect(proyectiles).toBeGreaterThan(0);
    expect(mundo.vida[indiceDe(blanco)]).toBeLessThan(mundo.vidaMaxima[indiceDe(blanco)]);
  });

  it('una torre dispara sola a lo que se le acerque', () => {
    const mundo = crearMundoDePruebas(505);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    crearEdificio(mundo, TipoEdificio.TORRE, Bando.HUMANOS, 20, 20, true);
    const intruso = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 24, 21);
    const j = indiceDe(intruso);
    mundo.orden[j] = 9; // se queda quieto para no huir del alcance

    for (let t = 0; t < 60; t++) sim.paso(PASO);

    expect(mundo.vida[j]).toBeLessThan(mundo.vidaMaxima[j]);
  });

  it('al morir un edificio libera su huella en la rejilla', () => {
    const mundo = crearMundoDePruebas(606);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const granja: Entidad = crearEdificio(mundo, TipoEdificio.GRANJA, Bando.ORCOS, 20, 20, true);
    const g = indiceDe(granja);
    const poblacionAntes = mundo.estadoDe(Bando.ORCOS).poblacionMaxima;
    expect(poblacionAntes).toBeGreaterThan(0);
    expect(mundo.mapa.bloqueoEn(20, 20) & Bloqueo.EDIFICIO).toBe(Bloqueo.EDIFICIO);

    // Un jinete tarda demasiado contra armadura fortificada: se la deja a un golpe.
    mundo.vida[g] = 1;
    const verdugo = crearUnidad(mundo, TipoUnidad.JINETE, Bando.HUMANOS, 24, 21);
    ordenarAtacar(mundo, [verdugo], granja);

    for (let t = 0; t < 200 && mundo.esValida(granja); t++) sim.paso(PASO);

    expect(mundo.esValida(granja)).toBe(false);
    for (let dz = 0; dz < 2; dz++) {
      for (let dx = 0; dx < 2; dx++) {
        expect(mundo.mapa.bloqueoEn(20 + dx, 20 + dz)).toBe(Bloqueo.LIBRE);
        expect(mundo.mapa.ocupante[mundo.mapa.indice(20 + dx, 20 + dz)]).toBe(0);
      }
    }
    expect(mundo.estadoDe(Bando.ORCOS).poblacionMaxima).toBe(0);
  });
});
