import { bus } from '../core/events';
import { sesion } from '../estado/sesion';
import type { Mundo } from '../sim/mundo';
import { Bando, EstadoBando } from '../sim/tipos';
import { elementoIcono } from './iconos';

/**
 * Menús: pausa, opciones y fin de partida.
 *
 * Los tres viven en la misma capa modal a pantalla completa (`.gwn-menu-capa`),
 * uno a la vez, porque solo uno tiene sentido abierto de golpe. La pausa y las
 * opciones las abre y las cierra quien cablee esta interfaz (o, por comodidad,
 * la propia tecla Escape); el de fin de partida se muestra solo, suscrito
 * directamente a `bus.al('finPartida', ...)` — el módulo se guarda el `Mundo` más
 * reciente que le llega por `actualizar()` para poder montar la tabla de
 * `EstadoBando` en el momento en que el bus avisa de que la partida ha terminado.
 */
export interface OpcionesJuego {
  /** [0, 1]. */
  volumen: number;
  calidadGrafica: 'auto' | 'bajo' | 'medio' | 'alto';
  /** Multiplicador sobre `VELOCIDAD_CAMARA`. */
  velocidadCamara: number;
  mostrarFps: boolean;
}

const OPCIONES_POR_DEFECTO: OpcionesJuego = {
  volumen: 0.8,
  calidadGrafica: 'auto',
  velocidadCamara: 1,
  mostrarFps: false,
};

const CLAVE_ALMACEN = 'gwn-hud-opciones';

function cargarOpciones(): OpcionesJuego {
  try {
    const crudo = localStorage.getItem(CLAVE_ALMACEN);
    if (!crudo) return { ...OPCIONES_POR_DEFECTO };
    return { ...OPCIONES_POR_DEFECTO, ...(JSON.parse(crudo) as Partial<OpcionesJuego>) };
  } catch {
    return { ...OPCIONES_POR_DEFECTO };
  }
}

export interface Menus {
  readonly raiz: HTMLElement;
  /**
   * Alimenta el contador de fps opcional y guarda `mundo` para poder construir la
   * tabla de estadísticas si `finPartida` se dispara antes de la próxima llamada.
   */
  actualizar(mundo: Mundo, dt: number): void;
  abrirPausa(): void;
  cerrarPausa(): void;
  alternarPausa(): void;
  estaAbierta(): boolean;
  mostrarFinDePartida(
    mundo: Mundo,
    bandoJugador: Bando,
    ganador: Bando,
    motivo: 'aniquilacion' | 'rendicion' | 'tiempo',
  ): void;
  opcionesActuales(): OpcionesJuego;
  /** Se dispara al entrar en pausa (por botón, por Escape). Aquí es donde se para el bucle. */
  alPausar(cb: () => void): void;
  /** Se dispara al salir de pausa, sea por "Reanudar" o por Escape. */
  alReanudar(cb: () => void): void;
  alReiniciar(cb: () => void): void;
  alRendirse(cb: () => void): void;
  alCambiarOpciones(cb: (opciones: OpcionesJuego) => void): void;
  liberar(): void;
}

const ETIQUETA_MOTIVO: Record<'aniquilacion' | 'rendicion' | 'tiempo', string> = {
  aniquilacion: 'por aniquilación del enemigo',
  rendicion: 'por rendición',
  tiempo: 'por límite de tiempo',
};

const ETIQUETA_STAT: Array<[keyof EstadoBando, string]> = [
  ['unidadesEntrenadas', 'Unidades entrenadas'],
  ['unidadesPerdidas', 'Unidades perdidas'],
  ['bajasCausadas', 'Bajas causadas'],
  ['edificiosConstruidos', 'Edificios construidos'],
  ['oroRecogido', 'Oro recogido'],
  ['maderaRecogida', 'Madera recogida'],
];

