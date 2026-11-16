import { registerLocale } from 'klinecharts'
import type { ChartLocale } from './types'

const LOCALE_NAME: Record<ChartLocale, string> = { en: 'en-US', ru: 'ru-RU' }

let registered = false

/** KLineChart ships en-US and zh-CN; Russian is registered here. */
export function ensureLocales(): void {
  if (registered) return
  registered = true
  registerLocale('ru-RU', {
    time: 'Время: ',
    open: 'Откр: ',
    high: 'Макс: ',
    low: 'Мин: ',
    close: 'Закр: ',
    volume: 'Объём: ',
    turnover: 'Оборот: ',
    change: 'Изм: ',
  })
}

export function localeName(locale: ChartLocale): string {
  return LOCALE_NAME[locale]
}
