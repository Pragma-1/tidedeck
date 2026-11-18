"use client"

import { createContext, useContext } from "react"

/**
 * Content zoom of the block a component is rendered in (CSS `zoom`, 1 = 100 %).
 * Code that positions things in screen pixels inside a zoomed block (drag
 * offsets, portals) divides or multiplies by it.
 */
export const BlockZoomContext = createContext(1)
export const useBlockZoom = () => useContext(BlockZoomContext)
