import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
  {
    variants: {
      variant: {
        default: 'bg-[var(--surface-highlight)] text-[var(--text-secondary)]',
        accent: 'bg-[var(--accent-muted)] text-[var(--accent-text)]',
        success: 'bg-[var(--success-surface)] text-[var(--success-text)]',
        warning: 'bg-[var(--warning-surface)] text-[var(--warning-text)]',
        danger: 'bg-[var(--danger-surface)] text-[var(--danger-text)]',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ className, variant }))} {...props} />;
}
