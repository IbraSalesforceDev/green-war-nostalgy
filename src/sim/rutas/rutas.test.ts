import { describe, expect, it } from 'vitest';

import { MAX_NODOS_ASTAR, MAX_RUTAS_POR_TICK, TAM_CASILLA } from '../constantes';
import { MapaJuego } from '../mapa';
import { Bloqueo } from '../tipos';
import { BuscadorRutasRejilla, type OpcionesBuscador } from './buscador';
import type { PeticionRuta, ResultadoRuta } from './contrato';

/**
 * Pruebas de la búsqueda de caminos.
 *
 * Todos los mapas se construyen a mano: el generador de mapas cambia y no queremos
 * que un ajuste de decorados rompa las pruebas del buscador. Con `TAM_CASILLA = 1`
 * la coordenada de mundo `c + 0.5` es el centro de la casilla `c`.
 */

// --- Utilidades de construcción ---

function mapaVacio(ancho: number, alto: number): MapaJuego {
  return new MapaJuego(ancho, alto);
}

function bloquear(mapa: MapaJuego, cx: number, cz: number): void {
  mapa.marcarBloqueo(cx, cz, Bloqueo.EDIFICIO, 1);
}

function bloquearRectangulo(
  mapa: MapaJuego,
  cx0: number,
  cz0: number,
  cx1: number,
  cz1: number,
): void {
  for (let cz = cz0; cz <= cz1; cz++) {
    for (let cx = cx0; cx <= cx1; cx++) bloquear(mapa, cx, cz);
  }
}

/** Centro de la casilla `c` en coordenadas de mundo. */
function centro(c: number): number {
  return (c + 0.5) * TAM_CASILLA;
}

function peticion(parcial: Partial<PeticionRuta> & { entidad: number }): PeticionRuta {
  return {
    origenX: 0,
    origenZ: 0,
    destinoX: 0,
    destinoZ: 0,
    radio: 0,
    tolerancia: 0,
    prioridad: 1,
    ...parcial,
  };
}

/** Pide una ruta y hace correr ticks hasta que el buscador contesta. */
function resolver(
  buscador: BuscadorRutasRejilla,
  p: PeticionRuta,
  maxTicks = 8,
): ResultadoRuta {
  buscador.pedir(p);
  for (let tick = 1; tick <= maxTicks; tick++) {
    buscador.actualizar(tick);
    const resultado = buscador.recoger(p.entidad);
    if (resultado.estado !== 'pendiente') return resultado;
  }
  return { estado: 'pendiente' };
}

function rutaDe(buscador: BuscadorRutasRejilla, p: PeticionRuta): Float32Array {
  const resultado = resolver(buscador, p);
  expect(resultado.estado).toBe('lista');
  if (resultado.estado !== 'lista') throw new Error('sin ruta');
  return resultado.ruta.puntos;
}

// --- Validación geométrica de una ruta ---

interface RecorridoRuta {
  /** Casillas distintas por las que pasa la polilínea, en orden. */
  casillas: number[];
  /** Longitud total de la polilínea. */
  largo: number;
  /** Primer paso ilegal encontrado, si lo hay. */
  fallo: string | null;
}

/**
 * Recorre la polilínea de la ruta a pasos pequeños y comprueba que cada cambio de
 * casilla es legal: nada de atravesar bloqueos, nada de cortar esquinas en diagonal
 * y nada de subir un escalón fuera de una rampa.
 */
