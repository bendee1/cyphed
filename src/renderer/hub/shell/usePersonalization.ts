import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_PERSONALIZATION, type Personalization } from '@shared/types'
import { hubApi } from '@/lib/bridge'
import { t } from '@/lib/i18n'

export function usePersonalization(): [Personalization, (next: Personalization) => void, string] {
  const [data, setData] = useState<Personalization>(DEFAULT_PERSONALIZATION)
  const [error, setError] = useState('')
  // Chaque sauvegarde ou relecture prend un numéro : une relecture partie avant une sauvegarde (ou une autre relecture)
  // ne remplace jamais ce qui est à l'écran.
  const seq = useRef(0)
  useEffect(() => {
    const load = (): void => {
      const mine = ++seq.current
      void hubApi()
        ?.getPersonalization?.()
        .then((fresh) => {
          if (mine !== seq.current) return
          setData((current) => (JSON.stringify(current) === JSON.stringify(fresh) ? current : fresh))
        })
        .catch(() => setError(t('common.loadFail')))
    }
    load()
    // Un mot appris ou une transformation choisie depuis la barre change le fichier : sans relecture,
    // la prochaine sauvegarde du Hub écraserait ce changement avec une copie périmée.
    return hubApi()?.onInvalidate?.(load)
  }, [])
  const save = useCallback((next: Personalization) => {
    seq.current++
    setData(next)
    void hubApi()
      ?.savePersonalization?.(next)
      .then((result) => setError(result.ok ? '' : result.error))
      .catch(() => setError(t('common.saveFail')))
  }, [])
  return [data, save, error]
}
