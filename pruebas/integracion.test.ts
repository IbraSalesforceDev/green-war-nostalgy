import { describe, expect, it } from 'vitest';
import { generarMapa } from '../src/sim/generador';
import { Mundo } from '../src/sim/mundo';
import { poblarMapaInicial } from '../src/sim/fabrica';
import { crearBuscadorRutas } from '../src/sim/rutas/buscador';
import { Simulacion } from '../src/sim/sistemas/orquestador';
import { enchufarEvitacion } from '../src/sim/enlaceEvitacion';
import { ordenarRecolectar } from '../src/sim/ordenes';
import { PASO_SIMULACION } from '../src/sim/constantes';
import {
  Bando,
  Clase,
  Entidad,
  EstadoUnidad,
  TipoYacimiento,
  indiceDe,
} from '../src/sim/tipos';

/**
 * Pruebas de integración de la partida completa.
 *
 * Las pruebas de cada sistema usan dobles del buscador de rutas que devuelven
 * líneas rectas. Eso es lo correcto para aislar un sistema, pero deja un hueco:
 * nadie comprueba que las piezas *reales* encajen entre sí sobre un mapa *real*.
 *
 * Este archivo cubre justo ese hueco. Monta exactamente lo mismo que `main.ts`
 * —mapa generado, fábrica, buscador real, evitación enchufada, orquestador— y
 * comprueba que una partida progresa de verdad.
 */

function montarPartida(semilla = 20260802) {
  const generado = generarMapa({ ancho: 96, alto: 96, semilla });
  const mundo = new Mundo(generado.mapa, semilla);
  poblarMapaInicial(mundo, generado);

  const buscador = crearBuscadorRutas(generado.mapa);
  enchufarEvitacion();

  const simulacion = new Simulacion(mundo, buscador);
  return { generado, mundo, buscador, simulacion };
}

function avanzar(simulacion: Simulacion, ticks: number): void {
  for (let t = 0; t < ticks; t++) simulacion.paso(PASO_SIMULACION);
}

/** Todas las entidades de una clase y bando. */
function buscarEntidades(
  mundo: Mundo,
  clase: Clase,
  bando: Bando | null = null,
): Entidad[] {
  const salida: Entidad[] = [];
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== clase) continue;
    if (bando !== null && mundo.bando[i] !== bando) continue;
    salida.push(mundo.entidadDeIndice(i));
  }
  return salida;
}

function masCercana(mundo: Mundo, desde: Entidad, candidatas: Entidad[]): Entidad {
  const o = indiceDe(desde);
  let mejor = candidatas[0]!;
  let mejorDistancia = Infinity;
  for (const candidata of candidatas) {
    const c = indiceDe(candidata);
    const d = Math.hypot(mundo.x[c] - mundo.x[o], mundo.z[c] - mundo.z[o]);
    if (d < mejorDistancia) {
      mejorDistancia = d;
      mejor = candidata;
    }
  }
  return mejor;
}

