export async function fitCapture(dataUrl, maxLength = 850000) {
  if (typeof dataUrl !== 'string') return null;
  if (dataUrl.startsWith('data:image/png') && dataUrl.length <= maxLength) return dataUrl;

  try {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) return null;

    let width = Math.min(image.naturalWidth, 1280);
    while (true) {
      const height = Math.max(1, Math.round(image.naturalHeight * width / image.naturalWidth));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      const png = canvas.toDataURL('image/png');
      if (png.length <= maxLength) return png;
      if (width <= 480) return null;
      width = Math.max(480, Math.floor(width * 0.8));
    }
  } catch {
    return null;
  }
}
