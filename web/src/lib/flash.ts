import { useEffect, useRef, type RefObject } from 'react'

export const FLASH_RING = 'rounded-md outline-2 outline-dashed outline-offset-2 outline-primary/70'

const FLASH_MS = 1800

export function useFlash<T extends HTMLElement>(on: boolean): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (on) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [on])
  return ref
}

export function useFlashClear(on: boolean, clear: () => void): void {
  // clear 多半是内联箭头，放进依赖数组会让计时器每次渲染都重来。
  const latest = useRef(clear)
  useEffect(() => {
    latest.current = clear
  })

  useEffect(() => {
    if (!on) return
    const timer = setTimeout(() => latest.current(), FLASH_MS)
    return () => clearTimeout(timer)
  }, [on])
}
