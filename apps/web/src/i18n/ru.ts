import type { Strings } from './en'

export const ru: Strings = {
  app: {
    tagline: 'Локальные крипто-графики',
    loading: 'Загрузка…',
  },
  banner: {
    serverDown: 'Локальный сервер недоступен — данные не загружаются и не сохраняются, алерты приостановлены.',
    bybitDown: 'Bybit недоступен — показаны данные из кэша.',
    wsDown: 'Соединение потеряно — переподключение…',
  },
  category: { linear: 'Фьючерсы', spot: 'Спот' },
  assets: {
    title: 'Рынки',
    search: 'Поиск символа',
    favOnly: 'Только избранное',
    addFav: 'Добавить в избранное',
    removeFav: 'Убрать из избранного',
    empty: 'Ничего не найдено',
    count: 'Символов: {{count}}',
    col: {
      symbol: 'Символ',
      lastPrice: 'Цена',
      change24h: '24ч %',
      turnover24h: 'Оборот',
      volume24h: 'Объём',
      fundingRate: 'Фандинг',
    },
  },
  topbar: { language: 'Язык' },
}
