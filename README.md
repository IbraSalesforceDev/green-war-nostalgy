# Nostalgia de la Guerra Verde

Estrategia en tiempo real isométrica construida sobre Three.js y WebGL 2, jugable
en navegador de escritorio y en móvil.

## Puesta en marcha

```bash
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # comprobación de tipos + compilación a dist/
npm run preview  # sirve dist/ para probar la compilación
```

## Arquitectura

| Directorio | Responsabilidad |
|---|---|
| `src/core/` | Bucle de paso fijo, matemáticas, aleatoriedad determinista, bus de eventos |
| `src/sim/` | Simulación: mundo, mapa, sistemas, datos de equilibrio, búsqueda de caminos |
| `src/render/` | Todo lo visual: terreno, modelos, efectos, cámara, renderizador |
| `src/ui/` | Interfaz superpuesta en DOM: recursos, minimapa, carta de comandos |
| `src/input/` | Entrada unificada de ratón, teclado y táctil |
| `tools/` | Utilidades de desarrollo (capturas automatizadas para revisión visual) |

Dos reglas rigen el proyecto:

1. **La simulación no sabe que existe el render.** Emite hechos por el bus de
   eventos; quién los convierte en chispas o en sonido es asunto de otra capa.
2. **La simulación es determinista.** Paso fijo a 20 Hz y aleatoriedad con semilla:
   la misma partida jugada dos veces da el mismo resultado.

## Capturas para revisión

```bash
npm run build
node tools/capturar.mjs --salida capturas/vista.png
node tools/capturar.mjs --salida capturas/movil.png --ancho 844 --alto 390 --movil
```