function recorrer(
  mapa: MapaJuego,
  origenX: number,
  origenZ: number,
  puntos: Float32Array,
): RecorridoRuta {
  const casillas: number[] = [];
  let fallo: string | null = null;
  let largo = 0;

  let x = origenX;
  let z = origenZ;
  let cx = mapa.aCasilla(x);
  let cz = mapa.aCasilla(z);
  casillas.push(mapa.indice(cx, cz));
  if (!mapa.transitable(cx, cz)) fallo = `origen bloqueado en (${cx}, ${cz})`;

  const total = puntos.length >> 1;
  for (let k = 0; k < total; k++) {
    const px = puntos[k * 2];
    const pz = puntos[k * 2 + 1];
    const dx = px - x;
    const dz = pz - z;
    const distancia = Math.sqrt(dx * dx + dz * dz);
    largo += distancia;

    const pasos = Math.max(1, Math.ceil(distancia / 0.05));
    for (let s = 1; s <= pasos; s++) {
      const t = s / pasos;
      const mx = mapa.aCasilla(x + dx * t);
      const mz = mapa.aCasilla(z + dz * t);
      if (mx === cx && mz === cz) continue;

      const diagonal = mx !== cx && mz !== cz;
      if (!mapa.transitableEntre(cx, cz, mx, mz)) {
        fallo ??= `paso ilegal (${cx}, ${cz}) -> (${mx}, ${mz})`;
      } else if (diagonal) {
        if (!mapa.transitableEntre(cx, cz, mx, cz) || !mapa.transitableEntre(cx, cz, cx, mz)) {
          fallo ??= `esquina cortada (${cx}, ${cz}) -> (${mx}, ${mz})`;
        }
      }
      cx = mx;
      cz = mz;
      casillas.push(mapa.indice(cx, cz));
    }

    x = px;
    z = pz;
  }

  return { casillas, largo, fallo };
}

// --- Pruebas ---

describe('BuscadorRutasRejilla · caminos básicos', () => {
  it('en un mapa vacío devuelve una línea recta de un solo punto', () => {
    const mapa = mapaVacio(32, 32);
    const buscador = new BuscadorRutasRejilla(mapa);

    const p = peticion({
      entidad: 7,
      origenX: centro(4),
      origenZ: centro(16),
      destinoX: centro(27),
      destinoZ: centro(16),
      radio: 0.3,
    });
    const puntos = rutaDe(buscador, p);

    // Tras el suavizado no debe quedar ni un solo quiebre.
    expect(puntos.length).toBe(2);
    expect(puntos[0]).toBeCloseTo(p.destinoX, 5);
    expect(puntos[1]).toBeCloseTo(p.destinoZ, 5);

    const recorrido = recorrer(mapa, p.origenX, p.origenZ, puntos);
    expect(recorrido.fallo).toBeNull();
  });

  it('rodea un muro en U sin atravesarlo', () => {
    const mapa = mapaVacio(24, 24);
    // Muro en U abierto por la derecha: hay que dar toda la vuelta.
    bloquearRectangulo(mapa, 10, 4, 10, 19); // palo vertical
    bloquearRectangulo(mapa, 10, 4, 16, 4); // brazo superior
    bloquearRectangulo(mapa, 10, 19, 16, 19); // brazo inferior
    const buscador = new BuscadorRutasRejilla(mapa);

    const p = peticion({
      entidad: 1,
      origenX: centro(4),
      origenZ: centro(12),
      destinoX: centro(14),
      destinoZ: centro(12),
    });
    const puntos = rutaDe(buscador, p);
    const recorrido = recorrer(mapa, p.origenX, p.origenZ, puntos);

    expect(recorrido.fallo).toBeNull();
    for (const indice of recorrido.casillas) {
      expect(mapa.bloqueos[indice]).toBe(Bloqueo.LIBRE);
    }
    // Ha tenido que rodear: la distancia en línea recta son 10 casillas.
    expect(recorrido.largo).toBeGreaterThan(20);
    expect(puntos.length >> 1).toBeGreaterThan(1);
  });

  it('no corta la esquina entre dos bloqueos ortogonales', () => {
    const mapa = mapaVacio(16, 16);
    bloquear(mapa, 5, 4);
    bloquear(mapa, 4, 5);
    const buscador = new BuscadorRutasRejilla(mapa);

    const p = peticion({
      entidad: 3,
      origenX: centro(4),
      origenZ: centro(4),
      destinoX: centro(5),
      destinoZ: centro(5),
    });
    const puntos = rutaDe(buscador, p);
    const recorrido = recorrer(mapa, p.origenX, p.origenZ, puntos);

    expect(recorrido.fallo).toBeNull();
    // El atajo diagonal directo está prohibido: hay que rodear alguno de los dos bloques.
    expect(recorrido.largo).toBeGreaterThan(Math.SQRT2 + 0.5);
    const casillas = recorrido.casillas;
    for (let k = 1; k < casillas.length; k++) {
      const anterior = casillas[k - 1];
      const actual = casillas[k];
      const salto =
        anterior === mapa.indice(4, 4) && actual === mapa.indice(5, 5);
      expect(salto).toBe(false);
    }
  });
});

