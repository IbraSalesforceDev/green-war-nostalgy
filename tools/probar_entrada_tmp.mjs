#!/usr/bin/env node
// Prueba de verdad del banco de entrada con Playwright + Chromium real (SwiftShader).
// Calca el patrón de tools/capturar.mjs para localizar Chromium.

import { chromium } from 'playwright';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

async function buscarChromium() {
  if (process.env.CHROMIUM_EJECUTABLE && existsSync(process.env.CHROMIUM_EJECUTABLE)) {
    return process.env.CHROMIUM_EJECUTABLE;
  }
  const raiz = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(raiz)) return undefined;
  const entradas = await readdir(raiz).catch(() => []);
  const candidatos = entradas
    .filter((n) => n.startsWith('chromium') && !n.includes('headless_shell'))
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

const resultados = [];
function verificar(nombre, condicion, detalle = '') {
  resultados.push({ nombre, ok: !!condicion, detalle });
  console.log(`${condicion ? 'OK  ' : 'FAIL'} ${nombre}${detalle ? ' — ' + detalle : ''}`);
}

async function main() {
  const navegador = await chromium.launch({
    executablePath: await buscarChromium(),
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
  const pagina = await contexto.newPage();
  const erroresConsola = [];
  pagina.on('console', (m) => { if (m.type() === 'error') erroresConsola.push(m.text()); });
  pagina.on('pageerror', (e) => erroresConsola.push(String(e)));

  await pagina.goto('http://127.0.0.1:4205/banco-entrada.html', { waitUntil: 'networkidle', timeout: 60000 });
  await pagina.waitForFunction(() => Boolean(window.banco), { timeout: 20000 });
  await pagina.waitForTimeout(300);

  // Utilidad: proyecta una entidad a coordenadas de pantalla usando la cámara real.
  const proyectar = async (entidad) => pagina.evaluate((e) => {
    const b = window.banco;
    const i = e & 0xfffff;
    const salida = { x: 0, y: 0 };
    const rect = b.lienzo.getBoundingClientRect();
    b.camara.aPantalla(b.mundo.x[i], b.mundo.alturaDe(i), b.mundo.z[i], rect.width, rect.height, salida);
    return { x: salida.x + rect.left, y: salida.y + rect.top };
  }, entidad);

  const estado = () => pagina.evaluate(() => ({
    seleccion: window.banco.sesion.seleccion.length,
    seleccionIds: window.banco.sesion.seleccion.slice(),
    colocacionActiva: window.banco.sesion.colocacion.activo,
    cajaSeleccion: window.banco.sesion.cajaSeleccion,
    zoom: window.banco.camara.distancia,
    azimut: window.banco.camara.azimut,
    objetivoX: window.banco.camara.objetivoX,
    objetivoZ: window.banco.camara.objetivoZ,
  }));

  // ── 1. Clic simple sobre una unidad propia selecciona solo esa unidad ──────────
  const primerHumano = await pagina.evaluate(() => window.banco.unidadesHumanos[0]);
  let p = await proyectar(primerHumano);
  await pagina.mouse.click(p.x, p.y);
  await pagina.waitForTimeout(50);
  let e = await estado();
  verificar('clic izquierdo selecciona 1 unidad', e.seleccion === 1, `seleccion=${e.seleccion}`);

  // ── 2. Clic en suelo vacío deselecciona ────────────────────────────────────────
  await pagina.mouse.click(700, 700);
  await pagina.waitForTimeout(50);
  e = await estado();
  verificar('clic en vacío deselecciona', e.seleccion === 0, `seleccion=${e.seleccion}`);

  // ── 3. Shift+clic añade a la selección ─────────────────────────────────────────
  const segundoHumano = await pagina.evaluate(() => window.banco.unidadesHumanos[1]);
  p = await proyectar(primerHumano);
  await pagina.mouse.click(p.x, p.y);
  const p2 = await proyectar(segundoHumano);
  await pagina.keyboard.down('Shift');
  await pagina.mouse.click(p2.x, p2.y);
  await pagina.keyboard.up('Shift');
  await pagina.waitForTimeout(50);
  e = await estado();
  verificar('mayúsculas + clic añade a la selección', e.seleccion === 2, `seleccion=${e.seleccion}`);

  // ── 4. Caja de arrastre sobre el clúster humano selecciona varias, no orcos ────
  await pagina.mouse.click(700, 700); // limpia
  await pagina.mouse.move(20, 20);
  await pagina.mouse.down();
  await pagina.mouse.move(760, 760, { steps: 12 });
  await pagina.mouse.up();
  await pagina.waitForTimeout(50);
  e = await estado();
  const bandosSeleccionados = await pagina.evaluate((ids) => {
    const b = window.banco;
    return ids.map((id) => b.mundo.bando[id & 0xfffff]);
  }, e.seleccionIds);
  const soloHumanos = bandosSeleccionados.length > 0 && bandosSeleccionados.every((bd) => bd === 1);
  verificar(
    'caja de selección arrastrada coge varias unidades propias, ninguna enemiga',
    e.seleccion > 1 && soloHumanos,
    `seleccion=${e.seleccion} bandos=${bandosSeleccionados}`,
  );

  // ── 5. Doble clic selecciona todas las del mismo tipo en pantalla ──────────────
  await pagina.mouse.click(700, 700);
  const tipoPrimerHumano = await pagina.evaluate((e2) => window.banco.mundo.tipo[e2 & 0xfffff], primerHumano);
  p = await proyectar(primerHumano);
  await pagina.mouse.dblclick(p.x, p.y);
  await pagina.waitForTimeout(50);
  e = await estado();
  const tiposSeleccionados = await pagina.evaluate((ids) => {
    const b = window.banco;
    return ids.map((id) => b.mundo.tipo[id & 0xfffff]);
  }, e.seleccionIds);
  const mismoTipo = tiposSeleccionados.every((t) => t === tipoPrimerHumano);
  verificar(
    'doble clic selecciona todas las del mismo tipo',
    e.seleccion >= 2 && mismoTipo,
    `seleccion=${e.seleccion} tipos=${tiposSeleccionados}`,
  );

  // ── 6. Clic derecho sobre un enemigo, con selección propia, ordena atacar ──────
  await pagina.mouse.click(700, 700);
  p = await proyectar(primerHumano);
  await pagina.mouse.click(p.x, p.y);
  const primerOrco = await pagina.evaluate(() => window.banco.unidadesOrcos[0]);
  const pOrco = await proyectar(primerOrco);
  await pagina.mouse.click(pOrco.x, pOrco.y, { button: 'right' });
  await pagina.waitForTimeout(50);
  const ordenAtaque = await pagina.evaluate(
    ([atacante, objetivo]) => {
      const b = window.banco;
      const i = atacante & 0xfffff;
      return { orden: b.mundo.orden[i], objetivo: b.mundo.ordenObjetivo[i] === objetivo };
    },
    [primerHumano, primerOrco],
  );
  verificar(
    'clic derecho sobre un enemigo ordena atacar (Orden.ATACAR=3)',
    ordenAtaque.orden === 3 && ordenAtaque.objetivo,
    JSON.stringify(ordenAtaque),
  );

  // ── 7. Rueda del ratón: zoom hacia el cursor ───────────────────────────────────
  const antesZoom = await estado();
  await pagina.mouse.move(300, 300);
  await pagina.mouse.wheel(0, -400);
  await pagina.waitForTimeout(400);
  const despuesZoom = await estado();
  verificar(
    'rueda del ratón acerca el zoom',
    despuesZoom.zoom < antesZoom.zoom,
    `antes=${antesZoom.zoom.toFixed(2)} despues=${despuesZoom.zoom.toFixed(2)}`,
  );

  // ── 8. Botón de la interfaz no selecciona nada por debajo ──────────────────────
  await pagina.mouse.click(700, 700);
  const botonBox = await pagina.evaluate(() => {
    const r = document.getElementById('boton-prueba-ui').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await pagina.mouse.click(botonBox.x, botonBox.y);
  await pagina.waitForTimeout(50);
  e = await estado();
  verificar('un clic sobre #capa-ui no llega al mundo', e.seleccion === 0, `seleccion=${e.seleccion}`);

  // ── 9. Teclado: grupo de control 1 (Ctrl+1 guarda, 1 recupera) ─────────────────
  await pagina.mouse.click(700, 700);
  p = await proyectar(primerHumano);
  await pagina.mouse.click(p.x, p.y);
  await pagina.keyboard.down('Control');
  await pagina.keyboard.press('Digit1');
  await pagina.keyboard.up('Control');
  await pagina.mouse.click(700, 700); // deseleccionar
  await pagina.keyboard.press('Digit1');
  await pagina.waitForTimeout(50);
  e = await estado();
  verificar(
    'Ctrl+1 guarda grupo, 1 lo recupera',
    e.seleccion === 1 && e.seleccionIds[0] === primerHumano,
    `seleccion=${e.seleccion}`,
  );

  // ── 10. Teclado: H mantiene posición, S detiene ────────────────────────────────
  await pagina.keyboard.press('KeyH');
  await pagina.waitForTimeout(30);
  let ordenH = await pagina.evaluate((e2) => window.banco.mundo.orden[e2 & 0xfffff], primerHumano);
  verificar('H ordena mantener posición (Orden.MANTENER_POSICION=9)', ordenH === 9, `orden=${ordenH}`);
  await pagina.keyboard.press('KeyS');
  await pagina.waitForTimeout(30);
  let ordenS = await pagina.evaluate((e2) => window.banco.mundo.orden[e2 & 0xfffff], primerHumano);
  verificar('S cancela la orden (Orden.NINGUNA=0)', ordenS === 0, `orden=${ordenS}`);

  // ── 11. Teclado: A + clic ordena ataque-movimiento a ese punto ─────────────────
  await pagina.keyboard.press('KeyA');
  await pagina.mouse.click(600, 200);
  await pagina.waitForTimeout(30);
  let ordenA = await pagina.evaluate((e2) => window.banco.mundo.orden[e2 & 0xfffff], primerHumano);
  verificar('A + clic ordena ataque-movimiento (Orden.ATACAR_MOVER=2)', ordenA === 2, `orden=${ordenA}`);

  // ── 12. Teclado: Escape cancela un modo de objetivo activo ─────────────────────
  await pagina.keyboard.press('KeyS');
  await pagina.keyboard.press('KeyP');
  await pagina.keyboard.press('Escape');
  await pagina.mouse.click(500, 500);
  await pagina.waitForTimeout(30);
  let ordenTrasEscape = await pagina.evaluate((e2) => window.banco.mundo.orden[e2 & 0xfffff], primerHumano);
  verificar(
    'Esc cancela el modo P antes de que un clic posterior ordene patrullar',
    ordenTrasEscape !== 8,
    `orden=${ordenTrasEscape}`,
  );

  // ── 13. Táctil (PointerEvent sintético): un dedo arrastra la cámara con inercia ─
  await pagina.evaluate(() => {
    const lienzo = window.banco.lienzo;
    function disparar(tipo, id, x, y) {
      lienzo.dispatchEvent(new PointerEvent(tipo, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
      }));
    }
    disparar('pointerdown', 91, 640, 400);
    disparar('pointermove', 91, 540, 400);
    disparar('pointermove', 91, 440, 400);
    disparar('pointermove', 91, 340, 400);
    disparar('pointerup', 91, 340, 400);
  });
  const objetivoTrasArrastre = await estado();
  await pagina.waitForTimeout(500); // deja correr la inercia
  const objetivoTrasInercia = await estado();
  verificar(
    'un dedo arrastra la cámara (objetivoX cambia)',
    objetivoTrasArrastre.objetivoX !== antesZoom.objetivoX || objetivoTrasArrastre.objetivoZ !== antesZoom.objetivoZ,
    `dx=${(objetivoTrasArrastre.objetivoX - antesZoom.objetivoX).toFixed(3)}`,
  );
  verificar(
    'la cámara sigue moviéndose por inercia tras soltar el dedo',
    Math.abs(objetivoTrasInercia.objetivoX - objetivoTrasArrastre.objetivoX) > 0.01 ||
      Math.abs(objetivoTrasInercia.objetivoZ - objetivoTrasArrastre.objetivoZ) > 0.01,
    `delta=${Math.hypot(
      objetivoTrasInercia.objetivoX - objetivoTrasArrastre.objetivoX,
      objetivoTrasInercia.objetivoZ - objetivoTrasArrastre.objetivoZ,
    ).toFixed(4)}`,
  );

  // ── 14. Táctil: pulsación larga en vacío (sin selección) abre modo caja ────────
  await pagina.evaluate(() => { window.banco.sesion.limpiarSeleccion(); });
  const cajaDuranteLarga = await pagina.evaluate(async () => {
    const lienzo = window.banco.lienzo;
    function disparar(tipo, id, x, y) {
      lienzo.dispatchEvent(new PointerEvent(tipo, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
      }));
    }
    disparar('pointerdown', 92, 900, 150);
    await new Promise((r) => setTimeout(r, 450)); // supera MS_PULSACION_LARGA
    disparar('pointermove', 92, 950, 220);
    const activa = window.banco.sesion.cajaSeleccion !== null;
    disparar('pointerup', 92, 950, 220);
    return activa;
  });
  verificar('pulsación larga en vacío entra en modo caja de selección', cajaDuranteLarga === true);

  // ── 15. Táctil: con selección propia, pulsación larga dispara orden contextual ─
  p = await proyectar(primerHumano);
  await pagina.evaluate((coords) => {
    const lienzo = window.banco.lienzo;
    lienzo.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 93, pointerType: 'touch', clientX: coords.x, clientY: coords.y,
      bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
    }));
    lienzo.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 93, pointerType: 'touch', clientX: coords.x, clientY: coords.y,
      bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
    }));
  }, p);
  await pagina.waitForTimeout(30);
  e = await estado();
  verificar('toque corto táctil sobre una unidad la selecciona', e.seleccion === 1, `seleccion=${e.seleccion}`);

  const destinoMundo = { x: 30, z: 30 };
  const destinoPantalla = await pagina.evaluate((punto) => {
    const b = window.banco;
    const salida = { x: 0, y: 0 };
    const rect = b.lienzo.getBoundingClientRect();
    b.camara.aPantalla(punto.x, b.mundo.mapa.alturaEnMundo(punto.x, punto.z), punto.z, rect.width, rect.height, salida);
    return { x: salida.x + rect.left, y: salida.y + rect.top };
  }, destinoMundo);

  await pagina.evaluate(async (coords) => {
    const lienzo = window.banco.lienzo;
    function disparar(tipo, id, x, y) {
      lienzo.dispatchEvent(new PointerEvent(tipo, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, isPrimary: true, button: 0,
      }));
    }
    disparar('pointerdown', 94, coords.x, coords.y);
    await new Promise((r) => setTimeout(r, 450));
    disparar('pointerup', 94, coords.x, coords.y);
  }, destinoPantalla);
  await pagina.waitForTimeout(30);
  const ordenTrasLarga = await pagina.evaluate((e2) => window.banco.mundo.orden[e2 & 0xfffff], primerHumano);
  verificar(
    'con selección propia, pulsación larga táctil dispara orden contextual (mover=1)',
    ordenTrasLarga === 1,
    `orden=${ordenTrasLarga}`,
  );

  // ── 16. Táctil: pellizco de dos dedos hace zoom ────────────────────────────────
  const antesPellizco = await estado();
  await pagina.evaluate(() => {
    const lienzo = window.banco.lienzo;
    function disparar(tipo, id, x, y) {
      lienzo.dispatchEvent(new PointerEvent(tipo, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, isPrimary: id === 201, button: 0,
      }));
    }
    disparar('pointerdown', 201, 600, 400);
    disparar('pointerdown', 202, 700, 400);
    disparar('pointermove', 201, 550, 400);
    disparar('pointermove', 202, 750, 400);
    disparar('pointermove', 201, 500, 400);
    disparar('pointermove', 202, 800, 400);
    disparar('pointerup', 201, 500, 400);
    disparar('pointerup', 202, 800, 400);
  });
  await pagina.waitForTimeout(50);
  const despuesPellizco = await estado();
  verificar(
    'el pellizco de dos dedos separándose acerca el zoom',
    despuesPellizco.zoom < antesPellizco.zoom,
    `antes=${antesPellizco.zoom.toFixed(2)} despues=${despuesPellizco.zoom.toFixed(2)}`,
  );

  // ── 17. Táctil: rotación de dos dedos gira la cámara ───────────────────────────
  const antesGiro = await estado();
  await pagina.evaluate(() => {
    const lienzo = window.banco.lienzo;
    function disparar(tipo, id, x, y) {
      lienzo.dispatchEvent(new PointerEvent(tipo, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
        bubbles: true, cancelable: true, composed: true, isPrimary: id === 301, button: 0,
      }));
    }
    disparar('pointerdown', 301, 640, 300);
    disparar('pointerdown', 302, 640, 500);
    // Gira el par de dedos ~90 grados alrededor del centro (640,400).
    disparar('pointermove', 301, 500, 400);
    disparar('pointermove', 302, 780, 400);
    disparar('pointerup', 301, 500, 400);
    disparar('pointerup', 302, 780, 400);
  });
  await pagina.waitForTimeout(50);
  const despuesGiro = await estado();
  verificar(
    'la rotación de dos dedos gira la cámara (azimut cambia)',
    Math.abs(despuesGiro.azimut - antesGiro.azimut) > 0.03,
    `antes=${antesGiro.azimut.toFixed(3)} despues=${despuesGiro.azimut.toFixed(3)}`,
  );

  // ── 18. Construcción: B abre colocación, clic la confirma con un obrero ───────
  await pagina.evaluate(() => window.banco.sesion.limpiarSeleccion());
  const campesinoHumano = await pagina.evaluate(() => {
    const b = window.banco;
    return b.unidadesHumanos.find((ent) => b.mundo.tipo[ent & 0xfffff] === 0); // CAMPESINO=0
  });
  const pCampesino = await proyectar(campesinoHumano);
  await pagina.mouse.click(pCampesino.x, pCampesino.y);
  await pagina.keyboard.press('KeyB');
  await pagina.waitForTimeout(30);
  e = await estado();
  verificar('B activa el fantasma de colocación', e.colocacionActiva === true);

  // Mueve el ratón hasta un hueco llano y libre, y espera a que se marque válido.
  const puntoLibre = { x: 20, z: 20 };
  const pantallaLibre = await pagina.evaluate((punto) => {
    const b = window.banco;
    const salida = { x: 0, y: 0 };
    const rect = b.lienzo.getBoundingClientRect();
    b.camara.aPantalla(punto.x, b.mundo.mapa.alturaEnMundo(punto.x, punto.z), punto.z, rect.width, rect.height, salida);
    return { x: salida.x + rect.left, y: salida.y + rect.top };
  }, puntoLibre);
  await pagina.mouse.move(pantallaLibre.x, pantallaLibre.y, { steps: 5 });
  await pagina.waitForTimeout(80);
  const validaAntes = await pagina.evaluate(() => window.banco.sesion.colocacion.valida);
  await pagina.mouse.click(pantallaLibre.x, pantallaLibre.y);
  await pagina.waitForTimeout(80);
  const entidadesTrasConstruir = await pagina.evaluate(() => window.banco.mundo.contarActivas());
  e = await estado();
  verificar(
    'un clic sobre suelo válido confirma la colocación y crea el andamio',
    validaAntes === true && e.colocacionActiva === false,
    `validaAntes=${validaAntes} colocacionActiva=${e.colocacionActiva} entidades=${entidadesTrasConstruir}`,
  );

  await navegador.close();

  console.log('\nErrores de consola:', erroresConsola.length);
  if (erroresConsola.length > 0) console.log(erroresConsola.slice(0, 10));

  const fallidos = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallidos.length}/${resultados.length} pruebas en verde.`);
  if (fallidos.length > 0) {
    console.log('Fallidas:', fallidos.map((f) => f.nombre));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
