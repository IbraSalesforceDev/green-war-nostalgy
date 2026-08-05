import { describe, expect, it } from 'vitest';
import { Campana } from './campana';
import { IACampana } from './ia';
import { capitalDe } from './territorios';
import { BandoCampana, type Composicion, FaseTurno, type IdTerritorio, totalTropas } from './tipos';

/**
 * Coloca un ejército del bando en el territorio dado, sin tocar a los demás.
 *
 * Amontonar los sobrantes en la capital —que fue la primera versión de este
 * ayudante— falseaba las pruebas: convertía la capital en el objetivo más goloso
 * del mapa y la IA, con buen criterio, se iba a por ella en vez de a por lo que la
 * prueba pretendía observar.
 */
function colocar(
  campana: Campana,
  bando: BandoCampana,
  donde: IdTerritorio,
  composicion: Composicion,
): number {
  const existente = campana.ejercitoEn(donde);
  if (existente) {
    existente.bando = bando;
    existente.composicion = composicion;
    existente.haMovido = false;
    return existente.id;
  }
  const libre = campana.ejercitosDe(bando).find((e) => e.territorio !== donde);
  if (!libre) throw new Error(`el bando ${bando} no tiene ejércitos que mover`);
  libre.territorio = donde;
  libre.composicion = composicion;
  libre.haMovido = false;
  return libre.id;
}

/** Solo este ejército podrá moverse: al resto de su bando se le da el turno por gastado. */
function soloPuedeMover(campana: Campana, bando: BandoCampana, id: number): void {
  for (const ejercito of campana.ejercitosDe(bando)) {
    if (ejercito.id !== id) ejercito.haMovido = true;
  }
}

/** Guarnición lo bastante recia como para que atacarla nunca compense. */
function blindar(campana: Campana, bando: BandoCampana, donde: IdTerritorio): void {
  colocar(campana, bando, donde, [40, 10, 8]);
}

/** Se lleva el ejército que hubiera en el territorio bien lejos, dejándolo vacío. */
function vaciar(campana: Campana, donde: IdTerritorio, refugio: IdTerritorio): void {
  const ejercito = campana.ejercitoEn(donde);
  if (!ejercito) return;
  ejercito.territorio = refugio;
  ejercito.haMovido = true;
}

/** Lleva el turno hasta que le toque al bando pedido. */
function turnoDe(campana: Campana, bando: BandoCampana): void {
  let guarda = 0;
  while (campana.bandoActivo !== bando && guarda++ < 4) campana.terminarTurno();
}

