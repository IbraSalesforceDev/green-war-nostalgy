import { describe, expect, it } from 'vitest';
import { Arma, BandoCampana, type Composicion } from '../campana/tipos';
import { Batalla, EstadoUnidad, PASO_BATALLA, Postura } from './batalla';
import { IABatalla } from './ia';

/**
 * El mando de la máquina.
 *
 * Lo que hay que comprobar de una IA no es que tome «la» decisión correcta en
 * cada instante —eso es una opinión—, sino dos cosas que sí son verificables:
 * que respeta las reglas que dice respetar, y que dirigir sirve de algo. Lo
 * segundo es lo único que justifica que exista: si un ejército mandado no le
 * gana a uno idéntico sin mandar, el mando es decoración.
 */

const UNION = BandoCampana.UNION;
const CONFEDERACION = BandoCampana.CONFEDERACION;

function composicion(inf: number, cab: number, art: number): Composicion {
  return [inf, cab, art];
}

/** Monta una batalla suelta, sin escena ni render. */
function montar(opciones: {
  semilla: number;
  atacante?: Composicion;
  defensor?: Composicion;
}): Batalla {
  return new Batalla({
    atacante: UNION,
    composicionAtacante: opciones.atacante ?? composicion(6, 3, 2),
    composicionDefensor: opciones.defensor ?? composicion(6, 3, 2),
    bandoJugador: UNION,
    enFuerte: false,
    semilla: opciones.semilla,
  });
}

/** Corre una batalla entera. `mandados` son los bandos que llevan IA. */
function batir(batalla: Batalla, mandados: readonly BandoCampana[]): Batalla {
  const mandos = mandados.map((bando) => new IABatalla(batalla, bando));
  let vueltas = 0;
  while (!batalla.terminada && vueltas < 60 * 60) {
    for (const mando of mandos) mando.actualizar(PASO_BATALLA);
    batalla.paso(PASO_BATALLA);
    vueltas++;
  }
  return batalla;
}

