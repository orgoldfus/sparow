import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-app)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[var(--accent-solid)] text-[var(--accent-foreground)] shadow-[var(--shadow-elevated)] hover:bg-[var(--accent-solid-hover)]',
        secondary:
          'bg-[var(--surface-panel)] text-[var(--text-primary)] hover:bg-[var(--surface-panel-hover)]',
        outline:
          'border border-[var(--border-strong)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--border-accent)] hover:text-[var(--text-primary)]',
        ghost:
          'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-panel)] hover:text-[var(--text-primary)]',
        danger:
          'bg-[var(--danger-surface)] text-[var(--danger-text)] hover:bg-[var(--danger-surface-hover)]',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-lg px-5',
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

export function Button({ asChild = false, className, size, variant, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';

  return <Comp className={cn(buttonVariants({ className, size, variant }))} {...props} />;
}