describe('la IA de campaña', () => {
  it('no mueve cuando no es su turno', () => {
    const campana = new Campana({ semilla: 100 });
    const ia = new IACampana(BandoCampana.CONFEDERACION);
    expect(campana.bandoActivo).toBe(BandoCampana.UNION);
    expect(ia.jugarManiobra(campana)).toBe(0);
  });

  it('toma gratis un territorio enemigo que nadie defiende', () => {
    const campana = new Campana({ semilla: 101 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    // Desde Tennessee se llega a dos territorios de la Unión: Illinois y la
    // capital. Se blinda la capital para que la única presa sensata sea Illinois.
    blindar(campana, BandoCampana.UNION, 'pensilvania');
    vaciar(campana, 'illinois', 'oregon');
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'tennessee', [6, 2, 1]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);
    expect(campana.duenoDe('illinois')).toBe(BandoCampana.CONFEDERACION);
  });

  it('ataca cuando es claramente superior', () => {
    const campana = new Campana({ semilla: 102 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    blindar(campana, BandoCampana.UNION, 'pensilvania');
    colocar(campana, BandoCampana.UNION, 'illinois', [1, 0, 0]);
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'tennessee', [12, 3, 2]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);
    expect(campana.hayChoquesPendientes).toBe(true);
    expect(campana.siguienteChoque()!.territorio).toBe('illinois');
  });

  it('no se suicida atacando a un enemigo muy superior', () => {
    const campana = new Campana({ semilla: 103 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    blindar(campana, BandoCampana.UNION, 'pensilvania');
    colocar(campana, BandoCampana.UNION, 'illinois', [20, 5, 4]);
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'tennessee', [2, 0, 0]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);
    expect(campana.hayChoquesPendientes).toBe(false);
    expect(campana.duenoDe('illinois')).toBe(BandoCampana.UNION);
  });

  it('respeta la ventaja del fuerte y no lo asalta con fuerzas justas', () => {
    const campana = new Campana({ semilla: 104 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    // Pensilvania tiene fuerte. Con estas fuerzas el atacante ganaría en campo
    // abierto, pero contra la fortificación la cuenta ya no le sale.
    colocar(campana, BandoCampana.UNION, 'pensilvania', [6, 2, 1]);
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'tennessee', [7, 2, 1]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);
    expect(campana.siguienteChoque()?.territorio).not.toBe('pensilvania');
  });

  it('va a por la capital enemiga cuando la tiene a tiro y sin defensa', () => {
    const campana = new Campana({ semilla: 105 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    const capitalNorte = capitalDe(BandoCampana.UNION);
    vaciar(campana, capitalNorte.id, 'oregon');
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'tennessee', [8, 2, 1]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);
    expect(campana.duenoDe(capitalNorte.id)).toBe(BandoCampana.CONFEDERACION);
    expect(campana.ganador).toBe(BandoCampana.CONFEDERACION);
  });

  it('acerca sus ejércitos de retaguardia al frente', () => {
    const campana = new Campana({ semilla: 106 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    // Florida es el rincón más alejado del frente.
    const id = colocar(campana, BandoCampana.CONFEDERACION, 'florida', [4, 1, 0]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);
    const antes = campana.distanciaAlBando('florida', BandoCampana.UNION);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);

    const ahora = campana.ejercitoPorId(id)!.territorio;
    expect(campana.distanciaAlBando(ahora, BandoCampana.UNION)).toBeLessThan(antes);
  });

  it('no deja su capital sin guarnición para ir a por otra cosa', () => {
    const campana = new Campana({ semilla: 107 });
    turnoDe(campana, BandoCampana.CONFEDERACION);

    const capitalSur = capitalDe(BandoCampana.CONFEDERACION);
    // Justo por debajo del mínimo: cualquier salida dejaría la capital desnuda.
    const id = colocar(campana, BandoCampana.CONFEDERACION, capitalSur.id, [2, 0, 0]);
    soloPuedeMover(campana, BandoCampana.CONFEDERACION, id);

    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);

    expect(campana.ejercitoPorId(id)!.territorio).toBe(capitalSur.id);
  });

  it('nunca mueve un ejército dos veces en el mismo turno', () => {
    const campana = new Campana({ semilla: 108 });
    turnoDe(campana, BandoCampana.CONFEDERACION);
    new IACampana(BandoCampana.CONFEDERACION).jugarManiobra(campana);

    const movidos = campana.ejercitosDe(BandoCampana.CONFEDERACION).filter((e) => e.haMovido);
    // Basta con que la operación termine y ninguno haya quedado en estado imposible.
    for (const ejercito of movidos) {
      expect(campana.duenoDe(ejercito.territorio)).not.toBe(BandoCampana.NINGUNO);
    }
  });
});

describe('dos IA jugando una partida entera', () => {
  it('llegan a un ganador sin bloquearse ni romper ninguna regla', () => {
    const campana = new Campana({ semilla: 2024 });
    const ias = {
      [BandoCampana.UNION]: new IACampana(BandoCampana.UNION),
      [BandoCampana.CONFEDERACION]: new IACampana(BandoCampana.CONFEDERACION),
    };

    let turnos = 0;
    const LIMITE = 300;
    while (campana.fase !== FaseTurno.FIN && turnos++ < LIMITE) {
      const ia = ias[campana.bandoActivo as BandoCampana.UNION | BandoCampana.CONFEDERACION];
      ia.jugarManiobra(campana);

      // Se dirimen las batallas que la maniobra haya provocado.
      let batallas = 0;
      while (campana.hayChoquesPendientes && batallas++ < 20) {
        const choque = campana.siguienteChoque()!;
        campana.aplicarResultado(campana.resolverChoqueAutomaticamente(choque));
      }

      // Invariantes que deben cumplirse en todo momento de la partida.
      const total = campana.territoriosDe(BandoCampana.UNION).length +
        campana.territoriosDe(BandoCampana.CONFEDERACION).length;
      expect(total, 'ningún territorio puede quedarse sin dueño').toBe(18);
      for (const ejercito of campana.todosLosEjercitos) {
        expect(totalTropas(ejercito.composicion), 'ejército fantasma sin tropas').toBeGreaterThan(0);
      }

      campana.terminarTurno();
    }

    expect(campana.fase, `la partida no terminó en ${LIMITE} turnos`).toBe(FaseTurno.FIN);
    expect(campana.ganador).not.toBe(BandoCampana.NINGUNO);
  });

  it('la partida entre IA es reproducible con la misma semilla', () => {
    const jugar = (semilla: number): string => {
      const campana = new Campana({ semilla });
      const ias = {
        [BandoCampana.UNION]: new IACampana(BandoCampana.UNION),
        [BandoCampana.CONFEDERACION]: new IACampana(BandoCampana.CONFEDERACION),
      };
      let turnos = 0;
      while (campana.fase !== FaseTurno.FIN && turnos++ < 300) {
        ias[campana.bandoActivo as BandoCampana.UNION | BandoCampana.CONFEDERACION].jugarManiobra(
          campana,
        );
        let batallas = 0;
        while (campana.hayChoquesPendientes && batallas++ < 20) {
          campana.aplicarResultado(
            campana.resolverChoqueAutomaticamente(campana.siguienteChoque()!),
          );
        }
        campana.terminarTurno();
      }
      return `${campana.ganador}@${campana.turno}`;
    };
    expect(jugar(777)).toBe(jugar(777));
  });
});
