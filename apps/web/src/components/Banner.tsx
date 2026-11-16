import { useTranslation } from 'react-i18next'
import { useAlerts } from '../state/alerts'
import { useBoot } from '../state/boot'
import { useMarket } from '../state/market'

/** Warning banner when data is stale or a backend is unreachable (market-data §6). */
export function Banner() {
  const { t } = useTranslation()
  const rest = useMarket((s) => s.rest)
  const bootDown = useBoot((s) => s.serverDown && !s.hydrated)

  const eventsUp = useAlerts((s) => s.connected)
  const hydrated = useBoot((s) => s.hydrated)

  let message: string | null = null
  if (bootDown || (rest && !rest.serverOk) || (hydrated && !eventsUp)) message = t('banner.serverDown')
  else if (rest?.stale) message = t('banner.bybitDown')
  if (!message) return null
  return (
    <div className="banner" role="alert">
      {message}
    </div>
  )
}
