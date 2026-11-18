"use client"

import { useEffect, useState } from "react"
import { create } from "zustand"
import { applyDisplay, currentScale, readDeviceDisplay, watchScreen, writeDeviceDisplay, type Display } from "@/lib/display"

/** The size kept in this browser only; null = use the shared setting. */
export const useDeviceDisplay = create<{ device: Display | null; loaded: boolean; setDevice: (d: Display | null) => void }>()((set) => ({
  device: null,
  loaded: false,
  setDevice: (device) => {
    writeDeviceDisplay(device)
    set({ device })
  },
}))

/** Keeps the page's size in step with the shared setting or this device's override. */
export function useApplyDisplay(shared: Display) {
  const device = useDeviceDisplay((s) => s.device)
  const loaded = useDeviceDisplay((s) => s.loaded)
  useEffect(() => {
    if (!loaded) useDeviceDisplay.setState({ device: readDeviceDisplay(), loaded: true })
  }, [loaded])
  useEffect(() => watchScreen(), [])
  const d = loaded ? (device ?? shared) : null
  const key = d && JSON.stringify(d)
  useEffect(() => {
    if (d) applyDisplay(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}

/** The current scale factor (1 = 16 px root), updated on window resize and size changes. */
export function useScale(): number {
  // Read at once (only rendered in the browser: the editor and the settings dialog), so the
  // first render already uses the real size instead of 100 %.
  const [scale, setScale] = useState(() => (typeof window === "undefined" ? 1 : currentScale()))
  useEffect(() => {
    const update = () => setScale(currentScale())
    update()
    window.addEventListener("resize", update)
    window.addEventListener("td-display", update)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("td-display", update)
    }
  }, [])
  return scale
}
