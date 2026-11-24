import { useLayoutEffect } from 'react';

// Layout pixels keep canvas transforms out of the writing budget.
export function sizeComposer(input) {
  const composer = input?.closest('.pc-composer'), root = composer?.closest('.pc');
  if (!root || !root.clientHeight || !input.clientWidth) return;
  const minimum = parseFloat(getComputedStyle(input).minHeight) || 38;
  const chrome = composer.offsetHeight - input.offsetHeight;
  const occupied = [...root.children].filter(el => el !== composer && !el.matches('.pc-thread, .pc-live')).reduce((sum, el) => {
    const css = getComputedStyle(el);
    return sum + el.offsetHeight + (parseFloat(css.marginTop) || 0) + (parseFloat(css.marginBottom) || 0);
  }, 0);
  const reserve = Math.min(96, root.clientHeight * .2);
  const maximum = Math.max(minimum, Math.floor(Math.min(root.clientHeight * .45, root.clientHeight - occupied - chrome - reserve)));
  const scroll = input.scrollTop;
  input.style.overflowY = 'hidden';
  input.style.height = '0px';
  input.style.height = `${Math.min(maximum, Math.max(minimum, input.scrollHeight))}px`;
  input.style.overflowY = input.scrollHeight > input.clientHeight ? 'auto' : 'hidden';
  input.scrollTop = scroll;
}

export function useComposerSize(input, value, active = true) {
  useLayoutEffect(() => { if (active) sizeComposer(input.current); }, [input, value, active]);
  useLayoutEffect(() => {
    const el = input.current, composer = el?.closest('.pc-composer'), root = composer?.closest('.pc');
    if (!active || !root) return;
    let frame;
    const resize = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => sizeComposer(el)); };
    const observer = new ResizeObserver(resize);
    observer.observe(root);
    const observed = new Set();
    const observeChrome = () => {
      const elements = [...root.children].filter(child => child !== composer && !child.matches('.pc-thread, .pc-live'));
      elements.push(...composer.querySelectorAll('.pc-controls, .pc-status-line, .pc-continuation, .pc-queue, .phantom-chat-voice'));
      for (const child of observed) if (!elements.includes(child)) { observer.unobserve(child); observed.delete(child); }
      for (const child of elements) if (!observed.has(child)) { observer.observe(child); observed.add(child); }
    };
    observeChrome();
    const mutation = new MutationObserver(() => { observeChrome(); resize(); });
    mutation.observe(root, { childList: true });
    mutation.observe(composer, { childList: true, subtree: true, characterData: true });
    sizeComposer(el);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutation.disconnect(); };
  }, [input, active]);
}
