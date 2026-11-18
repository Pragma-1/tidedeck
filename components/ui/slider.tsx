"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "radix-ui"
import { cn } from "@/lib/utils"

// The label goes on the thumb: that's the element with role="slider".
function Slider({ className, "aria-label": label, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-muted">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb aria-label={label} className="block size-4 rounded-full border border-primary bg-background shadow-sm outline-none focus-visible:ring-4 focus-visible:ring-ring/40" />
    </SliderPrimitive.Root>
  )
}

export { Slider }
