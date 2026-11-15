import { useEffect } from 'react';

export function useUndoFocusGuard() {
  useEffect(() => {
    const guard = (event: InputEvent) => {
      if (
        (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') &&
        event.target !== document.activeElement
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    document.addEventListener('beforeinput', guard, true);
    return () => document.removeEventListener('beforeinput', guard, true);
  }, []);
}