describe('partida completa', () => {
  it('puebla el mapa con dos bases enfrentadas y sus recursos', () => {
    const { mundo } = montarPartida();

    const unidadesHumanas = buscarEntidades(mundo, Clase.UNIDAD, Bando.HUMANOS);
    const unidadesOrcas = buscarEntidades(mundo, Clase.UNIDAD, Bando.ORCOS);
    const edificios = buscarEntidades(mundo, Clase.EDIFICIO);
    const yacimientos = buscarEntidades(mundo, Clase.YACIMIENTO);

    expect(unidadesHumanas.length).toBeGreaterThanOrEqual(4);
    expect(unidadesOrcas.length).toBe(unidadesHumanas.length);
    expect(edificios.length).toBeGreaterThanOrEqual(2);
    expect(yacimientos.length).toBeGreaterThan(50);

    // El techo de población debe salir del ayuntamiento, o no se podría entrenar nada.
    expect(mundo.estadoDe(Bando.HUMANOS).poblacionMaxima).toBeGreaterThan(0);
  });

  it('un obrero llega a la mina, pica y entrega el oro en el ayuntamiento', () => {
    const { mundo, simulacion } = montarPartida();

    const obreros = buscarEntidades(mundo, Clase.UNIDAD, Bando.HUMANOS);
    const minas = buscarEntidades(mundo, Clase.YACIMIENTO).filter(
      (e) => mundo.tipo[indiceDe(e)] === TipoYacimiento.MINA_ORO,
    );
    expect(obreros.length).toBeGreaterThan(0);
    expect(minas.length).toBeGreaterThan(0);

    const obrero = obreros[0]!;
    const mina = masCercana(mundo, obrero, minas);
    const i = indiceDe(obrero);

    const oroInicial = mundo.estadoDe(Bando.HUMANOS).oro;
    expect(ordenarRecolectar(mundo, [obrero], mina)).toBe(1);

    // Un ciclo completo de ida, picado y vuelta cabe de sobra en 60 segundos.
    let llegoARecolectar = false;
    let caminoAlgunaVez = false;
    for (let t = 0; t < 1200; t++) {
      simulacion.paso(PASO_SIMULACION);
      if (mundo.estado[i] === EstadoUnidad.CAMINANDO) caminoAlgunaVez = true;
      if (mundo.estado[i] === EstadoUnidad.RECOLECTANDO) llegoARecolectar = true;
    }

    expect(caminoAlgunaVez, 'el obrero nunca se puso en marcha').toBe(true);
    expect(llegoARecolectar, 'el obrero nunca llegó a picar').toBe(true);
    expect(
      mundo.estadoDe(Bando.HUMANOS).oroRecogido,
      'el obrero nunca entregó oro en el depósito',
    ).toBeGreaterThan(0);
    expect(mundo.estadoDe(Bando.HUMANOS).oro).toBeGreaterThan(oroInicial);
  });

  it('varios obreros reparten el trabajo sin quedarse atascados', () => {
    const { mundo, simulacion } = montarPartida();

    const obreros = buscarEntidades(mundo, Clase.UNIDAD, Bando.HUMANOS);
    const minas = buscarEntidades(mundo, Clase.YACIMIENTO).filter(
      (e) => mundo.tipo[indiceDe(e)] === TipoYacimiento.MINA_ORO,
    );
    const mina = masCercana(mundo, obreros[0]!, minas);

    ordenarRecolectar(mundo, obreros, mina);
    avanzar(simulacion, 1500);

    const estado = mundo.estadoDe(Bando.HUMANOS);
    expect(estado.oroRecogido).toBeGreaterThan(0);

    // Ningún obrero debe haber quedado clavado en el sitio con la orden puesta.
    for (const obrero of obreros) {
      const i = indiceDe(obrero);
      if (mundo.activos[i] !== 1) continue;
      expect(mundo.tiempoAtascado[i]).toBeLessThan(10);
    }
  });

  it('la simulación es determinista con la misma semilla', () => {
    const a = montarPartida(777);
    const b = montarPartida(777);

    const obrerosA = buscarEntidades(a.mundo, Clase.UNIDAD, Bando.HUMANOS);
    const obrerosB = buscarEntidades(b.mundo, Clase.UNIDAD, Bando.HUMANOS);
    const minasA = buscarEntidades(a.mundo, Clase.YACIMIENTO).filter(
      (e) => a.mundo.tipo[indiceDe(e)] === TipoYacimiento.MINA_ORO,
    );
    const minasB = buscarEntidades(b.mundo, Clase.YACIMIENTO).filter(
      (e) => b.mundo.tipo[indiceDe(e)] === TipoYacimiento.MINA_ORO,
    );

    ordenarRecolectar(a.mundo, obrerosA, masCercana(a.mundo, obrerosA[0]!, minasA));
    ordenarRecolectar(b.mundo, obrerosB, masCercana(b.mundo, obrerosB[0]!, minasB));

    avanzar(a.simulacion, 600);
    avanzar(b.simulacion, 600);

    expect(a.mundo.estadoDe(Bando.HUMANOS).oro).toBe(b.mundo.estadoDe(Bando.HUMANOS).oro);
    for (let i = 1; i <= a.mundo.indiceMaximo; i++) {
      expect(a.mundo.x[i]).toBeCloseTo(b.mundo.x[i], 6);
      expect(a.mundo.z[i]).toBeCloseTo(b.mundo.z[i], 6);
    }
  });
});