export function crearMenus(): Menus {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-hud-menus';

  const capa = document.createElement('div');
  capa.className = 'gwn-menu-capa gwn-oculto';
  raiz.appendChild(capa);

  const fps = document.createElement('div');
  fps.className = 'gwn-fps gwn-oculto';
  fps.textContent = '-- fps';
  raiz.appendChild(fps);

  // Escape no existe en un móvil: sin este botón la pausa sería inalcanzable
  // desde una pantalla táctil.
  const botonPausa = document.createElement('button');
  botonPausa.type = 'button';
  botonPausa.className = 'gwn-boton-pausa';
  botonPausa.setAttribute('aria-label', 'Pausa');
  botonPausa.appendChild(elementoIcono('pausa'));
  botonPausa.addEventListener('click', () => alternarPausaInterna());
  raiz.appendChild(botonPausa);

  let opciones = cargarOpciones();
  let vistaActual: 'pausa' | 'opciones' | 'finPartida' | null = null;

  let cbPausar: () => void = () => {};
  let cbReanudar: () => void = () => {};
  // Sin nadie más que lo cablee, recargar la página es un "reiniciar" honesto:
  // no depende de que exista una función de reinicio de partida en `main.ts`.
  let cbReiniciar: () => void = () => location.reload();
  let cbRendirse: () => void = () => {};
  let cbOpciones: (o: OpcionesJuego) => void = () => {};

  /** Abre la pantalla de pausa desde cero, avisando de que el bucle debe pararse. */
  function abrirPausaInterna(): void {
    vistaActual = 'pausa';
    capa.classList.remove('gwn-oculto');
    render();
    cbPausar();
  }

  /** Cierra cualquier menú abierto (salvo el de fin de partida) y avisa de reanudar. */
  function cerrarYReanudar(): void {
    cerrarTodo();
    cbReanudar();
  }

  /** Única lógica de alternado: la usan tanto el botón táctil como el método público. */
  function alternarPausaInterna(): void {
    if (vistaActual === 'finPartida') return;
    if (vistaActual) cerrarYReanudar();
    else abrirPausaInterna();
  }

  function guardarOpciones(): void {
    try {
      localStorage.setItem(CLAVE_ALMACEN, JSON.stringify(opciones));
    } catch {
      // El almacenamiento puede estar deshabilitado (modo privado); no es fatal.
    }
    cbOpciones({ ...opciones });
    fps.classList.toggle('gwn-oculto', !opciones.mostrarFps);
  }

  function botonMenu(texto: string, icono: Parameters<typeof elementoIcono>[0], claseExtra = ''): HTMLButtonElement {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = `gwn-menu-boton ${claseExtra}`.trim();
    boton.appendChild(elementoIcono(icono));
    const span = document.createElement('span');
    span.textContent = texto;
    boton.appendChild(span);
    return boton;
  }

  function cerrarTodo(): void {
    capa.classList.add('gwn-oculto');
    vistaActual = null;
    // El botón que se acaba de pulsar (Reanudar, Volver...) se queda con el foco.
    // Si no se suelta, `entrada.ts` sigue viendo el teclado como "dentro de la
    // interfaz" y las teclas de jugabilidad —incluida la propia Escape— dejan de
    // llegar a `ControlTeclado` hasta que el jugador haga clic en el lienzo.
    (document.activeElement as HTMLElement | null)?.blur();
  }

  function render(): void {
    capa.innerHTML = '';
    if (!vistaActual) return;

    const tarjeta = document.createElement('div');
    tarjeta.className = 'gwn-panel gwn-menu-tarjeta';

    if (vistaActual === 'pausa') {
      tarjeta.appendChild(titulo('pausa', 'Partida en pausa'));
      const reanudar = botonMenu('Reanudar', 'brujula');
      reanudar.addEventListener('click', cerrarYReanudar);
      const opcionesBtn = botonMenu('Opciones', 'engranaje', 'gwn-menu-boton--secundario');
      opcionesBtn.addEventListener('click', () => {
        vistaActual = 'opciones';
        render();
      });
      const reiniciar = botonMenu('Reiniciar partida', 'bandera', 'gwn-menu-boton--secundario');
      reiniciar.addEventListener('click', () => {
        cerrarTodo();
        cbReiniciar();
      });
      const rendirse = botonMenu('Rendirse', 'calavera', 'gwn-menu-boton--peligro');
      rendirse.addEventListener('click', () => {
        cerrarTodo();
        cbRendirse();
      });
      tarjeta.append(reanudar, opcionesBtn, reiniciar, rendirse);
    } else if (vistaActual === 'opciones') {
      tarjeta.appendChild(titulo('engranaje', 'Opciones'));
      tarjeta.appendChild(filaRango('Volumen', 'sonido', opciones.volumen, 0, 1, 0.05, (v) => {
        opciones = { ...opciones, volumen: v };
        guardarOpciones();
      }));
      tarjeta.appendChild(
        filaSelector(
          'Calidad gráfica',
          'rayo',
          opciones.calidadGrafica,
          [
            ['auto', 'Automática'],
            ['bajo', 'Baja'],
            ['medio', 'Media'],
            ['alto', 'Alta'],
          ],
          (v) => {
            opciones = { ...opciones, calidadGrafica: v as OpcionesJuego['calidadGrafica'] };
            guardarOpciones();
          },
        ),
      );
      tarjeta.appendChild(
        filaRango('Velocidad de cámara', 'mover', opciones.velocidadCamara, 0.5, 2, 0.1, (v) => {
          opciones = { ...opciones, velocidadCamara: v };
          guardarOpciones();
        }),
      );
      tarjeta.appendChild(
        filaToggle('Mostrar fps', 'ojo', opciones.mostrarFps, (v) => {
          opciones = { ...opciones, mostrarFps: v };
          guardarOpciones();
        }),
      );
      const volver = botonMenu('Volver', 'volver', 'gwn-menu-boton--secundario');
      volver.addEventListener('click', () => {
        vistaActual = 'pausa';
        render();
      });
      tarjeta.appendChild(volver);
    } else if (vistaActual === 'finPartida' && ultimoResultado) {
      const { mundo, bandoJugador, ganador, motivo } = ultimoResultado;
      const gano = ganador === bandoJugador;
      tarjeta.appendChild(titulo(gano ? 'laurel' : 'calavera', gano ? 'Victoria' : 'Derrota'));
      const resultado = document.createElement('div');
      resultado.className = `gwn-menu-resultado gwn-menu-resultado--${gano ? 'victoria' : 'derrota'}`;
      resultado.textContent = `${gano ? 'Has ganado' : 'Has perdido'} ${ETIQUETA_MOTIVO[motivo]}`;
      tarjeta.appendChild(resultado);
      tarjeta.appendChild(tablaResultados(mundo, bandoJugador));
      const reiniciar = botonMenu('Jugar de nuevo', 'bandera');
      reiniciar.addEventListener('click', () => {
        cerrarTodo();
        cbReiniciar();
      });
      tarjeta.appendChild(reiniciar);
    }

    capa.appendChild(tarjeta);
  }

  function titulo(icono: Parameters<typeof elementoIcono>[0], texto: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'gwn-menu-titulo';
    el.appendChild(elementoIcono(icono));
    const span = document.createElement('span');
    span.textContent = texto;
    el.appendChild(span);
    return el;
  }

  function filaRango(
    etiqueta: string,
    icono: Parameters<typeof elementoIcono>[0],
    valor: number,
    min: number,
    max: number,
    paso: number,
    cb: (v: number) => void,
  ): HTMLElement {
    const fila = document.createElement('label');
    fila.className = 'gwn-menu-fila';
    const nombre = document.createElement('span');
    nombre.appendChild(elementoIcono(icono));
    nombre.append(` ${etiqueta}`);
    fila.appendChild(nombre);
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(paso);
    input.value = String(valor);
    input.addEventListener('input', () => cb(Number(input.value)));
    fila.appendChild(input);
    return fila;
  }

  function filaSelector(
    etiqueta: string,
    icono: Parameters<typeof elementoIcono>[0],
    valor: string,
    opcionesLista: Array<[string, string]>,
    cb: (v: string) => void,
  ): HTMLElement {
    const fila = document.createElement('label');
    fila.className = 'gwn-menu-fila';
    const nombre = document.createElement('span');
    nombre.appendChild(elementoIcono(icono));
    nombre.append(` ${etiqueta}`);
    fila.appendChild(nombre);
    const select = document.createElement('select');
    for (const [v, texto] of opcionesLista) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = texto;
      if (v === valor) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => cb(select.value));
    fila.appendChild(select);
    return fila;
  }

  function filaToggle(
    etiqueta: string,
    icono: Parameters<typeof elementoIcono>[0],
    valor: boolean,
    cb: (v: boolean) => void,
  ): HTMLElement {
    const fila = document.createElement('div');
    fila.className = 'gwn-menu-fila';
    const nombre = document.createElement('span');
    nombre.appendChild(elementoIcono(icono));
    nombre.append(` ${etiqueta}`);
    fila.appendChild(nombre);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `gwn-menu-toggle ${valor ? 'gwn-activo' : ''}`.trim();
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(valor));
    toggle.addEventListener('click', () => {
      const nuevo = !toggle.classList.contains('gwn-activo');
      toggle.classList.toggle('gwn-activo', nuevo);
      toggle.setAttribute('aria-checked', String(nuevo));
      cb(nuevo);
    });
    fila.appendChild(toggle);
    return fila;
  }

  function tablaResultados(mundo: Mundo, bandoJugador: Bando): HTMLElement {
    const tabla = document.createElement('table');
    tabla.className = 'gwn-menu-stats';
    const rival = bandoJugador === Bando.HUMANOS ? Bando.ORCOS : Bando.HUMANOS;

    const cabecera = document.createElement('thead');
    cabecera.innerHTML = '<tr><th>Estadística</th><th>Tú</th><th>Rival</th></tr>';
    tabla.appendChild(cabecera);

    const cuerpo = document.createElement('tbody');
    const propio = mundo.estadoDe(bandoJugador);
    const ajeno = mundo.estadoDe(rival);
    for (const [campo, etiqueta] of ETIQUETA_STAT) {
      const fila = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = etiqueta;
      const b = document.createElement('td');
      b.textContent = String(propio[campo]);
      const c = document.createElement('td');
      c.textContent = String(ajeno[campo]);
      fila.append(a, b, c);
      cuerpo.appendChild(fila);
    }
    tabla.appendChild(cuerpo);
    return tabla;
  }

  interface Resultado {
    mundo: Mundo;
    bandoJugador: Bando;
    ganador: Bando;
    motivo: 'aniquilacion' | 'rendicion' | 'tiempo';
  }
  let ultimoResultado: Resultado | null = null;

  // Escape no se escucha aquí. `ControlTeclado` es el único que reacciona a esa
  // tecla: cancela un paso de la jugabilidad a la vez (modo de objetivo,
  // colocación, selección) y, cuando ya no le queda nada que cancelar, llama a
  // `alternarPausa()` (más abajo) —que abre o cierra según toque. Dos listeners
  // independientes sobre el mismo evento fue, de hecho, un bug real: el que
  // acababa de abrir la pausa y el que la volvía a cerrar corrían en el mismo
  // tick, según el orden de registro, no según la intención.

  let acumuladorFps = 0;
  let fotogramasFps = 0;
  let ultimoTextoFps = '';
  let ultimoMundo: Mundo | null = null;

  // El fin de partida se muestra solo: en cuanto el bus avisa, se monta con el
  // `Mundo` más reciente que `actualizar()` haya visto pasar.
  const bajaFinPartida = bus.al('finPartida', ({ ganador, motivo }) => {
    if (!ultimoMundo) return;
    mostrarFinDePartidaInterna(ultimoMundo, sesion.bandoJugador, ganador, motivo);
  });

  function mostrarFinDePartidaInterna(
    mundo: Mundo,
    bandoJugador: Bando,
    ganador: Bando,
    motivo: 'aniquilacion' | 'rendicion' | 'tiempo',
  ): void {
    ultimoResultado = { mundo, bandoJugador, ganador, motivo };
    vistaActual = 'finPartida';
    capa.classList.remove('gwn-oculto');
    render();
  }

  return {
    raiz,

    actualizar(mundo: Mundo, dt: number): void {
      ultimoMundo = mundo;
      if (!opciones.mostrarFps) return;
      fotogramasFps++;
      acumuladorFps += dt;
      if (acumuladorFps < 0.5) return;
      const texto = `${Math.round(fotogramasFps / acumuladorFps)} fps`;
      acumuladorFps = 0;
      fotogramasFps = 0;
      if (texto !== ultimoTextoFps) {
        ultimoTextoFps = texto;
        fps.textContent = texto;
      }
    },

    abrirPausa(): void {
      if (vistaActual === 'finPartida' || vistaActual) return;
      abrirPausaInterna();
    },

    cerrarPausa(): void {
      if (vistaActual === 'finPartida' || !vistaActual) return;
      cerrarYReanudar();
    },

    alternarPausa(): void {
      alternarPausaInterna();
    },

    estaAbierta(): boolean {
      return vistaActual !== null;
    },

    mostrarFinDePartida(
      mundo: Mundo,
      bandoJugador: Bando,
      ganador: Bando,
      motivo: 'aniquilacion' | 'rendicion' | 'tiempo',
    ): void {
      mostrarFinDePartidaInterna(mundo, bandoJugador, ganador, motivo);
    },

    opcionesActuales(): OpcionesJuego {
      return { ...opciones };
    },

    alPausar(cb: () => void): void {
      cbPausar = cb;
    },

    alReanudar(cb: () => void): void {
      cbReanudar = cb;
    },

    alReiniciar(cb: () => void): void {
      cbReiniciar = cb;
    },

    alRendirse(cb: () => void): void {
      cbRendirse = cb;
    },

    alCambiarOpciones(cb: (opciones: OpcionesJuego) => void): void {
      cbOpciones = cb;
    },

    liberar(): void {
      bajaFinPartida();
      raiz.remove();
    },
  };
}
