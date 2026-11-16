import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  onClose(): void
  className?: string
  children: ReactNode
}

/** Small anchored panel that closes on outside click or Escape. Position it with CSS inside a relative parent. */
export function Popover({ onClose, className, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className={`popover ${className ?? ''}`}>
      {children}
    </div>
  )
}
