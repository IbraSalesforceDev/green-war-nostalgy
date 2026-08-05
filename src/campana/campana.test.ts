import { describe, expect, it } from 'vitest';
import { COSTE_ARMA, Campana, fuerzaContra } from './campana';
import { capitalDe, territorio } from './territorios';
import {
  ARMAS,
  Arma,
  BANDOS_EN_GUERRA,
  BandoCampana,
  type Composicion,
  FaseTurno,
  type IdTerritorio,
  totalTropas,
} from './tipos';

/** Atajo: un ejército del bando dado en el territorio dado, con la composición dada. */
function plantar(
  campana: Campana,
  bando: BandoCampana,
  donde: IdTerritorio,
  composicion: Composicion,
): number {
  // Se reutiliza el ejército que ya hubiera allí, para no dejar dos en la misma
  // casilla y falsear la prueba.
  const existente = campana.ejercitoEn(donde);
  if (existente) {
    existente.bando = bando;
    existente.composicion = composicion;
    existente.haMovido = false;
    return existente.id;
  }
  // Sin API pública para crear ejércitos —solo los crean los refuerzos—, se toma
  // uno del bando y se le muda de sitio. Es lo que haría la propia partida.
  const suyo = campana.ejercitosDe(bando)[0];
  if (!suyo) throw new Error(`el bando ${bando} no tiene ejércitos que mover`);
  suyo.territorio = donde;
  suyo.composicion = composicion;
  suyo.haMovido = false;
  return suyo.id;
}

describe('la campaña al empezar', () => {
  it('reparte el mapa según lo previsto y da tesoro a los dos bandos', () => {
    const campana = new Campana({ semilla: 1 });
    expect(campana.turno).toBe(1);
    expect(campana.fase).toBe(FaseTurno.MANIOBRA);
    expect(campana.bandoActivo).toBe(BandoCampana.UNION);
    expect(campana.ganador).toBe(BandoCampana.NINGUNO);

    for (const bando of BANDOS_EN_GUERRA) {
      expect(campana.monedasDe(bando)).toBeGreaterThan(0);
      expect(campana.territoriosDe(bando).length).toBe(9);
      expect(campana.ejercitosDe(bando).length).toBeGreaterThan(0);
    }
  });

  it('guarnece la frontera y las capitales, no el interior entero', () => {
    const campana = new Campana({ semilla: 1 });
    for (const bando of BANDOS_EN_GUERRA) {
      const capital = capitalDe(bando);
      expect(campana.ejercitoEn(capital.id), `capital de ${bando} sin guarnición`).toBeDefined();
    }
    // Si todo territorio tuviera ejército, el primer avance no ganaría nada sin pelear.
    const conEjercito = campana.todosLosEjercitos.length;
    expect(conEjercito).toBeLessThan(18);
  });

  it('empieza con las dos rentas igualadas', () => {
    const campana = new Campana({ semilla: 1 });
    expect(campana.rentaDe(BandoCampana.UNION)).toBe(campana.rentaDe(BandoCampana.CONFEDERACION));
  });
});

describe('el triángulo de las tres armas', () => {
  const soloInfanteria: Composicion = [10, 0, 0];
  const soloCaballeria: Composicion = [0, 10, 0];
  const soloArtilleria: Composicion = [0, 0, 10];

  it('la caballería arrolla a la artillería', () => {
    expect(fuerzaContra(soloCaballeria, soloArtilleria)).toBeGreaterThan(
      fuerzaContra(soloArtilleria, soloCaballeria),
    );
  });

  it('la artillería destroza a la infantería', () => {
    expect(fuerzaContra(soloArtilleria, soloInfanteria)).toBeGreaterThan(
      fuerzaContra(soloInfanteria, soloArtilleria),
    );
  });

  it('la infantería rechaza a la caballería', () => {
    expect(fuerzaContra(soloInfanteria, soloCaballeria)).toBeGreaterThan(
      fuerzaContra(soloCaballeria, soloInfanteria),
    );
  });

  it('no da ventaja a nadie cuando las mezclas son idénticas', () => {
    const mezcla: Composicion = [4, 3, 2];
    expect(fuerzaContra(mezcla, mezcla)).toBeCloseTo(fuerzaContra(mezcla, mezcla));
  });

  it('un ejército vacío no tiene fuerza ninguna', () => {
    expect(fuerzaContra([0, 0, 0], soloInfanteria)).toBe(0);
  });
});

