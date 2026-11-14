import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

function ScrollArea({
  className,
  children,
  viewportRef,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root> & { viewportRef?: React.Ref<HTMLDivElement> }) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type="auto"
      className={cn("relative flex flex-col overflow-hidden", className)}
      {...props}
    >
      {/* Sized by flex rather than height: 100%, so a max-height on the root is enough to make it scroll. */}
      <ScrollAreaPrimitive.Viewport
        ref={viewportRef}
        data-slot="scroll-area-viewport"
        className={cn(
          "min-h-0 w-full flex-1 rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          // Radix wraps the content in a table-display div, which stops truncated text from shrinking.
          "[&>div]:block!",
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        // Above sticky headers inside the viewport.
        "z-20 flex touch-none p-px transition-colors select-none",
        orientation === "vertical" && "h-full w-2.5 border-l border-l-transparent",
        orientation === "horizontal" && "h-2.5 flex-col border-t border-t-transparent",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollBar };
