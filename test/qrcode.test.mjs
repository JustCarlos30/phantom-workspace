import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { encodeQR, qrToSVGPath } from '../src/hooks/qrcode.mjs';

test('byte capacity chooses minimal versions including 1, 5 and 10', () => {
  assert.equal(encodeQR('a').size, 21);
  assert.equal(encodeQR('a'.repeat(14)).size, 21);
  assert.equal(encodeQR('a'.repeat(15)).size, 25);
  assert.equal(encodeQR('a'.repeat(70)).size, 37);
  assert.equal(encodeQR('a'.repeat(200)).size, 57);
});
test('finder patterns occupy three corners with separators', () => {
  const qr = encodeQR('Phantom');
  for (const [left, top] of [[0,0],[qr.size-7,0],[0,qr.size-7]]) for (let y=0;y<7;y++) for (let x=0;x<7;x++) assert.equal(qr.modules[top+y][left+x], x===0||y===0||x===6||y===6||(x>=2&&x<=4&&y>=2&&y<=4));
  assert.equal(qr.modules[7][0], false); assert.equal(qr.modules[0][7], false);
});
test('oversize and unknown correction levels fail clearly', () => {
  assert.throws(() => encodeQR('x'.repeat(1000)), /no cabe/);
  assert.throws(() => encodeQR('x', {ecc:'invalid'}), /ECC/);
});
test('encoding is deterministic and produces boolean square matrices', () => {
  for (const ecc of ['L','M','Q','H']) {
    const qr = encodeQR('Determinismo', {ecc}); assert.deepEqual(qr, encodeQR('Determinismo', {ecc}));
    assert.equal(qr.modules.length, qr.size); for (const row of qr.modules) { assert.equal(row.length, qr.size); assert.ok(row.every(x=>typeof x==='boolean')); }
  }
});
test('SVG path gives each dark module a unit rectangle with quiet margin', () => {
  const qr = encodeQR('SVG'), d = qrToSVGPath(qr);
  assert.equal((d.match(/M/g)||[]).length, qr.modules.flat().filter(Boolean).length);
  assert.ok(d.startsWith('M4,4h1v1h-1z')); assert.ok(qrToSVGPath(qr,0).startsWith('M0,0h1v1h-1z'));
});
test('zbarimg really decodes UTF-8, pairing links and large versions at all ECC levels', t => {
  try { execFileSync('zbarimg', ['--version'], {stdio:'pipe'}); } catch (cause) { assert.fail(`Se requiere zbarimg instalado para decodificar los QR: ${cause.message}`); }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'phantom-qr-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const texts=['Phantom Workspace', 'https://192.168.100.200:54321/mobile#pair='+'Ab_c-0123456789'.repeat(4).slice(0,43), 'España · cámara · vinculación rápida', 'https://phantom.local/mobile#pair='+'a'.repeat(80)];
  for (const ecc of ['L','M','Q','H']) for (let i=0;i<texts.length;i++) {
    const text=texts[i], qr=encodeQR(text,{ecc}), width=(qr.size+8)*8, pixels=Buffer.alloc(width*width,255);
    for(let y=0;y<width;y++) for(let x=0;x<width;x++) if(qr.modules[Math.floor(y/8)-4]?.[Math.floor(x/8)-4]) pixels[y*width+x]=0;
    const file=path.join(dir,`${ecc}-${i}.pgm`); fs.writeFileSync(file,Buffer.concat([Buffer.from(`P5\n${width} ${width}\n255\n`),pixels]));
    const decoded=execFileSync('zbarimg',['--raw','-q',file],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.equal(decoded.replace(/\r?\n$/, ''),text,`${ecc}, text ${i}, size ${qr.size}`);
    if(i===3&&ecc==='M') assert.ok(qr.size>=45);
  }
});
