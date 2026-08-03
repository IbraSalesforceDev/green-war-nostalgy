import type { Mundo } from '../sim/mundo';
import { Bando } from '../sim/tipos';
import { elementoIcono } from './iconos';

/**
 * Franja superior de recursos: oro, madera, población y reloj de partida.
 *
 * Los números no saltan al cambiar: cada valor mostrado persigue al real con una
 * media exponencial (la misma técnica que usa `CamaraJuego` para suavizar su
 * movimiento), así que un ingreso grande de golpe —entregar una carga, terminar
 * un edificio— se ve rodar en vez de parpadear.
 *
 * Rendimiento: `actualizar` se llama a 60 Hz desde `Hud`, pero el DOM solo se
 * toca cuando el texto entero (ya redondeado) cambia respecto al último fotograma.
 */
export interface BarraRecursos {
  readonly raiz: HTMLElement;
  /** `tiempoPartida` en segundos (viene de `sesion`, no de `mundo`). */
  actualizar(mundo: Mundo, bando: Bando, tiempoPartida: number, dt: number): void;
  liberar(): void;
}

interface Contador {
  elemento: HTMLElement;
  mostrado: number;
  ultimoTexto: string;
}

/** Formatea segundos de partida como mm:ss. */
function formatearTiempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? '0' : ''}${r}`;
}

function crearRecurso(icono: Parameters<typeof elementoIcono>[0], claseExtra = ''): {
  raiz: HTMLElement;
  contador: Contador;
} {
  const raiz = document.createElement('div');
  raiz.className = `gwn-recurso ${claseExtra}`.trim();
  raiz.appendChild(elementoIcono(icono));
  const valor = document.createElement('span');
  valor.className = 'gwn-recurso-valor';
  valor.textContent = '0';
  raiz.appendChild(valor);
  return { raiz, contador: { elemento: valor, mostrado: 0, ultimoTexto: '0' } };
}

/** Actualiza el contador rodante y solo escribe en el DOM si el texto cambió. */
function avanzarContador(contador: Contador, objetivo: number, dt: number, texto: (v: number) => string): void {
  // Diferencias pequeñas conviene resolverlas de golpe: nadie quiere ver "9.97"
  // persiguiendo "10" para siempre por el decaimiento exponencial.
  if (Math.abs(objetivo - contador.mostrado) < 0.05) {
    contador.mostrado = objetivo;
  } else {
    contador.mostrado += (objetivo - contador.mostrado) * Math.min(1, dt * 8);
  }
  const nuevoTexto = texto(contador.mostrado);
  if (nuevoTexto !== contador.ultimoTexto) {
    contador.ultimoTexto = nuevoTexto;
    contador.elemento.textContent = nuevoTexto;
  }
}

export function crearBarraRecursos(): BarraRecursos {
  const raiz = document.createElement('div');
  raiz.className = 'gwn-panel gwn-recursos';
  raiz.setAttribute('role', 'status');
  raiz.setAttribute('aria-label', 'Recursos');

  const oro = crearRecurso('moneda');
  const madera = crearRecurso('tronco');
  const poblacion = crearRecurso('personas', 'gwn-recurso--poblacion');
  const separador = document.createElement('div');
  separador.className = 'gwn-recurso--separador';
  const reloj = crearRecurso('reloj', 'gwn-recurso--reloj');

  raiz.append(oro.raiz, madera.raiz, poblacion.raiz, separador, reloj.raiz);

  // La población no es un número que ruede: es "actual/máximo", así que se
  // reescribe entero cuando cualquiera de los dos cambia, sin animación de conteo
  // (rodar un cociente confundiría más de lo que aclara).
  let poblacionMostrada = '';
  let limiteMostrado = false;

  return {
    raiz,

    actualizar(mundo: Mundo, bando: Bando, tiempoPartida: number, dt: number): void {
      const estado = mundo.estadoDe(bando);

      avanzarContador(oro.contador, estado.oro, dt, (v) => String(Math.round(v)));
      avanzarContador(madera.contador, estado.madera, dt, (v) => String(Math.round(v)));

      const textoReloj = formatearTiempo(tiempoPartida);
      if (textoReloj !== reloj.contador.ultimoTexto) {
        reloj.contador.ultimoTexto = textoReloj;
        reloj.contador.elemento.textContent = textoReloj;
      }

      const texto = `${estado.poblacion}/${estado.poblacionMaxima}`;
      if (texto !== poblacionMostrada) {
        poblacionMostrada = texto;
        poblacion.contador.elemento.textContent = texto;
      }
      const alLimite = estado.poblacion >= estado.poblacionMaxima && estado.poblacionMaxima > 0;
      if (alLimite !== limiteMostrado) {
        limiteMostrado = alLimite;
        poblacion.raiz.classList.toggle('gwn-recurso--limite', alLimite);
      }
    },

    liberar(): void {
      raiz.remove();
    },
  };
}
