import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * Dos formas de compilar el mismo juego:
 *
 *   · Normal (`npm run build`): el código de Three viaja en su propio trozo. Como
 *     esa dependencia no cambia entre versiones, el navegador la conserva en caché
 *     aunque el resto del juego sí cambie, y una actualización pasa de descargar
 *     780 KB a descargar solo 260 KB. Es lo que interesa en un alojamiento normal.
 *
 *   · Portátil (`npm run build:portatil`): todo en un único fichero, para poder
 *     incrustarlo después en un solo HTML autocontenido con `tools/empaquetar.mjs`.
 *     Ahí partir en trozos sería contraproducente: el HTML no puede pedir nada al
 *     servidor, así que todo tiene que ir dentro sí o sí.
 */
const portatil = process.env.EMPAQUETADO_PORTATIL === '1';

export default defineConfig({
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    target: 'es2022',
    // Los mapas de código pesan 2,8 MB y solo sirven para depurar en el navegador.
    // En una compilación de publicación son peso muerto.
    sourcemap: false,
    rollupOptions: {
      output: portatil
        ? { inlineDynamicImports: true }
        : { manualChunks: { three: ['three'] } },
    },
  },
  worker: {
    format: 'es',
  },
});
