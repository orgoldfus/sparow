import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-app)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent-solid)] text-[var(--accent-foreground)] shadow-[var(--shadow-elevated)] hover:bg-[var(--accent-solid-hover)]',
        secondary:
          'border border-[var(--border-subtle)] bg-[color-mix(in_oklch,_var(--surface-elevated)_90%,_black_10%)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-panel-hover)]',
        outline:
          'border border-[var(--border-strong)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--border-accent)] hover:text-[var(--text-primary)]',
        ghost:
          'bg-transparent text-[var(--text-secondary)] hover:bg-[color-mix(in_oklch,_var(--surface-panel)_92%,_white_8%)] hover:text-[var(--text-primary)]',
        danger:
          'bg-[var(--danger-surface)] text-[var(--danger-text)] hover:bg-[var(--danger-surface-hover)]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-xl px-3 text-xs',
        lg: 'h-11 rounded-2xl px-5',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { asChild = false, className, size, variant, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';

  return <Comp className={cn(buttonVariants({ className, size, variant }))} ref={ref} {...props} />;
});
