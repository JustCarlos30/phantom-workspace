export function markdownTarget(value) {
  try {
    let filename;
    if (value.startsWith('/') && !value.startsWith('//')) filename = value;
    else {
      const url = new URL(value);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return { kind: 'web', url: url.href };
      if (url.protocol !== 'file:' || (url.hostname && url.hostname !== 'localhost') || url.search || url.hash) return null;
      filename = decodeURIComponent(url.pathname);
    }
    if (!filename.startsWith('/') || /[\u0000-\u001f\u007f]/.test(filename)) return null;
    return { kind: /\.(png|jpe?g|webp|gif)$/i.test(filename) ? 'image' : 'file', path: filename };
  } catch { return null; }
}
