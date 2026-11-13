// Spike #52, throwaway: an interactive block without inline content.
import { createReactBlockSpec } from '@blocknote/react';
import { move } from '@dnd-kit/helpers';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function SortableItem({ id, index }: { id: string; index: number }) {
  const { ref, isDragging } = useSortable({ id, index });

  return (
    <li
      ref={ref}
      data-testid={`spike-item-${id}`}
      data-dragging={isDragging || undefined}
      className="bg-muted cursor-grab rounded-md border px-2 py-1 text-sm select-none"
    >
      {id}
    </li>
  );
}

/** Which undo workaround is on; the tests switch it through localStorage. */
const undoMode = () => window.localStorage.getItem('spike.undo');

/**
 * Workaround "guard": WebKit keeps one undo stack for the whole page. When the
 * focused field has nothing left to undo, the browser sends `historyUndo` to
 * the field edited before it, which can be the editor, and prosemirror-history
 * then undoes a document edit. This drops an undo aimed at another element
 * than the focused field.
 */
function useUndoGuard() {
  useEffect(() => {
    const guard = (event: InputEvent) => {
      if (undoMode() !== 'guard') return;
      if (event.inputType !== 'historyUndo' && event.inputType !== 'historyRedo') return;
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && event.target !== active) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener('beforeinput', guard, true);
    return () => document.removeEventListener('beforeinput', guard, true);
  }, []);
}

/**
 * Workaround "through": a block with `selectable: false` swallows the drop of
 * a block dragged onto it. While a native drag is under way the node view
 * takes no pointer events, so the drop lands on the block container around
 * it, which the editor handles.
 */
function useDropThrough(root: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const nodeView = () =>
      root.current?.closest<HTMLElement>('.bn-react-node-view-renderer') ?? null;
    const start = () => {
      if (window.localStorage.getItem('spike.drop') !== 'through') return;
      // Not in the same task: the browser would cancel a drag whose source changes under it.
      setTimeout(() => nodeView()?.style.setProperty('pointer-events', 'none'), 0);
    };
    const end = () => nodeView()?.style.removeProperty('pointer-events');
    document.addEventListener('dragstart', start, true);
    document.addEventListener('dragend', end, true);
    document.addEventListener('drop', end, false);
    return () => {
      document.removeEventListener('dragstart', start, true);
      document.removeEventListener('dragend', end, true);
      document.removeEventListener('drop', end, false);
    };
  }, [root]);
}

const interactive = 'input, textarea, select, button, a';

function SpikeBlock({ refId }: { refId: string }) {
  const root = useRef<HTMLDivElement>(null);
  useDropThrough(root);
  const [text, setText] = useState('');
  // Workaround "own": the field keeps its own history and the browser's undo never runs.
  const history = useRef<string[]>([]);
  useUndoGuard();
  const [popoverText, setPopoverText] = useState('');
  const [items, setItems] = useState(['One', 'Two', 'Three']);

  return (
    <div
      ref={root}
      data-testid="spike-block"
      data-ref-id={refId}
      // Workaround "clear": with `selectable: false` BlockNote blurs the editor on a mouse
      // down in the block, but WebKit keeps the text cursor where the click put it, and the
      // next key still edits the document. Dropping the selection ends that.
      onMouseDown={(event) => {
        if (window.localStorage.getItem('spike.chrome') !== 'clear') return;
        const control = (event.target as Element).closest(interactive);
        if (control !== null && event.currentTarget.contains(control)) return;
        event.preventDefault();
        // Blur first: a focused editor would put its selection back.
        root.current?.closest<HTMLElement>('.bn-editor')?.blur();
        window.getSelection()?.removeAllRanges();
        // Focus goes to the block, not to the body, where WebKit takes Backspace as "back".
        event.currentTarget.tabIndex = -1;
        event.currentTarget.focus();
      }}
      onKeyDown={(event) => {
        if (window.localStorage.getItem('spike.chrome') !== 'clear') return;
        if (event.target === event.currentTarget && ['Backspace', 'Delete'].includes(event.key)) {
          event.preventDefault();
        }
      }}
      className="bg-card flex w-full flex-col gap-2 rounded-lg border p-3 outline-none"
    >
      <div className="text-muted-foreground text-xs">
        Spike block <span data-testid="spike-ref">{refId}</span>
      </div>
      <div className="flex gap-2">
        <Input
          data-testid="spike-input"
          aria-label="Spike input"
          value={text}
          onChange={(event) => {
            history.current.push(text);
            setText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (undoMode() !== 'own') return;
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
              event.preventDefault();
              const previous = history.current.pop();
              if (previous !== undefined) setText(previous);
            }
          }}
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" data-testid="spike-popover-button">
              Options
            </Button>
          </PopoverTrigger>
          <PopoverContent data-testid="spike-popover">
            <Input
              data-testid="spike-popover-input"
              aria-label="Spike popover input"
              value={popoverText}
              onChange={(event) => setPopoverText(event.target.value)}
            />
          </PopoverContent>
        </Popover>
      </div>
      <DragDropProvider onDragEnd={(event) => setItems((current) => move(current, event))}>
        <ul data-testid="spike-list" className="flex flex-col gap-1">
          {items.map((id, index) => (
            <SortableItem key={id} id={id} index={index} />
          ))}
        </ul>
      </DragDropProvider>
    </div>
  );
}

/** The block as the spec proposes it: the editor ignores every event inside. */
export const spikeBlock = createReactBlockSpec(
  { type: 'spike', propSchema: { refId: { default: '' } }, content: 'none' },
  {
    meta: { selectable: false },
    render: ({ block }) => <SpikeBlock refId={block.props.refId} />,
  },
);

/** The same block with `meta.selectable` left at its default, to see what the flag changes. */
export const spikeSelectableBlock = createReactBlockSpec(
  { type: 'spikeSelectable', propSchema: { refId: { default: '' } }, content: 'none' },
  {
    render: ({ block }) => <SpikeBlock refId={block.props.refId} />,
  },
);
