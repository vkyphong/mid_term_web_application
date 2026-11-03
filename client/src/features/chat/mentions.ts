import type { RoomMember, UserSummary } from './types'

/**
 * F09. Server không phân tích "@tên" trong nội dung: client gửi danh sách userId được nhắc
 * (`mentions`). Ở đây: tìm "@đang gõ" trước con trỏ, chọn ứng viên, và chỉ giữ những người
 * vẫn còn "@Tên" trong nội dung lúc gửi.
 */

/** "@All" nhắc cả nhóm. Server chỉ nhận userId, nên lúc gửi được thay bằng ID của mọi thành viên. */
export const MENTION_ALL: UserSummary = { id: '@all', displayName: 'All', email: '' }
/** Server nhận tối đa 20 userId khác nhau trong `mentions`. */
export const MAX_MENTIONS = 20

const isActive = (m: RoomMember) => m.enabled !== false

/** Đoạn "@abc" ngay trước con trỏ (chưa có khoảng trắng kép), hoặc null. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([\p{L}\p{N}_.-]{0,30}(?: [\p{L}\p{N}_.-]{1,30})?)$/u.exec(before)
  if (!match) return null
  return { start: caret - match[2].length - 1, query: match[2] }
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Ứng viên cho "@query": bỏ chính mình và tài khoản bị khoá. `includeAll` (kênh) thêm "@All"
 * lên đầu khi query khớp "all" hoặc "tất cả", giống Zalo.
 */
export function filterMentionCandidates(
  members: readonly RoomMember[],
  query: string,
  selfId?: string,
  includeAll = false,
): UserSummary[] {
  const q = fold(query.trim())
  const others = members.filter((m) => m.id !== selfId && isActive(m))
  const people = others.filter(
    (m) => !q || fold(m.displayName).split(/\s+/).some((w) => w.startsWith(q)) || fold(m.displayName).startsWith(q),
  )
  const all = includeAll && others.length > 0 && (!q || 'all'.startsWith(q) || 'tat ca'.startsWith(q)) ? [MENTION_ALL] : []
  return [...all, ...people].slice(0, 6)
}

/** Thay "@query" bằng "@Tên " và trả về nội dung mới cùng vị trí con trỏ. */
export function insertMention(text: string, start: number, caret: number, member: UserSummary) {
  const inserted = `@${member.displayName} `
  return { text: text.slice(0, start) + inserted + text.slice(caret), caret: start + inserted.length }
}

/**
 * userId của những người đã chọn mà "@Tên" vẫn còn trong nội dung (tối đa 20, không trùng).
 * "@All" mở rộng thành mọi thành viên đang hoạt động trừ người gửi; người được chọn riêng xếp trước
 * nên vẫn được giữ khi nhóm vượt giới hạn 20.
 */
export function resolveMentions(
  content: string,
  picked: readonly UserSummary[],
  members: readonly RoomMember[] = [],
  selfId?: string,
): string[] {
  const named = picked.filter((m) => m.id !== MENTION_ALL.id && content.includes(`@${m.displayName}`)).map((m) => m.id)
  const everyone =
    picked.some((m) => m.id === MENTION_ALL.id) && content.includes(`@${MENTION_ALL.displayName}`)
      ? members.filter((m) => m.id !== selfId && isActive(m)).map((m) => m.id)
      : []
  return [...new Set([...named, ...everyone])].slice(0, MAX_MENTIONS)
}

export type ContentPart = { text: string; mention?: UserSummary }

/** Tách nội dung để tô "@Tên" của thành viên (render dạng text, không dùng HTML). */
export function splitMentions(content: string, members: readonly UserSummary[], withAll = false): ContentPart[] {
  const names = [...members, ...(withAll && members.length > 0 ? [MENTION_ALL] : [])].sort(
    (a, b) => b.displayName.length - a.displayName.length,
  )
  if (names.length === 0 || !content.includes('@')) return [{ text: content }]
  const escaped = names.map((m) => m.displayName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = new RegExp(`@(${escaped.join('|')})`, 'g')
  const parts: ContentPart[] = []
  let last = 0
  for (const match of content.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ text: content.slice(last, index) })
    parts.push({ text: match[0], mention: names.find((m) => m.displayName === match[1]) })
    last = index + match[0].length
  }
  if (last < content.length) parts.push({ text: content.slice(last) })
  return parts
}
