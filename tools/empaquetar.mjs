#!/usr/bin/env node
/**
 * Empaqueta el juego ya compilado en un único fichero HTML autocontenido.
 *
 * Para qué sirve: un solo fichero se puede abrir desde cualquier sitio —el móvil,
 * una memoria USB, un adjunto de correo, un artefacto publicado— sin servidor, sin
 * red y sin instalar nada. Todo el juego (código, estilos y texturas, que se generan
 * por código y no son ficheros) viaja dentro.
 *
 * Uso:
 *   npm run build:portatil          compila y empaqueta de una vez
 *   node tools/empaquetar.mjs       empaqueta lo que ya haya en dist/
 *   node tools/empaquetar.mjs --cuerpo   solo el contenido, sin <html>/<head>/<body>
 *
 * La variante `--cuerpo` existe porque algunos alojamientos (los artefactos de
 * Claude, por ejemplo) envuelven lo que se les da en su propio esqueleto de
 * documento. Entregarles un documento completo anidaría un <html> dentro de un
 * <body>, y el resultado depende del navegador. Con esta opción se entrega solo lo
 * que va dentro del cuerpo y el envoltorio lo pone el anfitrión.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const soloCuerpo = process.argv.includes('--cuerpo');
const dist = 'dist';
const salida = soloCuerpo
  ? 'dist-portatil/nostalgia-guerra-verde-cuerpo.html'
  : 'dist-portatil/nostalgia-guerra-verde.html';

if (!existsSync(dist)) {
  console.error('No hay carpeta dist/. Ejecuta antes: EMPAQUETADO_PORTATIL=1 npm run build');
  process.exit(1);
}

const assets = join(dist, 'assets');
const nombres = readdirSync(assets);
const ficheroJs = nombres.filter((n) => n.endsWith('.js'));
const ficheroCss = nombres.filter((n) => n.endsWith('.css'));

if (ficheroJs.length !== 1) {
  console.error(
    `Se esperaba un único fichero .js en dist/assets y hay ${ficheroJs.length}.\n` +
      'Compila con EMPAQUETADO_PORTATIL=1 para que todo salga en un solo trozo.',
  );
  process.exit(1);
}

let html = readFileSync(join(dist, 'index.html'), 'utf8');
let js = readFileSync(join(assets, ficheroJs[0]), 'utf8');
const css = ficheroCss.map((n) => readFileSync(join(assets, n), 'utf8')).join('\n');

// Un "</script>" literal dentro del código cerraría la etiqueta antes de tiempo y
// partiría la página en dos. Escaparlo mantiene la cadena idéntica en JavaScript
// mientras deja de ser un cierre válido para el analizador de HTML.
js = js.replace(/<\/script>/g, '<\\/script>');

// Ojo con `String.replace` y los reemplazos como cadena: interpreta $&, $1… y el
// código minificado los contiene. Con una función de reemplazo no interpreta nada.
const meter = (texto, patron, contenido) => texto.replace(patron, () => contenido);

let resultado;
if (soloCuerpo) {
  const estilosDelDocumento = html.match(/<style>([\s\S]*?)<\/style>/);
  let cuerpo = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  cuerpo = cuerpo.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '');

  resultado = [
    estilosDelDocumento ? `<style>${estilosDelDocumento[1]}</style>` : '',
    `<style>${css}</style>`,
    cuerpo.trim(),
    `<script type="module">${js}</script>`,
  ]
    .filter(Boolean)
    .join('\n');

  for (const prohibida of ['<!doctype', '<html', '<head', '<body']) {
    if (resultado.toLowerCase().includes(prohibida)) {
      console.error(`El modo --cuerpo no debe contener ${prohibida}`);
      process.exit(1);
    }
  }
} else {
  resultado = meter(html, /<link[^>]*rel="stylesheet"[^>]*>/, `<style>${css}</style>`);
  resultado = meter(
    resultado,
    /<script[^>]*type="module"[^>]*src="[^"]*"[^>]*><\/script>/,
    `<script type="module">${js}</script>`,
  );
}

if (/(?:src|href)="(?!data:)/.test(resultado)) {
  console.error('Ha quedado alguna referencia externa sin incrustar; el fichero no es autónomo.');
  process.exit(1);
}

mkdirSync(dirname(salida), { recursive: true });
writeFileSync(salida, resultado, 'utf8');
console.log(`${salida} — ${Math.round(Buffer.byteLength(resultado) / 1024)} KB`);
