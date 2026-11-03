import { useEffect, useRef, useState } from 'react'

/** 点外面就关。浮层里不要放渲染到 portal 的控件（如 Select），点它会被当成点外面。 */
export function usePopover<T extends HTMLElement>() {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return { open, setOpen, ref }
}
