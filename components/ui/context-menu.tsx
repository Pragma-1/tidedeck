"use client"

import * as React from "react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const ContextMenu = (props: React.ComponentProps<typeof ContextMenuPrimitive.Root>) => <ContextMenuPrimitive.Root {...props} />
const ContextMenuTrigger = (props: React.ComponentProps<typeof ContextMenuPrimitive.Trigger>) => <ContextMenuPrimitive.Trigger {...props} />

function ContextMenuContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[11rem] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Item>) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  )
}

const ContextMenuLabel = ({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Label>) => (
  <ContextMenuPrimitive.Label className={cn("max-w-[16rem] truncate px-2 py-1.5 text-xs font-medium text-muted-foreground", className)} {...props} />
)
const ContextMenuSeparator = ({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) => (
  <ContextMenuPrimitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
)

const ContextMenuSub = (props: React.ComponentProps<typeof ContextMenuPrimitive.Sub>) => <ContextMenuPrimitive.Sub {...props} />

function ContextMenuSubTrigger({ className, children, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger>) {
  return (
    <ContextMenuPrimitive.SubTrigger
      className={cn(
        "flex cursor-default items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none select-none focus:bg-accent data-[state=open]:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg:not([class*='text-'])]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </ContextMenuPrimitive.SubTrigger>
  )
}

function ContextMenuSubContent({ className, ...props }: React.ComponentProps<typeof ContextMenuPrimitive.SubContent>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.SubContent
        className={cn(
          "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[11rem] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
}