describe('BuscadorRutasRejilla · destinos difíciles', () => {
  it('con el destino bloqueado se queda en la casilla libre más cercana', () => {
    const mapa = mapaVacio(24, 24);
    bloquearRectangulo(mapa, 9, 9, 11, 11); // edificio de 3x3
    const buscador = new BuscadorRutasRejilla(mapa);

    const p = peticion({
      entidad: 5,
      origenX: centro(2),
      origenZ: centro(2),
      destinoX: centro(10),
      destinoZ: centro(10), // justo en el centro del edificio
    });
    const puntos = rutaDe(buscador, p);
    const recorrido = recorrer(mapa, p.origenX, p.origenZ, puntos);
    expect(recorrido.fallo).toBeNull();

    const total = puntos.length >> 1;
    const finalX = mapa.aCasilla(puntos[(total - 1) * 2]);
    const finalZ = mapa.aCasilla(puntos[(total - 1) * 2 + 1]);
    expect(mapa.transitable(finalX, finalZ)).toBe(true);
    // Pegada al edificio, no en cualquier sitio.
    expect(Math.max(Math.abs(finalX - 10), Math.abs(finalZ - 10))).toBeLessThanOrEqual(2);
  });

  it('declara imposible un destino en una isla cerrada, y rápido', () => {
    const mapa = mapaVacio(24, 24);
    // Recinto hueco de 5x5 con paredes: el interior es inalcanzable.
    bloquearRectangulo(mapa, 14, 14, 18, 14);
    bloquearRectangulo(mapa, 14, 18, 18, 18);
    bloquearRectangulo(mapa, 14, 14, 14, 18);
    bloquearRectangulo(mapa, 18, 14, 18, 18);
    const buscador = new BuscadorRutasRejilla(mapa);

    const inicio = performance.now();
    const resultado = resolver(
      buscador,
      peticion({
        entidad: 9,
        origenX: centro(2),
        origenZ: centro(2),
        destinoX: centro(16),
        destinoZ: centro(16),
      }),
    );
    const ms = performance.now() - inicio;

    expect(resultado.estado).toBe('imposible');
    // La frontera se agota sola: ni se acerca al presupuesto de nodos.
    expect(buscador.estadisticas().nodosPeorCaso).toBeLessThan(MAX_NODOS_ASTAR);
    expect(ms).toBeLessThan(150);
  });

  it('solo cruza un desnivel por la rampa', () => {
    const mapa = mapaVacio(24, 24);
    // Meseta a nivel 1 en la mitad derecha; única rampa en (12, 6).
    for (let cz = 0; cz < mapa.alto; cz++) {
      for (let cx = 12; cx < mapa.ancho; cx++) mapa.niveles[mapa.indice(cx, cz)] = 1;
    }
    mapa.rampas[mapa.indice(12, 6)] = 1;
    const buscador = new BuscadorRutasRejilla(mapa);

    const p = peticion({
      entidad: 11,
      origenX: centro(3),
      origenZ: centro(18),
      destinoX: centro(20),
      destinoZ: centro(18),
    });
    const puntos = rutaDe(buscador, p);
    const recorrido = recorrer(mapa, p.origenX, p.origenZ, puntos);

    expect(recorrido.fallo).toBeNull();
    expect(recorrido.casillas).toContain(mapa.indice(12, 6));
    // El desvío hasta la rampa es obligado: mucho más largo que las 17 casillas rectas.
    expect(recorrido.largo).toBeGreaterThan(25);
  });
});

