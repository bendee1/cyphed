import { getMistralKey } from '../secrets'
import { tm } from '../lang'

export const VISION_MODEL = 'mistral-large-2512'
const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions'

export async function visionExplain(png: Buffer, timeoutMs = 25000): Promise<string> {
  const key = getMistralKey()
  if (!key) throw new Error(tm('prov.mistral.noKeyVision'))

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
        model: VISION_MODEL,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Explique cette capture simplement en français, en quelques phrases. Texte uniquement, sans markdown.'
              },
              {
                type: 'image_url',
                image_url: `data:image/png;base64,${png.toString('base64')}`
              }
            ]
          }
        ]
      })
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Mistral Vision ${res.status} ${body.slice(0, 180)}`)
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = (json.choices?.[0]?.message?.content ?? '').trim()
    if (!text) throw new Error(tm('prov.vision.empty'))
    return text
  } finally {
    clearTimeout(timer)
  }
}
