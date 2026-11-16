import { create } from 'zustand'
import type { WsStatusMap } from '@providence/adapter-bybit'
import { adapter } from '../api/adapter'

/** Status of the Bybit public WebSocket per category (drives the "reconnecting" badge). */
export const useWsStatus = create<WsStatusMap>(() => adapter.getWsStatus())

adapter.onWsStatus((s) => useWsStatus.setState(s))
