import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_PERSONALIZATION, type Personalization } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { t } from '@/lib/i18n'

export function usePersonalization(): [Personalization, (next: Personalization) => void, string] {
  const [data, setData] = useState<Personalization>(DEFAULT_PERSONALIZATION)
  const [error, setError] = useState('')
  useEffect(() => {
    void hubApi()
      ?.getPersonalization?.()
      .then(setData)
      .catch(() => setError(t('common.loadFail')))
  }, [])
  const save = useCallback((next: Personalization) => {
    setData(next)
    void hubApi()
      ?.savePersonalization?.(next)
      .then((result) => setError(result.ok ? '' : result.error))
      .catch(() => setError(t('common.saveFail')))
  }, [])
  return [data, save, error]
}