describe('el mando de la máquina en la batalla', () => {
  it('no usa nada que no tenga también quien juega', () => {
    // La máquina manda por la misma puerta que los botones: posturas y carga.
    // Si algún día se le diera acceso a otra cosa, esta prueba no lo detectaría,
    // pero el repaso de `ia.ts` sí: no hay ahí ninguna otra llamada a `batalla`
    // que no sea de consulta.
    const batalla = montar({ semilla: 1 });
    const mando = new IABatalla(batalla, CONFEDERACION);
    mando.actualizar(PASO_BATALLA);
    // Las posturas del bando de la persona siguen intactas: la máquina solo
    // toca las suyas.
    for (const arma of [Arma.INFANTERIA, Arma.CABALLERIA, Arma.ARTILLERIA]) {
      expect(batalla.posturaDe(UNION, arma)).toBe(Postura.AVANZAR);
    }
  });

  it('planta la infantería en cuanto tiene el enemigo a tiro', () => {
    const batalla = montar({ semilla: 7 });
    const mando = new IABatalla(batalla, CONFEDERACION);

    // Al desplegar, las líneas están más lejos que el alcance del fusil.
    expect(batalla.posturaDe(CONFEDERACION, Arma.INFANTERIA)).toBe(Postura.AVANZAR);

    // Se acerca a las dos líneas hasta ponerlas a distancia de fuego.
    for (const unidad of batalla.unidades) unidad.x *= 0.1;
    mando.actualizar(10);
    expect(batalla.posturaDe(CONFEDERACION, Arma.INFANTERIA)).toBe(Postura.MANTENER);
  });

  it('repliega los cañones cuando se los echan encima', () => {
    const batalla = montar({ semilla: 11 });
    const mando = new IABatalla(batalla, CONFEDERACION);

    // Un jinete de la Unión se planta encima de la batería confederada.
    const canon = batalla.unidades.find(
      (u) => u.bando === CONFEDERACION && u.arma === Arma.ARTILLERIA,
    )!;
    const jinete = batalla.unidades.find(
      (u) => u.bando === UNION && u.arma === Arma.CABALLERIA,
    )!;
    jinete.x = canon.x + 2;
    jinete.z = canon.z;

    mando.actualizar(10);
    expect(batalla.posturaDe(CONFEDERACION, Arma.ARTILLERIA)).toBe(Postura.RETIRAR);
  });

  it('no lanza la caballería contra infantería fresca', () => {
    // El triángulo dice que ahí pierde: ×0,7 a favor de ella, ×1,5 en contra.
    const batalla = montar({ semilla: 3 });
    const mando = new IABatalla(batalla, CONFEDERACION);
    for (const unidad of batalla.unidades) unidad.x *= 0.3;
    mando.actualizar(10);
    expect(batalla.cargaDe(CONFEDERACION)).toBe(0);
  });

  it('carga en cuanto los cañones enemigos se quedan sin escolta', () => {
    const batalla = montar({ semilla: 3 });
    const mando = new IABatalla(batalla, CONFEDERACION);

    // Cae toda la infantería de la Unión; solo quedan sus cañones. Se marca el
    // estado directamente: bajar la vida a cero no mata a nadie, porque la
    // transición a muerta ocurre al aplicar el daño, no en un barrido aparte.
    for (const unidad of batalla.unidades) {
      unidad.x *= 0.3;
      if (unidad.bando === UNION && unidad.arma === Arma.INFANTERIA) {
        unidad.estado = EstadoUnidad.MUERTA;
      }
    }

    mando.actualizar(10);
    expect(batalla.cargaDe(CONFEDERACION)).toBeGreaterThan(0);
  });

  it('mantiene la caballería fuera del alcance de los fusiles mientras espera', () => {
    const batalla = montar({ semilla: 5 });
    const mando = new IABatalla(batalla, CONFEDERACION);
    // Infantería enemiga fresca y cerca: no toca cargar, y quedarse a tiro sin
    // cargar es lo peor de las dos opciones.
    for (const unidad of batalla.unidades) unidad.x *= 0.1;
    mando.actualizar(10);
    expect(batalla.posturaDe(CONFEDERACION, Arma.CABALLERIA)).toBe(Postura.RETIRAR);
  });

  it('es determinista: la misma semilla da la misma batalla', () => {
    const desarrollo = (semilla: number): string[] => {
      const batalla = montar({ semilla });
      const mando = new IABatalla(batalla, CONFEDERACION);
      const marcas: string[] = [];
      for (let i = 0; i < 900; i++) {
        mando.actualizar(PASO_BATALLA);
        batalla.paso(PASO_BATALLA);
        // Se compara el desarrollo, no solo el final: dos batallas distintas
        // pueden acabar en el mismo marcador.
        if (i % 60 === 0) {
          marcas.push(
            `${i}:${batalla.vivasDe(UNION).length}-${batalla.vivasDe(CONFEDERACION).length}` +
              `:${batalla.posturaDe(CONFEDERACION, Arma.CABALLERIA)}`,
          );
        }
      }
      return marcas;
    };
    expect(desarrollo(99)).toEqual(desarrollo(99));
  });

  it('no gasta ni un número del azar de la batalla', () => {
    // Si el mando tirase del mismo generador, las pruebas de determinismo de la
    // batalla dejarían de comparar lo que creen comparar.
    const conMando = montar({ semilla: 42 });
    const mando = new IABatalla(conMando, CONFEDERACION);
    for (let i = 0; i < 200; i++) mando.actualizar(PASO_BATALLA);

    const sinMando = montar({ semilla: 42 });
    expect(conMando.azar.siguiente()).toBe(sinMando.azar.siguiente());
  });

  it('dirigir gana a no dirigir', () => {
    // La prueba que justifica el fichero entero. Mismo ejército, misma semilla,
    // misma simulación: la única diferencia es que un bando tiene mando.
    let victoriasDelMando = 0;
    const partidas = 24;
    for (let semilla = 0; semilla < partidas; semilla++) {
      const batalla = batir(montar({ semilla }), [CONFEDERACION]);
      if (batalla.vencedor === CONFEDERACION) victoriasDelMando++;
    }
    // No se le pide que arrase —el azar del combate existe y las tropas sin
    // mando tampoco son tontas—, sino que la ventaja sea clara.
    expect(victoriasDelMando).toBeGreaterThan(partidas * 0.6);
  });

  it('con mando en los dos bandos la batalla sigue terminando', () => {
    // Dos mandos prudentes podrían quedarse mirándose: la artillería
    // replegándose y la caballería esperando su momento para siempre. La regla
    // antitablas de la simulación tiene que seguir bastando.
    for (let semilla = 0; semilla < 8; semilla++) {
      const batalla = batir(montar({ semilla }), [UNION, CONFEDERACION]);
      expect(batalla.terminada, `la batalla ${semilla} no terminó`).toBe(true);
    }
  });
});