describe('BuscadorRutasRejilla · cola, campos y determinismo', () => {
  it('dos consultas idénticas dan exactamente la misma ruta', () => {
    const mapa = mapaVacio(48, 48);
    bloquearRectangulo(mapa, 20, 4, 20, 40);
    bloquearRectangulo(mapa, 30, 10, 30, 46);
    const buscador = new BuscadorRutasRejilla(mapa);

    const hacer = (entidad: number): Float32Array =>
      rutaDe(
        buscador,
        peticion({
          entidad,
          origenX: centro(3),
          origenZ: centro(24),
          destinoX: centro(44),
          destinoZ: centro(24),
          radio: 0.35,
        }),
      );

    const primera = Array.from(hacer(21));
    const segunda = Array.from(hacer(21));
    const tercera = Array.from(hacer(22));

    expect(segunda).toEqual(primera);
    expect(tercera).toEqual(primera);

    // Y también con un buscador recién creado: nada de estado acumulado.
    const otro = new BuscadorRutasRejilla(mapa);
    const cuarta = Array.from(
      rutaDe(
        otro,
        peticion({
          entidad: 21,
          origenX: centro(3),
          origenZ: centro(24),
          destinoX: centro(44),
          destinoZ: centro(24),
          radio: 0.35,
        }),
      ),
    );
    expect(cuarta).toEqual(primera);
  });

  it('veinte unidades al mismo destino comparten un único campo de flujo', () => {
    const mapa = mapaVacio(48, 48);
    bloquearRectangulo(mapa, 24, 6, 24, 36);
    const buscador = new BuscadorRutasRejilla(mapa);

    const destinoX = centro(40);
    const destinoZ = centro(40);
    for (let n = 0; n < 20; n++) {
      buscador.pedir(
        peticion({
          entidad: 100 + n,
          origenX: centro(2 + (n % 5)),
          origenZ: centro(2 + n),
          destinoX,
          destinoZ,
        }),
      );
    }

    for (let tick = 1; tick <= 4; tick++) buscador.actualizar(tick);

    const stats = buscador.estadisticas();
    expect(stats.pendientes).toBe(0);
    expect(stats.camposCalculados).toBe(1);
    expect(stats.busquedasAEstrella).toBe(0);
    expect(stats.serviciosPorCampo).toBe(20);

    for (let n = 0; n < 20; n++) {
      const resultado = buscador.recoger(100 + n);
      expect(resultado.estado).toBe('lista');
      if (resultado.estado !== 'lista') continue;
      const recorrido = recorrer(
        mapa,
        centro(2 + (n % 5)),
        centro(2 + n),
        resultado.ruta.puntos,
      );
      expect(recorrido.fallo).toBeNull();
    }

    // Al invalidar la región el campo se tira y la siguiente tanda lo recalcula.
    buscador.invalidarRegion(24, 20, 6);
    for (let n = 0; n < 20; n++) {
      buscador.pedir(
        peticion({ entidad: 200 + n, origenX: centro(3), origenZ: centro(3), destinoX, destinoZ }),
      );
    }
    for (let tick = 5; tick <= 8; tick++) buscador.actualizar(tick);
    expect(buscador.estadisticas().camposCalculados).toBe(2);
  });

  it('respeta el tope por tick, deduplica por entidad y cancela', () => {
    const mapa = mapaVacio(48, 48);
    // Umbral alto: cada petición va por A*, que es lo que consume presupuesto.
    const opciones: OpcionesBuscador = { umbralCampoFlujo: 1000 };
    const buscador = new BuscadorRutasRejilla(mapa, opciones);

    for (let n = 0; n < 30; n++) {
      buscador.pedir(
        peticion({
          entidad: 1 + n,
          origenX: centro(1 + n),
          origenZ: centro(1),
          destinoX: centro(40),
          destinoZ: centro(10 + n),
          prioridad: n < 5 ? 5 : 1, // las cinco primeras son órdenes del jugador
        }),
      );
    }
    expect(buscador.estadisticas().pendientes).toBe(30);

    buscador.actualizar(1);
    expect(buscador.estadisticas().calculadasEsteTick).toBe(MAX_RUTAS_POR_TICK);
    expect(buscador.estadisticas().pendientes).toBe(30 - MAX_RUTAS_POR_TICK);
    // Las prioritarias se sirven primero.
    for (let n = 0; n < 5; n++) expect(buscador.recoger(1 + n).estado).toBe('lista');

    // Deduplicación: repetir la petición de una entidad no crea una segunda.
    const antes = buscador.estadisticas().pendientes;
    buscador.pedir(
      peticion({
        entidad: 30,
        origenX: centro(2),
        origenZ: centro(2),
        destinoX: centro(20),
        destinoZ: centro(20),
      }),
    );
    buscador.pedir(
      peticion({
        entidad: 30,
        origenX: centro(2),
        origenZ: centro(2),
        destinoX: centro(21),
        destinoZ: centro(21),
      }),
    );
    expect(buscador.estadisticas().pendientes).toBe(antes);

    // Cancelar la olvida del todo.
    buscador.cancelar(30);
    expect(buscador.estadisticas().pendientes).toBe(antes - 1);
    for (let tick = 2; tick <= 6; tick++) buscador.actualizar(tick);
    expect(buscador.recoger(30).estado).toBe('imposible');
    expect(buscador.estadisticas().pendientes).toBe(0);
  });
});

