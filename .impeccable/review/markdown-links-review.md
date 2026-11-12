# Capturas dentro del chat · 2026-11-11

**Resultado: SHIP para enlaces y vista previa local.** El enlace «Ver captura del lanzador actualizado» antes era un `span` sin acción. Ahora los enlaces a imágenes locales expanden una vista previa en el mensaje, con cierre, carga y errores; la sintaxis de imagen Markdown también se muestra.

- `npm run build`: correcto, con el aviso existente de tamaño de bundle.
- `node --test test/local-images.test.mjs test/desktop-security.test.mjs`: 12 pasan, 2 pruebas opcionales de Electron omitidas.
- `node test/markdown-links-desktop.mjs`: recorrido real de Electron y host aislado con respuesta de proveedor sintética. Carga de imagen integrada, enlace file con espacios codificados, activación por Enter, cierre/reapertura, enlace HTTP(S), archivos ausentes/dañados, bloqueo de esquema ejecutable y rechazo IPC fuera de raíces autorizadas.
- Cero excepciones del renderizador. Captura inspeccionada: `/tmp/opencode/phantom-markdown-vXV31w/preview.png`.
- Detector visual: solo avisos sobre radios/tamaños preexistentes en `chat.css`; los controles nuevos usan tokens del tema.
- `git diff --check`: correcto.

El puente nativo cambió: hay que reiniciar la aplicación para cargarlo. La vista previa usa data URLs obtenidas por IPC y mantiene la CSP vigente. Los archivos temporales deben seguir existiendo para poder abrirlos.