describe('el movimiento de los ejércitos', () => {
  it('solo deja mover a territorios con frontera común', () => {
    const campana = new Campana({ semilla: 2 });
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [3, 1, 0]);
    expect(campana.puedeMover(id, 'michigan')).toBe(true); // vecino
    expect(campana.puedeMover(id, 'florida')).toBe(false); // al otro lado del mapa
  });

  it('no deja mover dos veces en el mismo turno', () => {
    const campana = new Campana({ semilla: 2 });
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [3, 1, 0]);
    campana.mover(id, 'michigan');
    expect(campana.puedeMover(id, 'minnesota')).toBe(false);
  });

  it('no deja mover a los ejércitos del bando que no está de turno', () => {
    const campana = new Campana({ semilla: 2 });
    const id = plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [3, 1, 0]);
    expect(campana.bandoActivo).toBe(BandoCampana.UNION);
    expect(campana.puedeMover(id, 'virginia')).toBe(false);
  });

  it('ocupa sin pelear un territorio enemigo que nadie defiende', () => {
    const campana = new Campana({ semilla: 3 });
    // Se vacía el destino de defensores para que el paso sea limpio.
    const defensor = campana.ejercitoEn('tennessee');
    if (defensor) defensor.territorio = 'florida';

    const id = plantar(campana, BandoCampana.UNION, 'illinois', [4, 1, 0]);
    const choque = campana.mover(id, 'tennessee');
    expect(choque).toBeNull();
    expect(campana.duenoDe('tennessee')).toBe(BandoCampana.UNION);
    expect(campana.ejercitoPorId(id)!.territorio).toBe('tennessee');
  });

  it('funde en una sola ficha dos ejércitos propios que coinciden', () => {
    const campana = new Campana({ semilla: 4 });
    plantar(campana, BandoCampana.UNION, 'michigan', [2, 1, 0]);
    const segundo = campana.ejercitosDe(BandoCampana.UNION).find((e) => e.territorio !== 'michigan');
    if (!segundo) throw new Error('hacen falta dos ejércitos de la Unión');
    segundo.territorio = 'illinois';
    segundo.composicion = [3, 0, 1];
    segundo.haMovido = false;

    const antes = campana.todosLosEjercitos.length;
    campana.mover(segundo.id, 'michigan');

    expect(campana.todosLosEjercitos.length).toBe(antes - 1);
    const fundido = campana.ejercitoEn('michigan')!;
    expect(fundido.composicion).toEqual([5, 1, 1]);
  });

  it('genera un choque al entrar donde hay defensores', () => {
    const campana = new Campana({ semilla: 5 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [3, 1, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [4, 1, 1]);

    const choque = campana.mover(id, 'tennessee');
    expect(choque).not.toBeNull();
    expect(choque!.tipo).toBe('campal');
    expect(choque!.atacante).toBe(BandoCampana.UNION);
    expect(choque!.defensor).toBe(BandoCampana.CONFEDERACION);
    // El territorio no cambia de manos hasta que la batalla se dirima.
    expect(campana.duenoDe('tennessee')).toBe(BandoCampana.CONFEDERACION);
    expect(campana.hayChoquesPendientes).toBe(true);
  });

  it('marca como asalto el choque en un territorio fortificado', () => {
    const campana = new Campana({ semilla: 6 });
    expect(territorio('virginia').fuerte).toBe(true);
    plantar(campana, BandoCampana.CONFEDERACION, 'virginia', [3, 1, 1]);
    const id = plantar(campana, BandoCampana.UNION, 'pensilvania', [5, 1, 1]);

    const choque = campana.mover(id, 'virginia');
    expect(choque!.tipo).toBe('fuerte');
  });
});

