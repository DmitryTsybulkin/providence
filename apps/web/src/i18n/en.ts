export const en = {
  app: {
    tagline: 'Local-first crypto charts',
    loading: 'Loading…',
  },
  banner: {
    serverDown: 'Local server is unreachable — data cannot be loaded or saved, alerts are paused.',
    bybitDown: 'Bybit is unreachable — showing cached data.',
    wsDown: 'Live connection lost — reconnecting…',
  },
  category: { linear: 'Perpetuals', spot: 'Spot' },
  assets: {
    title: 'Markets',
    search: 'Search symbol',
    favOnly: 'Favourites only',
    addFav: 'Add to favourites',
    removeFav: 'Remove from favourites',
    empty: 'Nothing found',
    count: '{{count}} symbols',
    col: {
      symbol: 'Symbol',
      lastPrice: 'Last',
      change24h: '24h %',
      turnover24h: 'Turnover',
      volume24h: 'Volume',
      fundingRate: 'Funding',
    },
  },
  topbar: { language: 'Language' },
}
export type Strings = typeof en
