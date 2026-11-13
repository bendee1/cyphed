import type { PreloadApi } from '@shared/ipc'

type HubWindow = Window & { cyphed?: PreloadApi; omax?: PreloadApi }

export function installHubBridge(): void {
  if (typeof window === 'undefined') return
  const w = window as HubWindow
  if (!w.cyphed && w.omax) w.cyphed = w.omax
}

export function hubApi(): PreloadApi | null {
  installHubBridge()
  if (typeof window === 'undefined') return null
  const api = (window as HubWindow).cyphed
  if (!api || typeof api.getStatus !== 'function') return null
  return api
}

export function canSaveSettings(api: PreloadApi | null): boolean {
  return typeof api?.saveSettings === 'function'
}
