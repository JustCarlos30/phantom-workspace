import React, { useEffect, useState } from 'react';
import { PhantomFace } from './Glyphs.jsx';
import '../identity.css';

export function useSpriteMotion(ref, enabled = true) {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) { setMoving(false); return undefined; }
    const shell = element.closest('.app-shell');
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    let intersecting = false;
    const update = () => setMoving(intersecting && !media.matches && !document.hidden
      && !shell?.classList.contains('studio-concentration')
      && !element.closest('[inert]') && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
    const intersection = new IntersectionObserver(entries => { intersecting = entries[0].isIntersecting; update(); });
    intersection.observe(element);
    const mutations = new MutationObserver(update);
    // Only ancestors: observing the sprite itself would feed React's updates back.
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement)
      mutations.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'inert', 'hidden'] });
    document.addEventListener('visibilitychange', update);
    media.addEventListener('change', update);
    return () => { intersection.disconnect(); mutations.disconnect(); document.removeEventListener('visibilitychange', update); media.removeEventListener('change', update); };
  }, [ref, enabled]);
  return enabled && moving;
}

/** Decorative identity; the surrounding EmptyState always supplies the text. */
export default function TitiMascot() {
  return <PhantomFace className="titi-mascot" data-identity="hero" size={88} />;
}
