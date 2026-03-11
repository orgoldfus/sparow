import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function ScrollArea({
  children,
  className,
  viewportClassName,
}: {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
}) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative overflow-hidden', className)}>
      <ScrollAreaPrimitive.Viewport className={cn('h-full w-full rounded-[inherit]', viewportClassName)}>
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner className="bg-transparent" />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({ className, orientation = 'vertical', ...props }: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      className={cn(
        'flex touch-none select-none p-0.5 transition-colors',
        orientation === 'vertical' ? 'h-full w-2.5 border-l border-l-transparent' : 'h-2.5 flex-col border-t border-t-transparent',
        className,
      )}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-[var(--border-strong)]" />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
