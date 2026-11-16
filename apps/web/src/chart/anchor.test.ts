import { describe, expect, it } from 'vitest'
import { indexToTime, inferInterval, inRange, timeToIndex } from './anchor'

const H = 3_600_000
const times = [0, 1, 2, 3, 4].map((i) => 1000 * H + i * H)

describe('anchor', () => {
  it('infers the bar interval', () => {
    expect(inferInterval(times)).toBe(H)
    expect(inferInterval([5])).toBe(60_000)
    expect(inferInterval([])).toBe(60_000)
  })
  it('maps times inside the range to the containing bar', () => {
    expect(timeToIndex(times, times[2], H)).toBe(2)
    expect(timeToIndex(times, times[2] + H / 2, H)).toBe(2) // a 30m point on a 1h chart
    expect(inRange(times, times[0])).toBe(true)
    expect(inRange(times, times[4] + 1)).toBe(false)
  })
  it('extrapolates to the right of the last candle and to the left of the first', () => {
    expect(timeToIndex(times, times[4] + 10 * H, H)).toBe(14)
    expect(timeToIndex(times, times[0] - 3 * H, H)).toBe(-3)
    expect(indexToTime(times, 14, H)).toBe(times[4] + 10 * H)
    expect(indexToTime(times, -3, H)).toBe(times[0] - 3 * H)
    expect(indexToTime(times, 2, H)).toBe(times[2])
  })
  it('round-trips a future point when new candles arrive', () => {
    const future = times[4] + 6 * H
    const more = [...times, times[4] + H, times[4] + 2 * H]
    expect(indexToTime(more, timeToIndex(more, future, H), H)).toBe(future)
    expect(timeToIndex(more, future, H)).toBe(10)
  })
  it('handles no data', () => {
    expect(timeToIndex([], 5, H)).toBe(0)
    expect(indexToTime([], 5, H)).toBe(0)
  })
})
