import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { crearEdificio, crearUnidad, crearYacimiento } from '../fabrica';
import { Mundo } from '../mundo';
import {
  ordenarAtacarMover,
  ordenarMover,
  ordenarPatrullar,
  ordenarRecolectar,
} from '../ordenes';
import {
  Bando,
  Entidad,
  TipoEdificio,
  TipoUnidad,
  TipoYacimiento,
  indiceDe,
} from '../tipos';
import { crearBuscadorRutas } from '../rutas/buscador';
import { BuscadorRecto, crearMundoDePruebas, huellaDelMundo } from './comun.test';
import { Simulacion } from './orquestador';
import { encolarUnidad } from './produccion';

const PASO = 0.05;

/**
 * Escenario completo: dos bases, economía, tropa en movimiento y una escaramuza.
 * Toca todos los sistemas y todas las tiradas de azar, que es lo que hace que la
 * prueba de determinismo signifique algo.
 */
function montarPartida(semilla: number): { mundo: Mundo; sim: Simulacion } {
  const mundo = crearMundoDePruebas(semilla, 64);
  const sim = new Simulacion(mundo, new BuscadorRecto());

  const ayuntamientoHumano = crearEdificio(
    mundo,
    TipoEdificio.AYUNTAMIENTO,
    Bando.HUMANOS,
    10,
    10,
    true,
  );
  const ayuntamientoOrco = crearEdificio(
    mundo,
    TipoEdificio.AYUNTAMIENTO,
    Bando.ORCOS,
    46,
    46,
    true,
  );

  const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
  crearYacimiento(mundo, TipoYacimiento.ARBOL, 20, 16);
  crearYacimiento(mundo, TipoYacimiento.ARBOL, 21, 16);

  const obreros: Entidad[] = [];
  for (let k = 0; k < 3; k++) {
    obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 16.5, 12.5 + k * 0.9));
  }

  const humanos: Entidad[] = [
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 28.5, 28.5),
    crearUnidad(mundo, TipoUnidad.ARQUERO, Bando.HUMANOS, 27.5, 29.5),
  ];
  const orcos: Entidad[] = [
    crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.ORCOS, 33.5, 30.5),
    crearUnidad(mundo, TipoUnidad.JINETE, Bando.ORCOS, 34.5, 31.5),
  ];

  ordenarRecolectar(mundo, obreros, mina);
  ordenarAtacarMover(mundo, humanos, 36, 32);
  ordenarPatrullar(mundo, orcos, 28, 28);
  encolarUnidad(mundo, ayuntamientoHumano, TipoUnidad.CAMPESINO);
  encolarUnidad(mundo, ayuntamientoOrco, TipoUnidad.CAMPESINO);

  return { mundo, sim };
}

