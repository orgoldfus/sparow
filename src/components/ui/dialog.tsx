import { X } from 'lucide-react';
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Button } from './button';

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function Dialog({
  children,
  onOpenChange,
  open,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <DialogContext.Provider value={{ open, onOpenChange }}>
      {children}
    </DialogContext.Provider>
  );
}

export function DialogTrigger({
  children,
  onClick,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const context = useDialogContext();

  return (
    <button
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          context.onOpenChange(true);
        }
      }}
      type={type}
    >
      {children}
    </button>
  );
}

export function DialogPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(children, document.body);
}

export const DialogOverlay = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function DialogOverlay({ className, onClick, ...props }, ref) {
    const context = useDialogContext();

    if (!context.open) {
      return null;
    }

    return (
      <div
        {...props}
        className={cn('fixed inset-0 z-50 bg-[color-mix(in_oklch,_black_72%,_transparent)] backdrop-blur-[2px]', className)}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            context.onOpenChange(false);
          }
        }}
        ref={ref}
      />
    );
  },
);

export const DialogClose = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function DialogClose({ children, onClick, type = 'button', ...props }, ref) {
    const context = useDialogContext();

    return (
      <button
        {...props}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) {
            context.onOpenChange(false);
          }
        }}
        ref={ref}
        type={type}
      >
        {children}
      </button>
    );
  },
);

export const DialogContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { showClose?: boolean }
>(function DialogContent({ children, className, onClick, showClose = true, ...props }, ref) {
  const context = useDialogContext();
  const { onOpenChange, open } = context;
  const contentRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;

      if (typeof ref === 'function') {
        ref(node);
        return;
      }

      if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const ownerDocument = contentRef.current?.ownerDocument ?? document;
    const previousActiveElement =
      ownerDocument.activeElement instanceof HTMLElement ? ownerDocument.activeElement : null;

    const frameId = ownerDocument.defaultView?.requestAnimationFrame(() => {
      contentRef.current?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
      }
    }

    ownerDocument.addEventListener('keydown', handleKeyDown);

    return () => {
      ownerDocument.removeEventListener('keydown', handleKeyDown);
      if (frameId != null) {
        ownerDocument.defaultView?.cancelAnimationFrame(frameId);
      }
      previousActiveElement?.focus();
    };
  }, [onOpenChange, open]);

  if (!open) {
    return null;
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <div
        {...props}
        aria-modal="true"
        className={cn(
          'fixed left-1/2 top-1/2 z-50 grid w-[min(960px,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-elevated)] shadow-[var(--shadow-modal)] outline-none',
          className,
        )}
        onClick={(event) => {
          event.stopPropagation();
          onClick?.(event);
        }}
        ref={setRefs}
        role="dialog"
        tabIndex={-1}
      >
        {children}
        {showClose ? (
          <Button
            aria-label="Close"
            className="absolute right-3 top-3"
            onClick={() => {
              onOpenChange(false);
            }}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
    </DialogPortal>
  );
});

export function DialogHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid gap-1 px-6 pt-6', className)}>{children}</div>;
}

export function DialogFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-wrap items-center justify-end gap-2 px-6 pb-6', className)}>{children}</div>;
}

export const DialogTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  function DialogTitle({ className, ...props }, ref) {
    return <h2 className={cn('text-xl font-semibold text-[var(--text-primary)]', className)} ref={ref} {...props} />;
  },
);

export const DialogDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  function DialogDescription({ className, ...props }, ref) {
    return <p className={cn('text-sm text-[var(--text-secondary)]', className)} ref={ref} {...props} />;
  },
);

function useDialogContext() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('Dialog components must be rendered within <Dialog>.');
  }
  return context;
}
