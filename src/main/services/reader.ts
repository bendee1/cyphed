import type { ActivityKind, ActivityRecord } from '@shared/types'
import type { ReaderAction, ReaderResult, ReaderSource } from '@shared/ipc'
import { getDb } from '../db'
import { cerebrasComplete } from '../providers/cerebras'
import { OCR_MODEL, ocrImage } from '../providers/ocr'
import { createTtsProvider, type TtsProvider } from '../providers/tts'
import { VISION_MODEL, visionExplain } from '../providers/vision'
import { applyReaderLlm, looksFrench, planReaderRoute } from './reader-route'
import { splitForSpeech } from './speech-core'
import { tm } from '../lang'

/** Traduction d'un long texte : des morceaux traduits en parallèle (une réponse de modèle a une longueur limitée). */
const TRANSLATE_CHUNK_CHARS = 3000
const TRANSLATE_PARALLEL = 3

async function translateLong(system: string, text: string): Promise<{ text: string; complete: boolean }> {
  const chunks = splitForSpeech(text, TRANSLATE_CHUNK_CHARS)
  const out: string[] = new Array(chunks.length)
  let complete = true
  let cursor = 0
  async function worker(): Promise<void> {
    while (cursor < chunks.length) {
      const i = cursor++
      try {
        const llm = await cerebrasComplete(system, chunks[i], 30000, Math.min(4096, Math.ceil(chunks[i].length / 2) + 300))
        if (llm.finishReason === 'length' || !llm.text.trim()) throw new Error('réponse coupée')
        out[i] = llm.text.trim()
      } catch (err) {
        console.warn('[reader] morceau non traduit:', err instanceof Error ? err.message : err)
        out[i] = chunks[i]
        complete = false
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRANSLATE_PARALLEL, chunks.length) }, () => worker()))
  return { text: out.join('\n\n'), complete }
}

const PROMPTS: Record<ReaderAction, string> = {
  read: 'Traduis ce contenu en français naturel et fidèle, prêt à être écouté : tout le texte, sans rien résumer ni omettre. S’il est déjà en français, garde-le. Titres et puces deviennent des phrases. Texte uniquement, sans notes, sans markdown.',
  summarize: 'Résume ce texte en français, clair et court, prêt à être lu à voix haute. Texte uniquement.',
  explain: 'Explique ce texte simplement en français, en quelques phrases, prêt à être lu à voix haute. Texte uniquement.'
}

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function kindFor(route: ReaderResult['route']): ActivityKind {
  if (route === 'vision') return 'capture_vision'
  if (route === 'ocr') return 'capture_ocr'
  return 'reader_text'
}

type ReaderOutcome = ReaderResult & { rawText: string; usedLlm: boolean }

export class ReaderService {
  private tts: TtsProvider | null = null

  constructor(private zone: () => Buffer | null) {}

  stopSpeak(): void {
    this.tts?.stop()
  }

  speaking(): boolean {
    return Boolean(this.tts?.speaking())
  }

  async speak(text: string): Promise<void> {
    this.tts ??= createTtsProvider()
    await this.tts.speak(text, 'lire')
  }

  /** Aperçu d'une voix dans Réglages : une phrase courte, avec la voix enregistrée pour ce rôle. */
  async preview(role: 'lire' | 'assistant'): Promise<void> {
    this.tts ??= createTtsProvider()
    await this.tts.speak(tm('voice.sample'), role)
  }

  async run(action: ReaderAction, source: ReaderSource): Promise<ReaderResult> {
    const started = Date.now()
    const outcome = await this.toFrench(action, source)
    this.remember(outcome, action, started)
    const { rawText: _raw, usedLlm: _llm, ...result } = outcome
    return result
  }

  private async toFrench(action: ReaderAction, source: ReaderSource): Promise<ReaderOutcome> {
    if (action === 'explain' && source.kind === 'zone') {
      const text = await visionExplain(this.requireZone())
      return {
        text,
        rawText: '',
        route: 'vision',
        model: VISION_MODEL,
        fallback: false,
        inFrench: looksFrench(text),
        usedLlm: false
      }
    }
    const extracted = await this.resolveText(source)
    const plan = planReaderRoute(action, extracted.text)
    if (plan.skipLlm) {
      return { ...extracted, rawText: extracted.text, fallback: false, inFrench: true, usedLlm: false }
    }
    // Lire un long texte : traduit en entier, par morceaux (avant, au-delà d'environ 900 mots, tout restait en anglais).
    if (action === 'read' && extracted.text.length > TRANSLATE_CHUNK_CHARS) {
      const long = await translateLong(PROMPTS.read, extracted.text)
      return {
        ...extracted,
        rawText: extracted.text,
        text: long.text,
        fallback: !long.complete,
        inFrench: looksFrench(long.text),
        usedLlm: true
      }
    }
    try {
      const llm = await cerebrasComplete(PROMPTS[action], extracted.text, 12000, 900)
      if (llm.finishReason === 'length') {
        const applied = applyReaderLlm(extracted.text, { ok: false })
        return {
          ...extracted,
          rawText: extracted.text,
          text: applied.text,
          fallback: true,
          inFrench: looksFrench(applied.text),
          usedLlm: false
        }
      }
      const applied = applyReaderLlm(extracted.text, { ok: true, text: llm.text })
      return {
        ...extracted,
        rawText: extracted.text,
        text: applied.text,
        fallback: false,
        inFrench: looksFrench(applied.text),
        usedLlm: true
      }
    } catch (err) {
      console.warn('[reader] cerebras fallback brut:', err instanceof Error ? err.message : err)
      const applied = applyReaderLlm(extracted.text, { ok: false })
      return {
        ...extracted,
        rawText: extracted.text,
        text: applied.text,
        fallback: true,
        inFrench: looksFrench(applied.text),
        usedLlm: false
      }
    }
  }

  private async resolveText(source: ReaderSource): Promise<ReaderResult> {
    if (source.kind === 'text') {
      const text = source.text.trim()
      if (!text) throw new Error(tm('err.pasteFirst'))
      return { text, route: 'text', model: 'paste' }
    }
    const ocr = await ocrImage(this.requireZone())
    return { text: ocr.text, route: 'ocr', model: ocr.model || OCR_MODEL }
  }

  private requireZone(): Buffer {
    const png = this.zone()
    if (!png?.length) throw new Error(tm('err.captureFirst'))
    return png
  }

  private remember(result: ReaderOutcome, action: ReaderAction, started: number): void {
    const kind = kindFor(result.route)
    const steps =
      result.route === 'vision'
        ? ['mistral-vision']
        : result.route === 'ocr'
          ? result.usedLlm
            ? ['mistral-ocr', 'cerebras']
            : ['mistral-ocr']
          : result.usedLlm
            ? ['paste', 'cerebras']
            : ['paste']
    const row: ActivityRecord = {
      kind,
      id: crypto.randomUUID(),
      rawText: result.rawText,
      finalText: result.text,
      createdAt: new Date().toISOString(),
      durationMs: Date.now() - started,
      words: wordCount(result.text),
      app: result.route === 'text' ? 'Texte' : 'Capture',
      windowTitle: result.route,
      source: 'v2',
      action,
      route: result.route,
      provenance: { steps },
      timings: { hotkeyStartMs: started }
    }
    getDb().insertActivity(row)
  }
}
