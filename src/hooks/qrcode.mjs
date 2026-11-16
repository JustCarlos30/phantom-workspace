const ECC = {
  L: [[7,1],[10,1],[15,1],[20,1],[26,1],[18,2],[20,2],[24,2],[30,2],[18,4]],
  M: [[10,1],[16,1],[26,1],[18,2],[24,2],[16,4],[18,4],[22,4],[22,5],[26,5]],
  Q: [[13,1],[22,1],[18,2],[26,2],[18,4],[24,4],[18,6],[22,6],[20,8],[24,8]],
  H: [[17,1],[28,1],[22,2],[16,4],[22,4],[28,4],[26,5],[26,6],[24,8],[28,8]],
};
const ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
const raw = v => { let n = (16 * v + 128) * v + 64; if (v >= 2) { const a = Math.floor(v / 7) + 2; n -= (25 * a - 10) * a - 55; if (v >= 7) n -= 36; } return Math.floor(n / 8); };
function mul(a, b) { let r = 0; for (; b; b >>>= 1) { if (b & 1) r ^= a; a <<= 1; if (a & 256) a ^= 0x11d; } return r; }
function parity(data, n) {
  let generator = [1], root = 1;
  for (let i = 0; i < n; i++, root = mul(root, 2)) { const next = Array(generator.length + 1).fill(0); generator.forEach((x, j) => { next[j] ^= x; next[j + 1] ^= mul(x, root); }); generator = next; }
  const result = Array(n).fill(0);
  for (const value of data) { const factor = value ^ result.shift(); result.push(0); for (let i = 0; i < n; i++) result[i] ^= mul(generator[i + 1], factor); }
  return result;
}
const masked = (m, x, y) => [() => (x+y)%2===0, () => y%2===0, () => x%3===0, () => (x+y)%3===0, () => (Math.floor(y/2)+Math.floor(x/3))%2===0, () => x*y%2+x*y%3===0, () => (x*y%2+x*y%3)%2===0, () => ((x+y)%2+x*y%3)%2===0][m]();
function penalty(a) {
  const n = a.length; let score = 0, dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { dark += a[y][x]; if (x && y && a[y][x] === a[y-1][x] && a[y][x] === a[y][x-1] && a[y][x] === a[y-1][x-1]) score += 3; }
  for (let axis = 0; axis < 2; axis++) for (let i = 0; i < n; i++) {
    const line = Array.from({length:n}, (_, j) => axis ? a[j][i] : a[i][j]); let run = 1;
    for (let j = 1; j <= n; j++) { if (j < n && line[j] === line[j-1]) run++; else { if (run >= 5) score += run - 2; run = 1; } }
    const text = line.map(Number).join(''); for (let j = 0; j <= n - 11; j++) if (['00001011101','10111010000'].includes(text.slice(j,j+11))) score += 40;
  }
  return score + Math.floor(Math.abs(dark * 20 - n*n*10) / (n*n)) * 10;
}
export function encodeQR(text, { ecc = 'M' } = {}) {
  if (!Object.hasOwn(ECC, ecc)) throw new Error('Nivel ECC no válido');
  const bytes = new TextEncoder().encode(text), utf8 = bytes.some(b => b >= 128); let version, capacity, ec, blocks;
  for (version = 1; version <= 10; version++) { [ec, blocks] = ECC[ecc][version-1]; capacity = raw(version) - ec * blocks; if ((utf8 ? 12 : 0) + 4 + (version < 10 ? 8 : 16) + bytes.length * 8 <= capacity * 8) break; }
  if (version > 10) throw new Error('El texto no cabe en un QR de versiones 1–10');
  const bits = [], put = (value, n) => { for (let i = n-1; i >= 0; i--) bits.push((value >>> i) & 1); };
  if (utf8) { put(7,4); put(26,8); }
  put(4,4); put(bytes.length, version < 10 ? 8 : 16); for (const b of bytes) put(b,8);
  put(0, Math.min(4, capacity*8-bits.length)); while (bits.length%8) bits.push(0);
  const data = []; for (let i=0;i<bits.length;i+=8) data.push(bits.slice(i,i+8).reduce((a,b)=>a*2+b,0));
  for (let p=0;data.length<capacity;p++) data.push(p%2 ? 0x11 : 0xec);
  const short = Math.floor(raw(version)/blocks)-ec, shortCount = blocks-raw(version)%blocks, chunks = [], checks = []; let offset = 0;
  for (let i=0;i<blocks;i++) { const length=short+(i>=shortCount?1:0), chunk=data.slice(offset,offset+length); offset+=length; chunks.push(chunk); checks.push(parity(chunk,ec)); }
  const words=[]; for(let i=0;i<=short;i++) for(const chunk of chunks) if(i<chunk.length) words.push(chunk[i]); for(let i=0;i<ec;i++) for(const chunk of checks) words.push(chunk[i]);
  const size=version*4+17, base=Array.from({length:size},()=>Array(size).fill(false)), reserved=base.map(row=>row.slice());
  const set=(x,y,b)=>{ base[y][x]=!!b; reserved[y][x]=true; };
  for(let i=0;i<size;i++) { set(6,i,i%2===0); set(i,6,i%2===0); }
  for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]]) for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++) { const x=cx+dx,y=cy+dy,d=Math.max(Math.abs(dx),Math.abs(dy)); if(x>=0&&y>=0&&x<size&&y<size) set(x,y,d!==2&&d!==4); }
  const positions=ALIGN[version-1]; for(let i=0;i<positions.length;i++) for(let j=0;j<positions.length;j++) { if((i===0&&j===0)||(i===0&&j===positions.length-1)||(j===0&&i===positions.length-1)) continue; for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) set(positions[i]+dx,positions[j]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1); }
  function format(mask, target=base) {
    const data=({L:1,M:0,Q:3,H:2}[ecc]<<3)|mask; let rem=data; for(let i=0;i<10;i++) rem=(rem<<1)^((rem>>>9)*0x537); const value=((data<<10)|rem)^0x5412;
    const bit=i=>!!((value>>>i)&1), write=(x,y,b)=>{ target[y][x]=b; reserved[y][x]=true; };
    for(let i=0;i<=5;i++) write(8,i,bit(i)); write(8,7,bit(6)); write(8,8,bit(7)); write(7,8,bit(8)); for(let i=9;i<15;i++) write(14-i,8,bit(i));
    for(let i=0;i<8;i++) write(size-1-i,8,bit(i)); for(let i=8;i<15;i++) write(8,size-15+i,bit(i)); write(8,size-8,true);
  }
  format(0);
  if(version>=7) { let rem=version; for(let i=0;i<12;i++) rem=(rem<<1)^((rem>>>11)*0x1f25); const value=(version<<12)|rem; for(let i=0;i<18;i++) { const a=size-11+i%3,b=Math.floor(i/3); set(a,b,(value>>>i)&1); set(b,a,(value>>>i)&1); } }
  let best, bestScore=Infinity;
  for(let mask=0;mask<8;mask++) { const a=base.map(row=>row.slice()); let index=0;
    for(let right=size-1;right>=1;right-=2) { if(right===6) right=5; for(let vertical=0;vertical<size;vertical++) { const y=((right+1)&2)===0?size-1-vertical:vertical; for(let j=0;j<2;j++) { const x=right-j; if(!reserved[y][x]) { a[y][x]=!!((words[index>>>3]>>>(7-(index&7)))&1)!==masked(mask,x,y); index++; } } } }
    format(mask,a); const score=penalty(a); if(score<bestScore) { bestScore=score; best=a; }
  }
  return {size,modules:best};
}
export function qrToSVGPath(qr, margin = 4) {
  return qr.modules.flatMap((row,y)=>row.flatMap((dark,x)=>dark?[`M${x+margin},${y+margin}h1v1h-1z`]:[])).join('');
}
