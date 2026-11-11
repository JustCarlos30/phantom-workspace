import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createInlineName } from './inlineName';

export function useInlineName({ stage, flush, registerBeforeFlush }) {
  const [editing, setEditing] = useState(null);
  const controller = useRef(null), inputRef = useRef(null), current = useRef({}), sequence = useRef(0);
  const pendingFocus = useRef(null);
  current.current = { stage, flush };
  useEffect(() => registerBeforeFlush(() => controller.current?.prepare()), [registerBeforeFlush]);
  useLayoutEffect(() => {
    if (editing?.id !== undefined) {
      inputRef.current?.focus(); inputRef.current?.select();
    } else if (pendingFocus.current) {
      // React may defer the input→button commit beyond a scheduled animation
      // frame. Restore focus only after the replacement button's ref is set.
      const origin = pendingFocus.current;
      pendingFocus.current = null;
      origin()?.focus({ preventScroll: true });
    }
  }, [editing?.revision]);
  return {
    editing, inputRef,
    start(id, value, origin) {
      controller.current?.cancel(false);
      pendingFocus.current = null;
      const revision = ++sequence.current;
      const instance = createInlineName({ value,
        stage: name => current.current.stage(id, name), flush: () => current.current.flush(),
        update: next => setEditing({ id, revision, ...next }),
        end: returnFocus => {
          if (controller.current !== instance) return;
          controller.current = null;
          pendingFocus.current = returnFocus ? origin : null;
          setEditing(null);
        },
      });
      controller.current = instance; setEditing({ id, revision, value, error: '', saving: false });
    },
    change: value => controller.current?.change(value),
    commit: returnFocus => controller.current?.commit(returnFocus),
    cancel: () => controller.current?.cancel(),
  };
}
