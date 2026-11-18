import { describe, expect, it } from 'vitest'
import { migrateShape, sanitizeShapes } from './drawings'

const pt = (timestamp: number, value: number) => ({ timestamp, value })

describe('drawings', () => {
  it('migrates old [entry, stop, take] positions to [entry, take, stop]', () => {
    const old = { id: 'a', name: 'shortPosition', points: [pt(1, 100), pt(5, 104), pt(9, 90)] }
    expect(migrateShape(old)).toEqual({
      id: 'a', name: 'shortPosition', points: [pt(1, 100), pt(9, 90), pt(1, 104)], extendData: { v: 2 },
    })
    const current = { id: 'b', name: 'longPosition', points: [pt(1, 100), pt(9, 110), pt(1, 95)], extendData: { v: 2 } }
    expect(migrateShape(current)).toBe(current)
    const line = { id: 'c', name: 'segment', points: [pt(1, 1), pt(2, 2)] }
    expect(migrateShape(line)).toBe(line)
  })
  it('drops malformed shapes', () => {
    expect(sanitizeShapes([{ id: 'x', name: 'segment', points: [{ timestamp: 'a', value: 1 }] }, null, 5])).toEqual([])
    expect(sanitizeShapes('nope')).toEqual([])
  })
})
