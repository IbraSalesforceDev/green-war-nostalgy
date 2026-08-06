import { elementoIcono } from '../ui/iconos';
import type { Campana } from './campana';
import { territorio } from './territorios';
import {
  ARMAS,
  Arma,
  BandoCampana,
  type Ejercito,
  NOMBRE_ARMA,
  NOMBRE_BANDO,
  type IdTerritorio,
  totalTropas,
} from './tipos';

/**
 * La interfaz del mapa de campaña.
 *
 * Reutiliza el lenguaje visual que ya tenía el juego —los paneles de pergamino con
 * marco remachado, los iconos, la tipografía— porque cambiar de género no es razón
 * para cambiar de estilo: la escena de batalla y esta pantalla tienen que parecer
 * el mismo juego.
 *
 * ── Qué enseña y por qué ─────────────────────────────────────────────────────
 * Arriba, lo que se consulta de un vistazo cada turno: de quién es el turno, qué
 * hay en la bolsa, cuánto entrará el turno que viene y cuánto mapa se domina.
 * Abajo, solo cuando hace falta: la composición del ejército elegido, que es la
 * información con la que se decide si atacar o esperar.
 */

const ICONO_ARMA: Readonly<Record<Arma, Parameters<typeof elementoIcono>[0]>> = {
  [Arma.INFANTERIA]: 'casco',
  [Arma.CABALLERIA]: 'jinete',
  [Arma.ARTILLERIA]: 'catapulta',
};

export interface UiCampana {
  readonly raiz: HTMLElement;
  /** Refresca todos los indicadores con el estado actual. */
  actualizar(campana: Campana, seleccionado: Ejercito | null): void;
  /** Escribe un renglón en el diario de la partida. */
  anotar(texto: string, tono?: 'info' | 'bueno' | 'malo'): void;
  alTerminarTurno(cb: () => void): void;
  /** Enseña el cartel de fin de partida. */
  mostrarFinal(ganador: BandoCampana, esElJugador: boolean, turnos: number): void;
  /** Bloquea los controles mientras juega la máquina. */
  fijarEsperando(esperando: boolean): void;
  /**
   * Enseña u oculta la interfaz del mapa entera. Durante una batalla no puede
   * quedarse encima: el botón de pasar turno sobre un campo de batalla invita a
   * pulsarlo, y ni siquiera es de esa escena.
   */
  fijarVisible(visible: boolean): void;
  liberar(): void;
}

export function crearUiCampana(contenedor: HTMLElement, bandoJugador: BandoCampana): UiCampana {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-hud gwn-campana';
  contenedor.appendChild(raiz);

  // --- Barra superior ---
  const barra = document.createElement('div');
  barra.className = 'gwn-panel gwn-recursos gwn-campana-barra';

  const marcaTurno = crearIndicador('bandera');
  const marcaMonedas = crearIndicador('moneda');
  const marcaRenta = crearIndicador('yunque');
  const marcaTierra = crearIndicador('castillo');
  barra.append(
    marcaTurno.raiz,
    separador(),
    marcaMonedas.raiz,
    marcaRenta.raiz,
    separador(),
    marcaTierra.raiz,
  );
  raiz.appendChild(barra);

  // --- Diario de la partida ---
  const diario = document.createElement('div');
  diario.className = 'gwn-campana-diario';
  raiz.appendChild(diario);

  // --- Panel del ejército elegido ---
  const panel = document.createElement('div');
  panel.className = 'gwn-panel gwn-campana-ejercito gwn-oculto';
  raiz.appendChild(panel);

  // --- Botón de pasar turno ---
  const botonTurno = document.createElement('button');
  botonTurno.type = 'button';
  botonTurno.className = 'gwn-campana-boton-turno';
  botonTurno.appendChild(elementoIcono('reloj'));
  const textoBoton = document.createElement('span');
  textoBoton.textContent = 'Terminar turno';
  botonTurno.appendChild(textoBoton);
  raiz.appendChild(botonTurno);

  let cbTerminar: () => void = () => {};
  botonTurno.addEventListener('click', () => cbTerminar());

  // --- Cartel de fin ---
  const capaFinal = document.createElement('div');
  capaFinal.className = 'gwn-menu-capa gwn-oculto';
  raiz.appendChild(capaFinal);

  return {
    raiz,

    actualizar(campana, seleccionado): void {
      const activo = campana.bandoActivo;
      marcaTurno.valor.textContent = `Turno ${campana.turno} · ${NOMBRE_BANDO[activo]}`;
      marcaTurno.raiz.classList.toggle('gwn-campana-turno-propio', activo === bandoJugador);

      marcaMonedas.valor.textContent = String(campana.monedasDe(bandoJugador));
      marcaRenta.valor.textContent = `+${campana.rentaDe(bandoJugador)}`;
      marcaTierra.valor.textContent = `${campana.territoriosDe(bandoJugador).length}/18`;

      if (!seleccionado) {
        panel.classList.add('gwn-oculto');
      } else {
        panel.classList.remove('gwn-oculto');
        pintarEjercito(panel, seleccionado, campana);
      }
    },

    anotar(texto, tono = 'info'): void {
      const linea = document.createElement('div');
      linea.className = `gwn-campana-nota gwn-campana-nota--${tono}`;
      linea.textContent = texto;
      diario.appendChild(linea);
      // El diario solo guarda lo reciente: es un recordatorio, no un archivo.
      while (diario.childElementCount > 5) diario.removeChild(diario.firstChild!);
      // Se desvanece solo, para no tapar el mapa indefinidamente.
      setTimeout(() => linea.classList.add('gwn-campana-nota--ida'), 5200);
      setTimeout(() => linea.remove(), 6000);
    },

    alTerminarTurno(cb): void {
      cbTerminar = cb;
    },

    fijarVisible(visible): void {
      raiz.classList.toggle('gwn-oculto', !visible);
    },

    fijarEsperando(esperando): void {
      botonTurno.disabled = esperando;
      botonTurno.classList.toggle('gwn-campana-boton-turno--espera', esperando);
      textoBoton.textContent = esperando ? 'El enemigo maniobra…' : 'Terminar turno';
    },

    mostrarFinal(ganador, esElJugador, turnos): void {
      capaFinal.classList.remove('gwn-oculto');
      capaFinal.innerHTML = '';

      const tarjeta = document.createElement('div');
      tarjeta.className = 'gwn-panel gwn-menu-tarjeta';

      const titulo = document.createElement('div');
      titulo.className = 'gwn-menu-titulo';
      titulo.appendChild(elementoIcono(esElJugador ? 'laurel' : 'calavera'));
      const tituloTexto = document.createElement('span');
      tituloTexto.textContent = esElJugador ? 'Victoria' : 'Derrota';
      titulo.appendChild(tituloTexto);
      tarjeta.appendChild(titulo);

      const resultado = document.createElement('div');
      resultado.className = `gwn-menu-resultado gwn-menu-resultado--${esElJugador ? 'victoria' : 'derrota'}`;
      resultado.textContent = `Ha vencido ${NOMBRE_BANDO[ganador]} tras ${turnos} turnos de guerra`;
      tarjeta.appendChild(resultado);

      const otra = document.createElement('button');
      otra.type = 'button';
      otra.className = 'gwn-menu-boton';
      otra.appendChild(elementoIcono('bandera'));
      const otraTexto = document.createElement('span');
      otraTexto.textContent = 'Otra campaña';
      otra.appendChild(otraTexto);
      otra.addEventListener('click', () => location.reload());
      tarjeta.appendChild(otra);

      capaFinal.appendChild(tarjeta);
    },

    liberar(): void {
      raiz.remove();
    },
  };
}

