import React, { useMemo } from 'react';
import { qrMatrix } from '../phone-pairing.mjs';

export default function PhoneQr({ text }) {
  const result = useMemo(() => {
    try { return qrMatrix(text); } catch (error) { return { error: error.message }; }
  }, [text]);
  if (result.error) return <p className="st-error" role="alert">{result.error}</p>;
  const { size, modules } = result;
  const path = modules.flatMap((row, y) => row.map((dark, x) => dark ? `M${x + 4} ${y + 4}h1v1h-1z` : '')).join('');
  return <div className="st-phone-qr"><svg width="240" height="240" viewBox={`0 0 ${size + 8} ${size + 8}`} role="img" aria-label="Código QR para vincular el teléfono" shapeRendering="crispEdges"><rect width={size + 8} height={size + 8} fill="white" /><path d={path} fill="black" /></svg></div>;
}
