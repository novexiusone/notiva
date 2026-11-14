import { useEffect, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type InlineInputProps = {
  initialText: string;
  label: string;
  inputMode?: HTMLAttributes<HTMLInputElement>['inputMode'];
  /** Returns `false` to refuse the text; the input then stays open and is marked invalid. */
  onSubmit: (text: string) => boolean;
  onCancel: () => void;
};

/**
 * A text field that sits in place of a value: focused with its text selected,
 * Enter and leaving it submit, Escape cancels. It submits or cancels once.
 */
export function InlineInput({
  initialText,
  label,
  inputMode,
  onSubmit,
  onCancel,
}: InlineInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(initialText);
  const [invalid, setInvalid] = useState(false);
  const done = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (done.current) return;
    if (onSubmit(text)) done.current = true;
    else setInvalid(true);
  };

  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  return (
    <input
      ref={inputRef}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={inputMode}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      }}
      onBlur={submit}
      className={cn(
        'h-full w-full min-w-0 rounded-sm bg-transparent px-1 text-sm outline-none',
        'aria-invalid:ring-destructive/40 aria-invalid:ring-2',
      )}
    />
  );
}