// --- Piezas sueltas ---------------------------------------------------------------

function crearIndicador(
  icono: Parameters<typeof elementoIcono>[0],
): { raiz: HTMLElement; valor: HTMLElement } {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-recurso';
  raiz.appendChild(elementoIcono(icono));
  const valor = document.createElement('span');
  valor.className = 'gwn-recurso-valor';
  valor.textContent = '—';
  raiz.appendChild(valor);
  return { raiz, valor };
}

function separador(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'gwn-recurso gwn-recurso--separador';
  return el;
}

/** Rellena el panel inferior con la ficha del ejército elegido. */
function pintarEjercito(panel: HTMLElement, ejercito: Ejercito, campana: Campana): void {
  panel.innerHTML = '';

  const info = territorio(ejercito.territorio);
  const titulo = document.createElement('div');
  titulo.className = 'gwn-campana-ejercito-titulo';
  titulo.textContent = info.nombre;
  panel.appendChild(titulo);

  const subtitulo = document.createElement('div');
  subtitulo.className = 'gwn-campana-ejercito-sub';
  const partes: string[] = [`${totalTropas(ejercito.composicion)} efectivos`];
  if (ejercito.haMovido) partes.push('ya ha maniobrado');
  else partes.push(`${campana.destinosDe(ejercito.id).length} destinos`);
  subtitulo.textContent = partes.join(' · ');
  panel.appendChild(subtitulo);

  const filas = document.createElement('div');
  filas.className = 'gwn-campana-armas';
  for (const arma of ARMAS) {
    const cuantos = ejercito.composicion[arma];
    if (cuantos === 0) continue;
    const fila = document.createElement('div');
    fila.className = 'gwn-campana-arma';
    fila.appendChild(elementoIcono(ICONO_ARMA[arma]));
    const nombre = document.createElement('span');
    nombre.className = 'gwn-campana-arma-nombre';
    nombre.textContent = NOMBRE_ARMA[arma];
    const cifra = document.createElement('span');
    cifra.className = 'gwn-campana-arma-cifra';
    cifra.textContent = String(cuantos);
    fila.append(nombre, cifra);
    filas.appendChild(fila);
  }
  panel.appendChild(filas);
}

/** Texto para el diario cuando se toma un territorio. */
export function fraseConquista(id: IdTerritorio, bando: BandoCampana): string {
  return `${NOMBRE_BANDO[bando]} toma ${territorio(id).nombre}`;
}
