/**
 * One-line hint for the desktop chat strip while a builtin client tool runs (Chrome, etc.).
 * Without this, every browser call looks the same ("浏览器 — 正在执行…") even when URL/op changes.
 */

function strField (p: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = p[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

function short (s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…`
}

export function formatClientToolProgressLabel (
  toolName: string,
  params: Record<string, unknown> | undefined,
): string {
  const p = params ?? {}
  const base = toolName.replace(/^builtin_/, '').toLowerCase()

  if (base === 'browser') {
    const op = strField(p, ['operation', 'op', 'action'])
    const url = strField(p, ['url', 'target'])
    const sel = strField(p, ['selector', 'css', 'element'])
    const text = strField(p, ['text', 'content', 'value'])
    const key = strField(p, ['key', 'keys', 'k'])
    const bits: string[] = []
    if (op) bits.push(op)
    if (url) bits.push(short(url, 96))
    else if (sel) bits.push(`CSS ${short(sel, 72)}`)
    else if (text) bits.push(`「${short(text, 40)}」`)
    else if (key) bits.push(`key: ${short(key, 24)}`)
    return bits.join(' · ')
  }

  return ''
}
