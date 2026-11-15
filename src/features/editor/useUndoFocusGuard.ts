import { useEffect } from 'react';

export function useUndoFocusGuard() {
  useEffect(() => {
    const guard = (event: InputEvent) => {
      const focused = document.activeElement;
      if (
        (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') &&
        !(event.target instanceof Node && focused?.contains(event.target))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    document.addEventListener('beforeinput', guard, true);
    return () => document.removeEventListener('beforeinput', guard, true);
  }, []);
}
