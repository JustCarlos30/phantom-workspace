import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayPolicy } from './inputOwnership.js';

test('la desconexion bloquea ediciones pero permite navegar la camara', () => {
  assert.deepEqual(overlayPolicy({ disconnected: true }), {
    inputBlocked: true, navigationBlocked: false, browserObscured: true,
  });
  assert.deepEqual(overlayPolicy({ disconnected: false }), {
    inputBlocked: false, navigationBlocked: false, browserObscured: false,
  });
});

test('los overlays bloquean tambien la navegacion con o sin conexion', () => {
  for (const disconnected of [false, true]) {
    for (const overlay of ['palette', 'voice', 'tray', 'list', 'menu', 'tools', 'edit', 'sidebar', 'phantomDrawer', 'folder', 'closing']) {
      assert.deepEqual(overlayPolicy({ disconnected, [overlay]: true }), {
        inputBlocked: true, navigationBlocked: true, browserObscured: true,
      });
    }
  }
});

test('el inspector solo oculta el navegador', () => {
  assert.deepEqual(overlayPolicy({ inspector: true }), {
    inputBlocked: false, navigationBlocked: false, browserObscured: true,
  });
});
