import type { Chart } from 'klinecharts'

type StyleInput = Exclude<Parameters<Chart['setStyles']>[0], string>

export const COLORS = {
  bg: '#0d1014',
  grid: '#191e26',
  axis: '#252b35',
  text: '#7c8695',
  crosshair: '#5a6473',
  crosshairLabel: '#2a313c',
  up: '#2ebd85',
  down: '#f6465d',
  flat: '#7c8695',
  accent: '#4c8dff',
}

const FONT = '-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif'

/** Flat dark theme: no shadows, gradients or glow. */
export const chartStyles: StyleInput = {
  grid: {
    horizontal: { color: COLORS.grid },
    vertical: { color: COLORS.grid },
  },
  candle: {
    bar: {
      upColor: COLORS.up,
      downColor: COLORS.down,
      noChangeColor: COLORS.flat,
      upBorderColor: COLORS.up,
      downBorderColor: COLORS.down,
      noChangeBorderColor: COLORS.flat,
      upWickColor: COLORS.up,
      downWickColor: COLORS.down,
      noChangeWickColor: COLORS.flat,
    },
    priceMark: {
      high: { color: COLORS.text, textFamily: FONT },
      low: { color: COLORS.text, textFamily: FONT },
      last: {
        upColor: COLORS.up,
        downColor: COLORS.down,
        noChangeColor: COLORS.flat,
        text: { family: FONT },
      },
    },
    tooltip: {
      text: { color: COLORS.text, family: FONT, size: 11 },
    },
  },
  indicator: {
    tooltip: { text: { color: COLORS.text, family: FONT, size: 11 } },
    lastValueMark: { show: false },
    bars: [{ upColor: 'rgba(46,189,133,0.6)', downColor: 'rgba(246,70,93,0.6)', noChangeColor: COLORS.flat }],
  },
  xAxis: {
    axisLine: { color: COLORS.axis },
    tickLine: { color: COLORS.axis },
    tickText: { color: COLORS.text, family: FONT, size: 11 },
  },
  yAxis: {
    axisLine: { color: COLORS.axis },
    tickLine: { color: COLORS.axis },
    tickText: { color: COLORS.text, family: FONT, size: 11 },
  },
  separator: { color: COLORS.axis, activeBackgroundColor: 'rgba(76,141,255,0.15)' },
  crosshair: {
    horizontal: {
      line: { color: COLORS.crosshair },
      text: { borderColor: COLORS.crosshairLabel, backgroundColor: COLORS.crosshairLabel, family: FONT },
    },
    vertical: {
      line: { color: COLORS.crosshair },
      text: { borderColor: COLORS.crosshairLabel, backgroundColor: COLORS.crosshairLabel, family: FONT },
    },
  },
  overlay: {
    point: {
      color: COLORS.accent,
      borderColor: 'rgba(76,141,255,0.35)',
      activeColor: COLORS.accent,
      activeBorderColor: 'rgba(76,141,255,0.35)',
    },
    line: { color: COLORS.accent, size: 1 },
    rect: { color: 'rgba(76,141,255,0.15)', borderColor: COLORS.accent },
    polygon: { color: 'rgba(76,141,255,0.15)', borderColor: COLORS.accent },
    circle: { color: 'rgba(76,141,255,0.15)', borderColor: COLORS.accent },
    arc: { color: COLORS.accent },
    text: { color: '#ffffff', family: FONT, size: 12 },
  },
}
