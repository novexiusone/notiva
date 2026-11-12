import { useCallback, useEffect, useRef, useState } from 'react';

type State<T> = {
  /** Reads the value to save. Set while there is something unsaved. */
  pending: (() => T) | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Saves run one after another, so an older one can never overwrite a newer one. */
  queue: Promise<void>;
};

/**
 * Saves a value a moment after it last changed, and right away when the
 * window loses focus, the page is hidden or the component goes away.
 *
 * A failed save keeps the change pending: it goes out again with the next
 * change or the next flush.
 */
export function useAutosave<T>(save: (value: T) => Promise<void>, delay = 500) {
  const [failed, setFailed] = useState(false);
  const state = useRef<State<T>>({ pending: null, timer: undefined, queue: Promise.resolve() });
  const latestSave = useRef(save);

  useEffect(() => {
    latestSave.current = save;
  }, [save]);

  const flush = useCallback(() => {
    const current = state.current;
    clearTimeout(current.timer);

    const read = current.pending;
    if (read === null) return current.queue;
    current.pending = null;

    const value = read();
    current.queue = current.queue
      .then(() => latestSave.current(value))
      .then(
        () => setFailed(false),
        () => {
          current.pending ??= read;
          setFailed(true);
        },
      );
    return current.queue;
  }, []);

  const schedule = useCallback(
    (read: () => T) => {
      const current = state.current;
      current.pending = read;
      clearTimeout(current.timer);
      current.timer = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  useEffect(() => {
    const flushNow = () => void flush();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };

    window.addEventListener('blur', flushNow);
    window.addEventListener('beforeunload', flushNow);
    document.addEventListener('visibilitychange', flushWhenHidden);
    return () => {
      window.removeEventListener('blur', flushNow);
      window.removeEventListener('beforeunload', flushNow);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      flushNow();
    };
  }, [flush]);

  return { schedule, flush, failed };
}
