/**
 * Catégorie d'une application pour les Insights (pur : pas d'Electron).
 * Plus large que styleCategory (cleanup-prompt) : les statistiques reconnaissent aussi
 * les assistants IA, les variantes de nom de processus et les navigateurs selon le titre.
 */
export type AppCategoryId = 'personal' | 'work' | 'email' | 'code' | 'ai' | 'other'

const CODE = new Set([
  'code', 'codeinsiders', 'cursor', 'windsurf', 'devenv', 'idea64', 'pycharm64', 'webstorm64', 'rider64',
  'sublimetext', 'notepad++', 'windowsterminal', 'wt', 'powershell', 'powershellise', 'pwsh', 'cmd', 'conhost',
  'alacritty', 'wezterm', 'wezterm-gui', 'gitbash', 'mintty', 'terminal', 'zed'
])
const WORK = new Set(['slack', 'teams', 'msteams', 'ms-teams'])
const AI = new Set(['claude', 'chatgpt', 'perplexity', 'grok'])
const PERSONAL = new Set(['discord', 'whatsapp', 'whatsapp.root', 'telegram', 'signal', 'messenger'])
const EMAIL = new Set(['outlook', 'olk', 'thunderbird', 'winword', 'hxoutlook', 'mailspring'])
const BROWSERS = new Set(['chrome', 'msedge', 'edge', 'firefox', 'brave', 'opera', 'arc', 'vivaldi', 'zen'])

export function normalizeAppName(name: string): string {
  return name.toLowerCase().trim().replace(/\.exe$/, '').replace(/[\s_]+/g, '')
}

export function appCategory(processName: string, windowTitle = ''): AppCategoryId {
  const app = normalizeAppName(processName)
  if (CODE.has(app)) return 'code'
  if (PERSONAL.has(app)) return 'personal'
  if (WORK.has(app)) return 'work'
  if (AI.has(app)) return 'ai'
  if (EMAIL.has(app)) return 'email'
  if (BROWSERS.has(app)) {
    const title = windowTitle.toLowerCase()
    if (/gmail|outlook|proton mail|courrier|inbox|boîte de réception/.test(title)) return 'email'
    if (/discord|whatsapp|telegram|messenger|signal/.test(title)) return 'personal'
    if (/\bclaude\b|chatgpt|gemini|perplexity|copilot|le chat|mistral ai|\bgrok\b|deepseek/.test(title)) return 'ai'
    if (/slack|teams/.test(title)) return 'work'
    if (/github|gitlab|codespaces|stack overflow|localhost|vercel|cloudflare/.test(title)) return 'code'
  }
  return 'other'
}
