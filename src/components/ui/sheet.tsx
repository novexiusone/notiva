import * as React from 'react';
import { cn } from 'cn';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

/** A panel that slides in from the right edge. */
function SheetContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & { closeLabel: string }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 z-50 bg-black/10 duration-150"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-popover text-popover-foreground data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right fixed inset-y-0 right-0 z-50 flex w-80 max-w-full flex-col gap-4 border-l p-5 shadow-lg outline-hidden duration-200',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          aria-label={closeLabel}
          className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 absolute top-3 right-3 flex size-7 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
        >
          <XIcon size={16} aria-hidden />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title className={cn('text-base font-medium', className)} {...props} />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export { Sheet, SheetContent, SheetDescription, SheetTitle };
