# Scroll de terminal y conversación fullscreen

## Defecto y causa

Síntoma reportado: «no puedo dar scroll a lo demás de la conversación».
Hay dos recorridos distintos: el historial del shell pertenece al buffer normal
de xterm; una aplicación fullscreen en buffer alternativo conserva y desplaza
su propia conversación al recibir reportes de ratón del PTY.

La frontera concreta está en `TerminalPanel.jsx` (`term.onData`) y
`inputOwnership.js` (`writeOwnedTerminalInput`). El camino de teclado exige
stream escribible, panel activo y foco DOM dentro de ese terminal. Aplicar
esa misma condición a los reportes de rueda descarta la entrada de la
aplicación cuando el foco está en su toolbar, el canvas u otro panel.
La excepción recuperada `wheelOwned` permite entregar los reportes generados
por xterm durante la rueda sin cambiar foco ni selección; no concede ownership
de teclado a eventos posteriores. Los bloqueos de interfaz/overview y de
transporte siguen impidiendo escrituras.

La inspección encontró además dos casos concretos pendientes en esa base:

- `Canvas.jsx` captura `wheel` antes de xterm. Su condición sobre `.node-body`
  cedía solo la rueda sin modificadores: Ctrl/Cmd/Alt provocaban zoom de cámara
  e interrumpían la propagación. Ahora `.terminal-host` queda en manos de xterm
  antes de decidir zoom o desplazamiento del mapa.
- xterm 6, en `node_modules/@xterm/xterm/src/browser/CoreBrowserTerminal.ts`
  (`_bindMouse`, listener permanente de rueda), genera flechas Up/Down cuando
  el buffer carece de scrollback y no tiene listener de rueda del protocolo de
  ratón. No equivalen a scroll de conversación. El custom wheel handler de
  `TerminalPanel.jsx` rechaza ese recorrido en buffer alternativo sin un modo
  que reporte rueda (`vt200`, `drag`, `any`; X10 no reporta rueda). Solo los
  reportes de esos modos reciben la excepción de ownership. El buffer normal
  conserva el scrollback nativo de xterm, sin inventar historial alternativo.

`useCanvasCamera.js` conserva los avances recuperados de acumulación y
persistencia de cámara. Esta corrección se realiza en el enrutamiento de
entrada, manteniendo los controles y el mundo visual dark existentes.

## Reproducción y comprobación manual

Usar un proyecto de prueba y una terminal con una sesión viva. En mapa, mantener
el zoom suficiente para interactuar con el terminal, fuera del overview.

1. En Bash, generar más líneas que las visibles:

   ```bash
   for i in {1..160}; do printf 'SCROLL_LINE_%03d\n' "$i"; done
   ```

   Con el puntero sobre el texto, subir hasta ver líneas anteriores y bajar
   hasta recuperar `SCROLL_LINE_160` y el prompt. Repetir dejando el foco de
   teclado en un botón de la toolbar mediante Tab. El botón debe conservar el
   foco; la cámara y la selección no deben cambiar por la rueda.
2. Abrir la aplicación agente real usada para la conversación. Generar suficiente
   contenido y confirmar que su modo fullscreen habilita mouse reporting.
   Sobre el texto, subir y bajar: debe cambiar el contenido que presenta la
   aplicación, sin desplazar ni ampliar el canvas.
3. Repetir con foco en la toolbar, después de deseleccionar el terminal y enfocar
   el fondo del canvas, y con el teclado dentro de una nota de otro panel.
   La rueda debe llegar al terminal bajo el puntero; foco y selección deben
   conservarse. Escribir en la nota solo debe modificar la nota.
4. En mapa, repetir la rueda sobre xterm con Ctrl, Cmd/Meta y Alt. La cámara no
   debe moverse ni ampliarse. Fuera del terminal, comprobar los controles
   habituales de navegación del canvas.
5. Usar **Enfocar panel** y repetir la conversación con foco en el terminal y en
   su toolbar. Volver al mapa debe recuperar la cámara previa.
6. En una aplicación fullscreen sin mouse reporting, la rueda no debe enviar
   flechas ni simular scroll de conversación, incluso con foco en xterm.
   Al reactivar mouse reporting, el scroll de aplicación debe volver a funcionar.

La ausencia de mouse reporting no permite concluir que el agente soporte scroll
por rueda. Su historial propio debe comprobarse con la aplicación real; no se
sustituye por teclas sintéticas ni por el scrollback del shell.

## Cobertura automatizada y estado de verificación

`test/terminal-scroll-smoke.mjs` conserva Electron, host y PTY reales. Ejecuta
Bash para el historial y una aplicación Python raw/fullscreen que habilita
buffer alternativo y SGR mouse reporting. La aplicación cambia la fila mostrada
al recibir reportes de rueda reales. La cobertura incluye toolbar, terminal
inactivo, foco canvas, foco de otra nota, modificadores y panel enfocado.
Registra bytes recibidos por el PTY fuera del repositorio para comprobar que
escribir en otra nota no los envía al terminal y que deshabilitar mouse reporting
no convierte la rueda en flechas. También comprueba la reactivación del modo.
Este fixture prueba el transporte de una conversación fullscreen; no acredita
una sesión observada con un agente externo concreto.

`src/hooks/terminal-scroll.test.mjs` cubre la separación entre ownership de
rueda y de teclado, incluyendo panel seleccionado sin foco, panel inactivo con
foco residual, bloqueo de interfaz y stream ausente/no escribible.

Checks declarados para el controlador:

```bash
node --test src/hooks/terminal-scroll.test.mjs src/hooks/input-rename.test.mjs
npm run build
node test/terminal-scroll-smoke.mjs
node test/canvas-controls.mjs
```

No se ejecutaron checks desde este motor sin shell. El controlador debe aportar
los resultados nativos antes/después y las capturas fuera del repositorio;
este documento describe código y procedimientos, no resultados aprobados.
