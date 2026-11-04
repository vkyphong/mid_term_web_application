import { useAuthImage, useUserAvatarUrl } from '../avatars'
import type { MemberRole } from '../types'

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
  /** Có userId thì hiện ảnh đại diện tài khoản (nếu đã đặt) thay cho chữ cái. */
  userId?: string
  size?: 'sm' | 'md' | 'lg'
  /** F06: undefined = không hiện chấm trạng thái. */
  online?: boolean
  /** Trưởng nhóm (chìa vàng) / phó nhóm (chìa bạc) ở góc avatar. */
  role?: MemberRole
}

export function Avatar({ name, userId, size = 'md', online, role }: AvatarProps) {
  const image = useAuthImage(useUserAvatarUrl(userId))
  return (
    <span className={`avatar avatar--${size} avatar--c${colorIndex(name)}${image ? ' avatar--image' : ''}`} aria-hidden="true">
      {image ? <img className="avatar-image" src={image} alt="" /> : initials(name)}
      {online !== undefined && <span className={`presence-dot${online ? ' presence-dot--online' : ''}`} />}
      {(role === 'owner' || role === 'deputy') && (
        <span className={`role-key role-key--${role}`} title={role === 'owner' ? 'Trưởng nhóm' : 'Phó nhóm'}>
          {/* Chìa khoá trong vòng tròn như Zalo: vàng = trưởng nhóm, bạc = phó nhóm. */}
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <circle cx="8" cy="12" r="4.2" fill="none" stroke="currentColor" strokeWidth="2.6" />
            <path d="M12 12h9M17.5 12v3.4M20.5 12v2.4" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </span>
      )}
    </span>
  )
}
