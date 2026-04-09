import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import * as React from 'react'

import { cn } from '@/lib/utils'

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-[400] max-w-[min(17rem,calc(100vw-1.25rem))] rounded-lg border px-3 py-2',
        'border-border/40 bg-card/95 text-[13px] font-normal leading-snug text-foreground/90 antialiased',
        'shadow-[0_4px_20px_-4px_hsl(220_16%_13%/0.1),0_0_0_1px_hsl(var(--border)/0.35)]',
        'backdrop-blur-md backdrop-saturate-150',
        'dark:border-border/30 dark:bg-card/90 dark:text-foreground/92',
        'dark:shadow-[0_8px_28px_-6px_rgba(0,0,0,0.5),0_0_0_1px_hsl(var(--border)/0.25)]',
        'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-1 data-[side=left]:slide-in-from-right-1 data-[side=right]:slide-in-from-left-1 data-[side=top]:slide-in-from-bottom-1',
        'motion-reduce:data-[state=delayed-open]:animate-none motion-reduce:data-[state=closed]:animate-none',
        className,
      )}
      {...props}
    >
      {children}
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
