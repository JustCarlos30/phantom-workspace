import React, { useRef } from 'react';
import AsciiField from '../components/AsciiField';
import PixelField from '../components/PixelField';

export default { title: 'Fondos' };
export const Ascii = { args: { paused: false }, render: args => <div className="catalog-background"><AsciiField {...args} /><p>Campo ASCII de producción</p></div> };
export const Pixeles = { render: () => { const cameraRef = useRef({ x: 0, y: 0, zoom: 1 }), paintRef = useRef(null); return <div className="catalog-background"><PixelField cameraRef={cameraRef} paintRef={paintRef} targets={[{ id: 'pixel-demo', x: 150, y: 150, width: 300, height: 200, kind: 'work' }]} /><p>Pulso de trabajo sintético</p></div>; } };