describe('orquestador', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('dos partidas con la misma semilla y las mismas órdenes son idénticas', () => {
    const primera = montarPartida(777);
    for (let t = 0; t < 300; t++) primera.sim.paso(PASO);
    const huellaA = huellaDelMundo(primera.mundo);

    // La segunda se monta entera después: los enganches de módulo (freno de
    // movimiento, invalidador de rutas) son globales y solo hay una partida a la vez.
    const segunda = montarPartida(777);
    for (let t = 0; t < 300; t++) segunda.sim.paso(PASO);
    const huellaB = huellaDelMundo(segunda.mundo);

    expect(huellaB).toBe(huellaA);
    expect(primera.mundo.tick).toBe(300);
    // Y no es una huella trivial: la partida ha avanzado de verdad.
    expect(huellaA.length).toBeGreaterThan(200);
    expect(primera.mundo.estadoDe(Bando.HUMANOS).oroRecogido).toBeGreaterThan(0);
  });

  it('semillas distintas divergen', () => {
    const primera = montarPartida(777);
    for (let t = 0; t < 300; t++) primera.sim.paso(PASO);
    const huellaA = huellaDelMundo(primera.mundo);

    const segunda = montarPartida(31337);
    for (let t = 0; t < 300; t++) segunda.sim.paso(PASO);

    expect(huellaDelMundo(segunda.mundo)).not.toBe(huellaA);
  });

  it('emite finPartida cuando un bando se queda sin nada', () => {
    const mundo = crearMundoDePruebas(88);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const victima = crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.ORCOS, 20.5, 20.5);

    let ganador: Bando | null = null;
    let veces = 0;
    bus.al('finPartida', (datos) => {
      ganador = datos.ganador;
      veces++;
    });

    sim.paso(PASO);
    expect(veces).toBe(0);

    // Se retira lo último que le quedaba a los orcos.
    mundo.vida[indiceDe(victima)] = 0;
    for (let t = 0; t < 400; t++) sim.paso(PASO);

    expect(ganador).toBe(Bando.HUMANOS);
    expect(veces).toBe(1);
    expect(sim.terminada).toBe(true);
    expect(mundo.estadoDe(Bando.ORCOS).derrotado).toBe(true);
  });

  it('las estadísticas cuadran con el contenido del mundo', () => {
    const { mundo, sim } = montarPartida(99);
    for (let t = 0; t < 40; t++) sim.paso(PASO);

    const estadisticas = sim.estadisticas();
    expect(estadisticas.tick).toBe(40);
    expect(estadisticas.entidades).toBe(mundo.contarActivas());
    expect(estadisticas.yacimientos).toBe(3);
    expect(estadisticas.bandos[Bando.HUMANOS]!.edificios).toBe(1);
    expect(estadisticas.bandos[Bando.HUMANOS]!.unidades).toBe(5);
    expect(estadisticas.bandos[Bando.ORCOS]!.unidades).toBe(2);
    // El objeto se reutiliza: llamar dos veces no crea basura nueva.
    expect(sim.estadisticas()).toBe(estadisticas);
  });

  it('el bucle económico funciona con el buscador de rutas de verdad', () => {
    const mundo = crearMundoDePruebas(123);
    const sim = new Simulacion(mundo, crearBuscadorRutas(mundo.mapa));

    crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const mina = crearYacimiento(mundo, TipoYacimiento.MINA_ORO, 20, 12);
    const obreros: Entidad[] = [];
    for (let k = 0; k < 2; k++) {
      obreros.push(crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 16.5, 12.5 + k));
    }

    ordenarRecolectar(mundo, obreros, mina);
    for (let t = 0; t < 1000; t++) sim.paso(PASO);

    expect(mundo.estadoDe(Bando.HUMANOS).oroRecogido).toBeGreaterThan(0);
  });

  it('una orden de grupo reparte a las unidades en formación', () => {
    const mundo = crearMundoDePruebas(100);
    const sim = new Simulacion(mundo, new BuscadorRecto());

    const grupo: Entidad[] = [];
    for (let k = 0; k < 5; k++) {
      grupo.push(crearUnidad(mundo, TipoUnidad.SOLDADO, Bando.HUMANOS, 10.5 + k, 10.5));
    }

    expect(ordenarMover(mundo, grupo, 30, 30)).toBe(5);

    const destinos = new Set(
      grupo.map((e) => `${mundo.ordenX[indiceDe(e)]},${mundo.ordenZ[indiceDe(e)]}`),
    );
    expect(destinos.size).toBe(5);

    for (let t = 0; t < 400; t++) sim.paso(PASO);

    // Llegan todas y ninguna acaba encima de otra.
    for (let a = 0; a < grupo.length; a++) {
      const i = indiceDe(grupo[a]!);
      expect(Math.hypot(mundo.x[i] - 30, mundo.z[i] - 30)).toBeLessThan(4);
      for (let b = a + 1; b < grupo.length; b++) {
        const j = indiceDe(grupo[b]!);
        expect(Math.hypot(mundo.x[i] - mundo.x[j], mundo.z[i] - mundo.z[j])).toBeGreaterThan(0.2);
      }
    }
  });
});
