import { getMistralKey } from '../secrets'
import { tm } from '../lang'

export const OCR_MODEL = 'mistral-ocr-4-1'
const ENDPOINT = 'https://api.mistral.ai/v1/ocr'

export type OcrResult = {
  text: string
  model: string
}

export async function ocrImage(png: Buffer, timeoutMs = 20000): Promise<OcrResult> {
  const key = getMistralKey()
  if (!key) throw new Error(tm('prov.mistral.noKeyOcr'))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OCR_MODEL,
        document: {
          type: 'image_url',
          image_url: `data:image/png;base64,${png.toString('base64')}`
        },
        include_image_base64: false
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Mistral OCR ${res.status} ${body.slice(0, 180)}`)
    }
    const json = (await res.json()) as {
      pages?: Array<{ markdown?: string; text?: string }>
      model?: string
    }
    const text = (json.pages ?? [])
      .map((page) => (page.markdown || page.text || '').trim())
      .filter(Boolean)
      .join('\n\n')
      .trim()
    if (!text) throw new Error(tm('prov.ocr.empty'))
    return { text, model: json.model || OCR_MODEL }
  } finally {
    clearTimeout(timer)
  }
}
