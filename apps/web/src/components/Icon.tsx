/** Tiny stroke icons (16×16). */
const PATHS = {
  cursor: 'M3 2l9 5-4 1.5L6.5 13z',
  lines: 'M2.5 13.5l11-11M2 13.5a1 1 0 102 0 1 1 0 10-2 0M12 2.5a1 1 0 102 0 1 1 0 10-2 0',
  channels: 'M2 11l9-9M5 14l9-9',
  fib: 'M2 3h12M2 6.5h12M2 10h12M2 13h12',
  forecast: 'M2 13V3M2 8h12M5 8V4h6v4M5 8v4h6V8',
  annotate: 'M3 4V3h10v1M8 3v10M6 13h4',
  magnet: 'M4 2v6a4 4 0 008 0V2M4 5h2.5M9.5 5H12',
  lock: 'M4 7h8v7H4zM5.5 7V5a2.5 2.5 0 015 0v2',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6',
  eyeOff: 'M2 2l12 12M6 3.9A6 6 0 018 3.5c4 0 6.5 4.5 6.5 4.5a11 11 0 01-2 2.5M9.9 11.9A6 6 0 018 12.5C4 12.5 1.5 8 1.5 8a11 11 0 012.6-2.9',
  undo: 'M3 6h6.5a3.5 3.5 0 010 7H6M3 6l3-3M3 6l3 3',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.5 9h6l.5-9M6.8 7v4M9.2 7v4',
  bell: 'M4 11V7.5a4 4 0 018 0V11l1 1.5H3zM6.5 14h3',
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
