import React, { useEffect, useRef, useState } from 'react';
import gengarIcon from '../../assets/gengar-icon.png';
import gengarIdle from '../../assets/gengar-idle.gif';
import '../identity.css';

// GIFs cannot be paused with CSS. Remove their source whenever motion is
// suspended, including when an ancestor hides the sprite or the rail is inert.
export function useSpriteMotion(ref) {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
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
  }, [ref]);
  return moving;
}

/** Decorative identity; the surrounding EmptyState always supplies the text. */
export default function GengarMascot() {
  const ref = useRef(null);
  const moving = useSpriteMotion(ref);
  return <span ref={ref} className="gengar-mascot" data-motion={moving ? 'running' : 'stopped'} aria-hidden="true">
    <img className={moving ? 'gengar-idle' : 'gengar-static'} src={moving ? gengarIdle : gengarIcon} width={moving ? 148 : 80} height={moving ? 126 : 60} alt="" draggable="false" />
  </span>;
}
