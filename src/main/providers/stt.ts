type SttOpenResult = {
  provider: string
  model: string
}

export interface LiveSttSession {
  readonly provider: string
  readonly model: string
  send(pcm16: Buffer): void
  finalize(): Promise<string>
  close(): void
  /** La connexion est tombée avant la fin : le texte rendu peut être incomplet. */
  lost?(): boolean
}

export type SttOpenOptions = {
  language?: string
  /** Mots à mieux reconnaître (noms propres, marques, termes de la personne). */
  keyterms?: string[]
  signal?: AbortSignal
  /** Texte entendu jusqu'ici (validé + provisoire), à chaque message du moteur en direct. Pour l'affichage seulement. */
  onCaption?: (text: string) => void
}

export interface SttProvider {
  open(options?: SttOpenOptions): Promise<LiveSttSession>
}
