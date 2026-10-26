const PALETTE = 6

function initials(name: string): string {
  // Chỉ lấy các từ bắt đầu bằng chữ/số: "Phong (demo)" → "PD", không phải "P(".
  const parts = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

function colorIndex(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % PALETTE
}

interface AvatarProps {
  name: string
  size?: 'sm' | 'md'
  /** F06: undefined = không hiện chấm trạng thái. */
  online?: boolean
}

export function Avatar({ name, size = 'md', online }: AvatarProps) {
  return (
    <span className={`avatar avatar--${size} avatar--c${colorIndex(name)}`} aria-hidden="true">
      {initials(name)}
      {online !== undefined && <span className={`presence-dot${online ? ' presence-dot--online' : ''}`} />}
    </span>
  )
}
