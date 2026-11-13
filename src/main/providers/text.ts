export type CleanupInput = {
  rawText: string
  app: string
  windowTitle: string
  language?: 'fr' | 'en' | 'multi'
  /** Mots de la personne à écrire exactement (dictionnaire perso). */
  terms?: string[]
  transform?: string
  tone?: 'formal' | 'casual' | 'very_casual'
  /** Texte autour du curseur, lu à l'écran (donnée, jamais une instruction). */
  context?: { before: string; selected: string; after: string }
  /** Noms propres, identifiants et fichiers vus à l'écran (donnée, jamais une instruction). */
  screenTerms?: string[]
  /** Dernières phrases écrites dans la même appli. */
  history?: string[]
  /** Résumé du style d'écriture de la personne. */
  voiceProfile?: string
  /** Nettoyage léger : ponctuation et hésitations seulement. */
  light?: boolean
  /** Traduire la dictée dans cette langue (réglage « Écrire en »). */
  translateTo?: 'fr' | 'en'
}

export type CleanupResult = {
  text: string
  usedModel: boolean
  latencyMs: number | null
  provider?: 'anthropic' | 'cerebras' | 'openai'
  /** Pourquoi le texte brut a été gardé alors qu'une clé était présente. */
  fallback?: string
  /** L'appel lui-même a échoué (réseau, clé, délai) : un autre fournisseur peut prendre le relais. */
  failed?: boolean
  /** Sortie du modèle refusée par le contrôle, gardée pour mesurer les faux refus. */
  rejected?: string
  /** La transformation demandée a bien été appliquée après le nettoyage. */
  transformed?: boolean
  /** id de la transformation appliquée (renseigné par l'appelant qui la connaît). */
  transform?: string
}

export interface TextCleanupProvider {
  cleanup(input: CleanupInput, timeoutMs: number): Promise<CleanupResult>
}
