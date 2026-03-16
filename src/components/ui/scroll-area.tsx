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
    <div className={cn('min-h-0 overflow-auto', className)}>
      <div className={cn('min-h-full', viewportClassName)}>{children}</div>
    </div>
  );
}
