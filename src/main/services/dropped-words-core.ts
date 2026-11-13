// Deepgram Nova-3 en français avale des petits mots que la phrase exige. Mesuré sur 115 dictées
// réelles : Haiku en répare la plupart, mais laisse les « vois » sans « tu ».
// On remet ici, sans modèle, les seuls cas sans ambiguïté.

const RULES: Array<[RegExp, (m: string, ...g: string[]) => string]> = [
  // « …, vois. » en début de proposition : « tu vois » (on ne touche pas « je vois », « on vois »).
  [/(^|[,.?!;:]\s*)(V|v)ois\b(?!-)/g, (_m, pre, v) => `${pre}${v === 'V' ? 'Tu' : 'tu'} vois`],
  // « il y des » : « il y a des »
  [/\b([Ii]l) y (des|un|une|le|la|les|du|pas|plus|toujours|quelque|trop)\b/g, (_m, il, w) => `${il} y a ${w}`],
  // « je ne pas » : on dit « je sais pas »
  [/\b([Jj]e) ne pas\b/g, (_m, je) => `${je} sais pas`]
]

export function repairDroppedWords(text: string): string {
  let out = text
  for (const [re, fn] of RULES) out = out.replace(re, fn as (substring: string, ...args: string[]) => string)
  return out
}
