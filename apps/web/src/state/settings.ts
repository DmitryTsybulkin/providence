import { create } from 'zustand'
import { createSaver, loadKey } from '../api/store'
import i18n, { LANGUAGES, type Language } from '../i18n'

interface Settings {
  language: Language
}
interface SettingsState extends Settings {
  setLanguage(l: Language): void
  hydrate(s: Partial<Settings> | undefined): void
}

const saver = createSaver<Settings>('settings')

export const useSettings = create<SettingsState>((set) => ({
  language: 'en',
  setLanguage(language) {
    set({ language })
    void i18n.changeLanguage(language)
    document.documentElement.lang = language
    saver.save({ language })
  },
  hydrate(s) {
    if (s?.language && LANGUAGES.includes(s.language)) {
      set({ language: s.language })
      void i18n.changeLanguage(s.language)
      document.documentElement.lang = s.language
    }
    saver.enable()
  },
}))

export async function loadSettings() {
  useSettings.getState().hydrate(await loadKey<Partial<Settings>>('settings'))
}