describe('BuscadorRutasRejilla · rendimiento', () => {
  it('resuelve 200 búsquedas en un 96x96 con obstáculos dentro del presupuesto', () => {
    const lado = 96;
    const mapa = mapaVacio(lado, lado);
    // Retícula de bloques de 4x4 cada 8 casillas: obliga a serpentear de verdad.
    for (let cz = 4; cz < lado - 4; cz += 8) {
      for (let cx = 4; cx < lado - 4; cx += 8) {
        bloquearRectangulo(mapa, cx, cz, cx + 3, cz + 3);
      }
    }

    // Una ruta por tick: así cada `actualizar` mide exactamente una búsqueda y se
    // puede aislar el peor caso, que es el número que de verdad importa.
    const buscador = new BuscadorRutasRejilla(mapa, {
      maxRutasPorTick: 1,
      umbralCampoFlujo: 1000, // fuera campos de flujo: aquí se mide el A*
    });

    // Generador congruencial: determinista, sin Math.random.
    let semilla = 123456789;
    const siguiente = (tope: number): number => {
      semilla = (semilla * 1103515245 + 12345) & 0x7fffffff;
      return semilla % tope;
    };
    const libre = (): [number, number] => {
      for (;;) {
        const cx = siguiente(lado);
        const cz = siguiente(lado);
        if (mapa.transitable(cx, cz)) return [cx, cz];
      }
    };

    const total = 200;
    const origenes: [number, number][] = [];
    for (let n = 0; n < total; n++) {
      const origen = libre();
      const destino = libre();
      origenes.push(origen);
      buscador.pedir(
        peticion({
          entidad: 1 + n,
          origenX: centro(origen[0]),
          origenZ: centro(origen[1]),
          destinoX: centro(destino[0]),
          destinoZ: centro(destino[1]),
          radio: 0.35,
        }),
      );
    }

    let ms = 0;
    let peorMs = 0;
    let nodosTotales = 0;
    let peorNodos = 0;
    for (let tick = 1; tick <= total; tick++) {
      const inicio = performance.now();
      buscador.actualizar(tick);
      const transcurrido = performance.now() - inicio;
      ms += transcurrido;
      if (transcurrido > peorMs) peorMs = transcurrido;
      const parcial = buscador.estadisticas();
      expect(parcial.calculadasEsteTick).toBe(1);
      nodosTotales += parcial.nodosExplorados;
      if (parcial.nodosExplorados > peorNodos) peorNodos = parcial.nodosExplorados;
    }

    const stats = buscador.estadisticas();
    expect(stats.busquedasAEstrella).toBe(total);
    expect(stats.pendientes).toBe(0);
    expect(peorNodos).toBe(stats.nodosPeorCaso);

    let listas = 0;
    for (let n = 0; n < total; n++) {
      const resultado = buscador.recoger(1 + n);
      if (resultado.estado !== 'lista') continue;
      listas++;
      const origen = origenes[n];
      const recorrido = recorrer(
        mapa,
        centro(origen[0]),
        centro(origen[1]),
        resultado.ruta.puntos,
      );
      expect(recorrido.fallo).toBeNull();
    }
    expect(listas).toBe(total);

    // Cifras al informe: nodos y milisegundos por búsqueda.
    const msPorBusqueda = ms / total;
    const nodosPorBusqueda = nodosTotales / total;
    console.log(
      `[rutas] 200 búsquedas 96x96: ${ms.toFixed(1)} ms totales, ` +
        `media ${msPorBusqueda.toFixed(3)} ms y ${nodosPorBusqueda.toFixed(0)} nodos; ` +
        `peor caso ${peorMs.toFixed(3)} ms y ${peorNodos} nodos`,
    );

    // Presupuesto: un tick de simulación son 50 ms y caben MAX_RUTAS_POR_TICK rutas.
    expect(ms).toBeLessThan(1500);
    expect(msPorBusqueda).toBeLessThan(4);
    expect(peorMs).toBeLessThan(25);
    expect(peorNodos).toBeLessThanOrEqual(MAX_NODOS_ASTAR);
  });
});