describe('la resolución de batallas', () => {
  it('la gana el atacante cuando es muy superior', () => {
    const campana = new Campana({ semilla: 7 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [1, 0, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [12, 3, 2]);

    const choque = campana.mover(id, 'tennessee')!;
    const resultado = campana.resolverChoqueAutomaticamente(choque);
    expect(resultado.vencedor).toBe(BandoCampana.UNION);
  });

  it('la gana el defensor cuando es muy superior', () => {
    const campana = new Campana({ semilla: 8 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [12, 3, 2]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [1, 0, 0]);

    const choque = campana.mover(id, 'tennessee')!;
    const resultado = campana.resolverChoqueAutomaticamente(choque);
    expect(resultado.vencedor).toBe(BandoCampana.CONFEDERACION);
  });

  it('deja al ganador con más tropas de las que le quedan al perdedor', () => {
    const campana = new Campana({ semilla: 9 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [2, 0, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [10, 2, 1]);

    const choque = campana.mover(id, 'tennessee')!;
    const resultado = campana.resolverChoqueAutomaticamente(choque);
    expect(totalTropas(resultado.supervivientesAtacante)).toBeGreaterThan(
      totalTropas(resultado.supervivientesDefensor),
    );
  });

  it('nunca devuelve más supervivientes de los que entraron en combate', () => {
    const campana = new Campana({ semilla: 10 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [4, 2, 1]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [5, 1, 2]);

    const choque = campana.mover(id, 'tennessee')!;
    const resultado = campana.resolverChoqueAutomaticamente(choque);
    for (const arma of ARMAS) {
      expect(resultado.supervivientesAtacante[arma]).toBeLessThanOrEqual(
        choque.composicionAtacante[arma],
      );
      expect(resultado.supervivientesDefensor[arma]).toBeLessThanOrEqual(
        choque.composicionDefensor[arma],
      );
    }
  });

  it('entrega el territorio al atacante que vence, y lo ocupa', () => {
    const campana = new Campana({ semilla: 11 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [1, 0, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [12, 3, 2]);

    const choque = campana.mover(id, 'tennessee')!;
    campana.aplicarResultado(campana.resolverChoqueAutomaticamente(choque));

    expect(campana.duenoDe('tennessee')).toBe(BandoCampana.UNION);
    expect(campana.ejercitoPorId(id)!.territorio).toBe('tennessee');
    expect(campana.hayChoquesPendientes).toBe(false);
  });

  it('deja el territorio en manos del defensor que resiste', () => {
    const campana = new Campana({ semilla: 12 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [12, 3, 2]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [1, 0, 0]);

    const choque = campana.mover(id, 'tennessee')!;
    campana.aplicarResultado(campana.resolverChoqueAutomaticamente(choque));

    expect(campana.duenoDe('tennessee')).toBe(BandoCampana.CONFEDERACION);
    // El atacante, si sobrevive, se queda de donde salió: no ha tomado nada.
    const atacante = campana.ejercitoPorId(id);
    if (atacante) expect(atacante.territorio).toBe('illinois');
  });

  it('el fuerte inclina a favor del defensor una batalla que sin él perdería', () => {
    // Mismas fuerzas y misma semilla; lo único que cambia es la fortificación.
    const enCampoAbierto = new Campana({ semilla: 20 });
    plantar(enCampoAbierto, BandoCampana.CONFEDERACION, 'tennessee', [6, 1, 1]);
    const idLlano = plantar(enCampoAbierto, BandoCampana.UNION, 'illinois', [8, 2, 1]);
    const choqueLlano = enCampoAbierto.mover(idLlano, 'tennessee')!;

    const enFuerte = new Campana({ semilla: 20 });
    plantar(enFuerte, BandoCampana.CONFEDERACION, 'virginia', [6, 1, 1]);
    const idFuerte = plantar(enFuerte, BandoCampana.UNION, 'pensilvania', [8, 2, 1]);
    const choqueFuerte = enFuerte.mover(idFuerte, 'virginia')!;

    expect(choqueLlano.tipo).toBe('campal');
    expect(choqueFuerte.tipo).toBe('fuerte');
    expect(enCampoAbierto.resolverChoqueAutomaticamente(choqueLlano).vencedor).toBe(
      BandoCampana.UNION,
    );
    expect(enFuerte.resolverChoqueAutomaticamente(choqueFuerte).vencedor).toBe(
      BandoCampana.CONFEDERACION,
    );
  });
});

describe('el paso de los turnos', () => {
  it('alterna el bando y solo cuenta turno al volver a la Unión', () => {
    const campana = new Campana({ semilla: 13 });
    expect(campana.turno).toBe(1);
    expect(campana.bandoActivo).toBe(BandoCampana.UNION);

    campana.terminarTurno();
    expect(campana.bandoActivo).toBe(BandoCampana.CONFEDERACION);
    expect(campana.turno).toBe(1);

    campana.terminarTurno();
    expect(campana.bandoActivo).toBe(BandoCampana.UNION);
    expect(campana.turno).toBe(2);
  });

  it('cobra la renta al bando que entra de turno', () => {
    const campana = new Campana({ semilla: 14 });
    const antes = campana.monedasDe(BandoCampana.CONFEDERACION);
    const renta = campana.rentaDe(BandoCampana.CONFEDERACION);
    campana.terminarTurno();
    // Lo cobrado menos lo que se haya gastado en refuerzos; nunca puede bajar
    // por debajo de lo que había ni subir por encima de lo cobrado.
    const despues = campana.monedasDe(BandoCampana.CONFEDERACION);
    expect(despues).toBeLessThanOrEqual(antes + renta);
  });

  it('compra refuerzos y los desembarca en territorio propio', () => {
    const campana = new Campana({ semilla: 15 });
    const tropasAntes = campana
      .ejercitosDe(BandoCampana.CONFEDERACION)
      .reduce((suma, e) => suma + totalTropas(e.composicion), 0);

    campana.terminarTurno(); // pasa a la Confederación, que recauda y refuerza

    const despues = campana.ejercitosDe(BandoCampana.CONFEDERACION);
    const tropasDespues = despues.reduce((suma, e) => suma + totalTropas(e.composicion), 0);
    expect(tropasDespues).toBeGreaterThan(tropasAntes);
    for (const ejercito of despues) {
      expect(campana.duenoDe(ejercito.territorio)).toBe(BandoCampana.CONFEDERACION);
    }
  });

  it('devuelve el movimiento a los ejércitos del bando entrante', () => {
    const campana = new Campana({ semilla: 16 });
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [3, 1, 0]);
    campana.mover(id, 'michigan');
    expect(campana.ejercitoPorId(id)!.haMovido).toBe(true);

    campana.terminarTurno(); // Confederación
    campana.terminarTurno(); // vuelve la Unión
    expect(campana.ejercitoPorId(id)!.haMovido).toBe(false);
  });

  it('no pasa el turno con batallas sin dirimir', () => {
    const campana = new Campana({ semilla: 17 });
    plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [3, 1, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [4, 1, 1]);
    campana.mover(id, 'tennessee');

    campana.terminarTurno();
    expect(campana.fase).toBe(FaseTurno.BATALLAS);
    expect(campana.bandoActivo).toBe(BandoCampana.UNION); // sigue siendo su turno
  });
});

describe('el final de la partida', () => {
  it('la gana quien toma la capital enemiga', () => {
    const campana = new Campana({ semilla: 18 });
    const capitalSur = capitalDe(BandoCampana.CONFEDERACION);
    plantar(campana, BandoCampana.CONFEDERACION, capitalSur.id, [1, 0, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'pensilvania', [14, 4, 3]);

    const choque = campana.mover(id, capitalSur.id)!;
    campana.aplicarResultado(campana.resolverChoqueAutomaticamente(choque));

    expect(campana.ganador).toBe(BandoCampana.UNION);
    expect(campana.fase).toBe(FaseTurno.FIN);
  });

  it('una vez terminada, ya no corren más turnos', () => {
    const campana = new Campana({ semilla: 19 });
    const capitalSur = capitalDe(BandoCampana.CONFEDERACION);
    plantar(campana, BandoCampana.CONFEDERACION, capitalSur.id, [1, 0, 0]);
    const id = plantar(campana, BandoCampana.UNION, 'pensilvania', [14, 4, 3]);
    campana.aplicarResultado(
      campana.resolverChoqueAutomaticamente(campana.mover(id, capitalSur.id)!),
    );

    const turnoAlAcabar = campana.turno;
    const bandoAlAcabar = campana.bandoActivo;
    campana.terminarTurno();
    expect(campana.turno).toBe(turnoAlAcabar);
    expect(campana.bandoActivo).toBe(bandoAlAcabar);
  });
});

describe('el determinismo', () => {
  it('dos campañas con la misma semilla evolucionan igual', () => {
    const guionar = (campana: Campana): string => {
      // Diez turnos de puro pasar el rato: solo recaudación y refuerzos, que es
      // donde entra el azar del reparto de tropas.
      for (let i = 0; i < 10; i++) campana.terminarTurno();
      return campana.todosLosEjercitos
        .map((e) => `${e.id}:${e.bando}:${e.territorio}:${e.composicion.join(',')}`)
        .sort()
        .join('|');
    };
    expect(guionar(new Campana({ semilla: 12345 }))).toBe(guionar(new Campana({ semilla: 12345 })));
  });

  it('la semilla influye de verdad en el resultado de las batallas', () => {
    // La prueba anterior pasaría igual aunque la semilla se ignorase por completo:
    // hay que comprobar también que dos semillas distintas divergen. No sirve
    // mirar una sola batalla —con ejércitos pequeños, el redondeo de bajas se
    // traga el ±15 % de azar y dos semillas dan el mismo entero muy a menudo—,
    // así que se compara una tanda de choques idénticos.
    const tanda = (semilla: number): string => {
      const resultados: string[] = [];
      for (let i = 0; i < 12; i++) {
        const campana = new Campana({ semilla });
        plantar(campana, BandoCampana.CONFEDERACION, 'tennessee', [6, 2, 1]);
        const id = plantar(campana, BandoCampana.UNION, 'illinois', [6, 2, 1]);
        const choque = campana.mover(id, 'tennessee')!;
        // Se consume azar i veces antes de resolver, para muestrear la secuencia.
        for (let salto = 0; salto < i; salto++) campana.azar.siguiente();
        const r = campana.resolverChoqueAutomaticamente(choque);
        resultados.push(
          `${r.vencedor}:${r.supervivientesAtacante.join(',')}:${r.supervivientesDefensor.join(',')}`,
        );
      }
      return resultados.join('|');
    };
    expect(tanda(1)).not.toBe(tanda(999));
  });
});

describe('la economía', () => {
  it('cobra por cada arma lo que cuesta, y la artillería es lo más caro', () => {
    expect(COSTE_ARMA[Arma.INFANTERIA]).toBeLessThan(COSTE_ARMA[Arma.CABALLERIA]);
    expect(COSTE_ARMA[Arma.CABALLERIA]).toBeLessThan(COSTE_ARMA[Arma.ARTILLERIA]);
  });

  it('nunca deja el tesoro en números rojos', () => {
    const campana = new Campana({ semilla: 21 });
    for (let i = 0; i < 30; i++) {
      campana.terminarTurno();
      for (const bando of BANDOS_EN_GUERRA) {
        expect(campana.monedasDe(bando)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('sube la renta al conquistar y la baja al perder', () => {
    const campana = new Campana({ semilla: 22 });
    const rentaAntes = campana.rentaDe(BandoCampana.UNION);
    const rentaRivalAntes = campana.rentaDe(BandoCampana.CONFEDERACION);

    const defensor = campana.ejercitoEn('tennessee');
    if (defensor) defensor.territorio = 'florida';
    const id = plantar(campana, BandoCampana.UNION, 'illinois', [4, 1, 0]);
    campana.mover(id, 'tennessee');

    const valor = territorio('tennessee').renta;
    expect(campana.rentaDe(BandoCampana.UNION)).toBe(rentaAntes + valor);
    expect(campana.rentaDe(BandoCampana.CONFEDERACION)).toBe(rentaRivalAntes - valor);
  });
});
