export interface TextPart {
  text: string
  href?: string
}

// http(s)://… hoặc www.…; chỉ hai dạng này để không biến "a.b" bình thường thành link.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi
// Dấu câu dính cuối link thường thuộc câu, không thuộc link.
const TRAILING = /[.,;:!?…)\]}'"»”]+$/

/** Tách đoạn chữ thành phần thường và phần link (href luôn là http/https). */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    let url = match[0]
    // Giữ ")" nếu link có "(" cân bằng, vd wikipedia.org/wiki/A_(B).
    const trailing = url.match(TRAILING)?.[0] ?? ''
    let cut = trailing.length
    if (trailing.startsWith(')') && (url.match(/\(/g)?.length ?? 0) > (url.slice(0, url.length - trailing.length).match(/\)/g)?.length ?? 0)) cut--
    url = url.slice(0, url.length - cut)
    if (!url || /^(https?:\/\/|www\.)$/i.test(url)) continue
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: url, href: /^www\./i.test(url) ? `https://${url}` : url })
    last = start + url.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts.length ? parts : [{ text }]
}
