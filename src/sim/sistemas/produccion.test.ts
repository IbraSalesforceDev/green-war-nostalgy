import { beforeEach, describe, expect, it } from 'vitest';
import { bus } from '../../core/events';
import { REEMBOLSO_CANCELACION } from '../constantes';
import { fichaUnidad } from '../datos/unidades';
import { crearEdificio, crearUnidad } from '../fabrica';
import { Bando, Clase, Orden, TipoEdificio, TipoUnidad, indiceDe } from '../tipos';
import { BuscadorRecto, crearMundoDePruebas } from './comun.test';
import { Simulacion } from './orquestador';
import { MAX_COLA, cancelarProduccion, colaDe, encolarUnidad, fijarPuntoReunion } from './produccion';

const PASO = 0.05;

function contarUnidades(mundo: ReturnType<typeof crearMundoDePruebas>, bando: Bando): number {
  let n = 0;
  for (let i = 1; i <= mundo.indiceMaximo; i++) {
    if (mundo.activos[i] !== 1) continue;
    if (mundo.clase[i] !== Clase.UNIDAD) continue;
    if (mundo.bando[i] !== bando) continue;
    if (mundo.vida[i] <= 0) continue;
    n++;
  }
  return n;
}

describe('sistema de producción', () => {
  beforeEach(() => {
    bus.limpiar();
  });

  it('cobra por adelantado y saca la unidad al terminar el tiempo', () => {
    const mundo = crearMundoDePruebas(31);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const estado = mundo.estadoDe(Bando.HUMANOS);
    const ficha = fichaUnidad(TipoUnidad.CAMPESINO);
    const oroAntes = estado.oro;

    let producidos = 0;
    bus.al('producidoTerminado', () => producidos++);

    expect(encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO)).toBe(true);
    expect(estado.oro).toBe(oroAntes - ficha.coste.oro);
    expect(colaDe(mundo, ayuntamiento)?.length).toBe(1);

    const ticks = Math.ceil(ficha.tiempoEntrenamiento / PASO) + 5;
    for (let t = 0; t < ticks; t++) sim.paso(PASO);

    expect(producidos).toBe(1);
    expect(contarUnidades(mundo, Bando.HUMANOS)).toBe(1);
    expect(estado.poblacion).toBe(ficha.coste.poblacion);
    expect(estado.unidadesEntrenadas).toBe(1);
    expect(colaDe(mundo, ayuntamiento)).toBeNull();
  });

  it('rechaza lo que no entrena, lo que no puede pagar y la cola llena', () => {
    const mundo = crearMundoDePruebas(32);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const estado = mundo.estadoDe(Bando.HUMANOS);

    // El ayuntamiento no entrena soldados.
    expect(encolarUnidad(mundo, ayuntamiento, TipoUnidad.SOLDADO)).toBe(false);

    estado.oro = 10000;
    for (let k = 0; k < MAX_COLA; k++) {
      expect(encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO)).toBe(true);
    }
    expect(encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO)).toBe(false);

    estado.oro = 0;
    const otro = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 20, 20, true);
    expect(encolarUnidad(mundo, otro, TipoUnidad.CAMPESINO)).toBe(false);
  });

  it('cancelar devuelve el porcentaje acordado del coste', () => {
    const mundo = crearMundoDePruebas(33);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const estado = mundo.estadoDe(Bando.HUMANOS);
    const ficha = fichaUnidad(TipoUnidad.CAMPESINO);
    const oroAntes = estado.oro;

    encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO);
    expect(cancelarProduccion(mundo, ayuntamiento, 0)).toBe(true);

    expect(estado.oro).toBeCloseTo(
      oroAntes - ficha.coste.oro + ficha.coste.oro * REEMBOLSO_CANCELACION,
      6,
    );
    expect(colaDe(mundo, ayuntamiento)).toBeNull();
    expect(cancelarProduccion(mundo, ayuntamiento, 0)).toBe(false);
  });

  it('la población llena bloquea la salida y avisa, y se desbloquea con una granja', () => {
    const mundo = crearMundoDePruebas(34);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    const estado = mundo.estadoDe(Bando.HUMANOS);
    estado.oro = 10000;

    // El ayuntamiento da 5 de población: se ocupa entera con cinco campesinos.
    for (let k = 0; k < estado.poblacionMaxima; k++) {
      crearUnidad(mundo, TipoUnidad.CAMPESINO, Bando.HUMANOS, 20 + k, 30);
    }
    expect(estado.poblacion).toBe(estado.poblacionMaxima);

    let avisos = 0;
    bus.al('aviso', (datos) => {
      if (datos.clave === 'poblacion-llena') avisos++;
    });

    encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO);
    const ticks = Math.ceil(fichaUnidad(TipoUnidad.CAMPESINO).tiempoEntrenamiento / PASO) + 100;
    for (let t = 0; t < ticks; t++) sim.paso(PASO);

    // Sigue esperando en la cola, con el temporizador a cero.
    expect(colaDe(mundo, ayuntamiento)?.length).toBe(1);
    expect(colaDe(mundo, ayuntamiento)?.[0]?.restante).toBe(0);
    expect(contarUnidades(mundo, Bando.HUMANOS)).toBe(5);
    expect(avisos).toBeGreaterThan(0);

    // Una granja terminada sube el techo y la unidad sale en el acto.
    crearEdificio(mundo, TipoEdificio.GRANJA, Bando.HUMANOS, 30, 30, true);
    sim.paso(PASO);
    expect(contarUnidades(mundo, Bando.HUMANOS)).toBe(6);
    expect(colaDe(mundo, ayuntamiento)).toBeNull();
  });

  it('la unidad recién salida obedece el punto de reunión', () => {
    const mundo = crearMundoDePruebas(35);
    const sim = new Simulacion(mundo, new BuscadorRecto());
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);

    expect(fijarPuntoReunion(mundo, ayuntamiento, 25.5, 25.5)).toBe(true);
    encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO);

    const ticks = Math.ceil(fichaUnidad(TipoUnidad.CAMPESINO).tiempoEntrenamiento / PASO) + 2;
    for (let t = 0; t < ticks; t++) sim.paso(PASO);

    let nueva = 0;
    for (let i = 1; i <= mundo.indiceMaximo; i++) {
      if (mundo.activos[i] === 1 && mundo.clase[i] === Clase.UNIDAD) nueva = i;
    }
    expect(nueva).not.toBe(0);
    expect(mundo.orden[nueva]).toBe(Orden.MOVER);
    expect(mundo.ordenX[nueva]).toBeCloseTo(25.5, 5);

    // Y de verdad camina hacia allí.
    const distanciaInicial = Math.hypot(mundo.x[nueva] - 25.5, mundo.z[nueva] - 25.5);
    for (let t = 0; t < 40; t++) sim.paso(PASO);
    expect(Math.hypot(mundo.x[nueva] - 25.5, mundo.z[nueva] - 25.5)).toBeLessThan(distanciaInicial);
  });

  it('un edificio destruido se lleva su cola por delante', () => {
    const mundo = crearMundoDePruebas(36);
    const ayuntamiento = crearEdificio(mundo, TipoEdificio.AYUNTAMIENTO, Bando.HUMANOS, 10, 10, true);
    encolarUnidad(mundo, ayuntamiento, TipoUnidad.CAMPESINO);
    expect(mundo.colas.has(indiceDe(ayuntamiento))).toBe(true);
    mundo.destruir(ayuntamiento);
    expect(mundo.colas.size).toBe(0);
  });
});
