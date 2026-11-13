// Repère les jetons qui ressemblent à un secret (clé API, hash, base64) pour ne jamais les envoyer à un service tiers
// ni les écrire dans un jeu d'entraînement. Pur : testable avec `node --test`.

const PREFIXES = /^(?:sk[_-]|pk[_-]|rk[_-]|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abprs]-?|AKIA|ASIA|eyJ|AIza)/
const HEX = /^[0-9a-f]+$/i

/** Un seul mot (sans espace) qui a l'air d'un secret. Ne juge pas la longueur maximale d'un mot ordinaire. */
export function looksLikeSecretToken(raw: string): boolean {
  const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}=]+$/gu, '')
  if (token.length < 6) return false
  if (PREFIXES.test(token)) return true
  const digits = (token.match(/\d/g) ?? []).length
  if (token.length > 8 && digits / token.length >= 0.3) return true
  // Hash hexadécimal (git, md5, sha) : 7 caractères ou plus, au moins un chiffre et une lettre.
  if (token.length >= 7 && HEX.test(token) && digits > 0 && digits < token.length) return true
  if (token.length >= 24 && HEX.test(token)) return true
  // Base64 / jeton opaque : longue suite mêlant majuscules, minuscules et chiffres.
  if (token.length >= 16 && /^[A-Za-z0-9+/_=-]+$/.test(token) && /[a-z]/.test(token) && /[A-Z]/.test(token) && digits > 0) return true
  if (token.length >= 20 && /[+/]/.test(token) && /^[A-Za-z0-9+/_=-]+$/.test(token) && /\d/.test(token)) return true
  return false
}

/** Mot rare lu à l'écran, qu'on peut donner à Deepgram sans risque : refuse les mots de plus de 24 caractères et les jetons. */
export function isSafeScreenTerm(term: string): boolean {
  return term.split(/\s+/).filter(Boolean).every((part) => part.length <= 24 && !looksLikeSecretToken(part))
}

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu
const LONG_DIGITS = /\d[\d\s.-]{4,}\d/g

/** Masque e-mails, suites de 6 chiffres ou plus (téléphone, carte, code) et jetons. Pour les jeux d'entraînement. */
export function maskSensitive(text: string): string {
  let out = text.replace(EMAIL, '[email]')
  out = out.replace(LONG_DIGITS, (m) => ((m.match(/\d/g) ?? []).length >= 6 ? '[nombre]' : m))
  out = out.replace(/\S+/g, (word) => {
    const core = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}=]+$/gu, '')
    if (!core) return word
    if (looksLikeSecretToken(core) || (core.length > 24 && /\d/.test(core))) return word.replace(core, '[jeton]')
    return word
  })
  return out
}
