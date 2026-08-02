#!/usr/bin/env node
/**
 * Captura fotogramas del juego con Chromium para la revisión visual.
 *
 * Es la herramienta que usan los agentes revisores: sin capturas reales, cualquier
 * juicio sobre «si esto se ve AAA» sería una opinión sobre el código fuente, no
 * sobre lo que ve el jugador.
 *
 * Uso:
 *   node tools/capturar.mjs --salida capturas/base.png
 *   node tools/capturar.mjs --salida capturas/movil.png --ancho 844 --alto 390 --movil
 *   node tools/capturar.mjs --salida capturas/zoom.png --camara 30,30,18
 *
 * Requiere un servidor sirviendo el juego. Si no se pasa --url, arranca
 * `vite preview` por su cuenta y lo apaga al terminar.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Localiza el Chromium ya instalado en el entorno.
 *
 * La versión de Playwright y la del navegador preinstalado no tienen por qué
 * coincidir, y descargar otro navegador entero para una captura no tiene sentido.
 * Usamos el Chromium completo, no el `headless_shell`: este último viene recortado
 * y no trae el soporte de WebGL 2 que el juego necesita.
 */
async function buscarChromium() {
  if (process.env.CHROMIUM_EJECUTABLE && existsSync(process.env.CHROMIUM_EJECUTABLE)) {
    return process.env.CHROMIUM_EJECUTABLE;
  }
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(raiz)) return undefined;

  const entradas = await readdir(raiz).catch(() => []);
  const candidatos = entradas
    .filter((nombre) => nombre.startsWith('chromium') && !nombre.includes('headless_shell'))
    .sort()
    .reverse();

  for (const candidato of candidatos) {
    for (const relativo of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome']) {
      const ruta = join(raiz, candidato, relativo);
      if (existsSync(ruta)) return ruta;
    }
  }
  return undefined;
}

const args = process.argv.slice(2);

function opcion(nombre, porDefecto = null) {
  const indice = args.indexOf(`--${nombre}`);
  if (indice === -1) return porDefecto;
  const valor = args[indice + 1];
  return valor && !valor.startsWith('--') ? valor : true;
}

const salida = resolve(opcion('salida', 'capturas/captura.png'));
const ancho = Number(opcion('ancho', 1600));
const alto = Number(opcion('alto', 900));
const esperaMs = Number(opcion('espera', 2500));
const esMovil = Boolean(opcion('movil', false));
const urlManual = opcion('url', null);
const poseCamara = opcion('camara', null);
const semilla = opcion('semilla', null);
// Puerto propio por invocación: permite que varias revisiones capturen a la vez.
const puerto = Number(opcion('puerto', 4173));

/**
 * Arranca `vite preview` y espera a que responda.
 *
 * Sondeamos el puerto en lugar de leer la salida del proceso: cuando no hay terminal
 * interactiva, Vite no imprime su cartel y esperar a ese texto cuelga el script.
 */
async function levantarServidor(puerto = 4173) {
  const proceso = spawn('npx', ['vite', 'preview', '--port', String(puerto), '--host', '127.0.0.1'], {
    stdio: 'ignore',
    detached: false,
  });

  const url = `http://127.0.0.1:${puerto}/`;
  const limite = Date.now() + 30000;

  while (Date.now() < limite) {
    try {
      const respuesta = await fetch(url, { method: 'HEAD' });
      if (respuesta.ok) return { url, cerrar: () => proceso.kill('SIGTERM') };
    } catch {
      // Aún no escucha; se reintenta.
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  proceso.kill('SIGTERM');
  throw new Error('El servidor de vista previa no arrancó a tiempo');
}

async function principal() {
  await mkdir(dirname(salida), { recursive: true });

  const servidor = urlManual
    ? { url: urlManual, cerrar: () => {} }
    : await levantarServidor(puerto);

  const navegador = await chromium.launch({
    executablePath: await buscarChromium(),
    args: [
      // El contenedor no tiene GPU: sin esto Chromium cae a un WebGL por software
      // que ni siquiera soporta las extensiones que necesitamos.
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: alto },
    deviceScaleFactor: esMovil ? 2 : 1,
    isMobile: esMovil,
    hasTouch: esMovil,
    userAgent: esMovil
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
      : undefined,
  });

  const pagina = await contexto.newPage();
  const errores = [];
  pagina.on('console', (mensaje) => {
    if (mensaje.type() === 'error') errores.push(mensaje.text());
  });
  pagina.on('pageerror', (error) => errores.push(String(error)));

  const url = semilla ? `${servidor.url}?semilla=${semilla}` : servidor.url;
  await pagina.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  // Esperamos a que el juego se declare listo, no a un tiempo arbitrario.
  try {
    await pagina.waitForFunction(() => Boolean(window.juego), { timeout: 45000 });
  } catch {
    console.error('AVISO: el juego no expuso window.juego; se captura igualmente.');
  }

  if (poseCamara) {
    const [cx, cz, dist] = String(poseCamara).split(',').map(Number);
    await pagina.evaluate(
      ([x, z, d]) => {
        const camara = window.juego?.camara;
        if (!camara) return;
        camara.saltarA(x, z);
        if (d) {
          camara.distancia = d;
          camara.acercar(d / camara.distancia);
        }
      },
      [cx, cz, dist],
    );
  }

  await pagina.waitForTimeout(esperaMs);

  await pagina.screenshot({ path: salida });

  const telemetria = await pagina
    .evaluate(() => {
      const j = window.juego;
      if (!j) return null;
      return {
        fps: Math.round(j.bucle?.fps ?? 0),
        msRender: Number((j.bucle?.msRender ?? 0).toFixed(2)),
        msSimulacion: Number((j.bucle?.msSimulacion ?? 0).toFixed(2)),
        escalaRender: Number((j.renderizador?.escala ?? 1).toFixed(2)),
        calidad: j.renderizador?.calidad?.nivel,
        entidades: j.mundo?.contarActivas?.() ?? 0,
        llamadas: j.renderizador?.instantanea?.().llamadas ?? 0,
        triangulos: j.renderizador?.instantanea?.().triangulos ?? 0,
      };
    })
    .catch(() => null);

  await navegador.close();
  servidor.cerrar();

  console.log(JSON.stringify({ salida, telemetria, errores }, null, 2));

  if (errores.length > 0) {
    console.error(`\nSe registraron ${errores.length} errores en consola.`);
    process.exitCode = 1;
  }
}

principal().catch((error) => {
  console.error(error);
  process.exit(1);
});
