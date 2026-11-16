import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { ru } from './ru'

export const LANGUAGES = ['en', 'ru'] as const
export type Language = (typeof LANGUAGES)[number]

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ru: { translation: ru } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

export default i18n
