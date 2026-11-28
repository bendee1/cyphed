import type { PreloadApi } from '@shared/ipc'

type HubWindow = Window & { cyphed?: PreloadApi }

export function hubApi(): PreloadApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as HubWindow).cyphed
  if (!api || typeof api.getStatus !== 'function') return null
  return api
}

export function canSaveSettings(api: PreloadApi | null): boolean {
  return typeof api?.saveSettings === 'function'
}
