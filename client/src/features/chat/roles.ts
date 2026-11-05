import type { MemberRole, RoomMember, UserSummary } from './types'

/** Server cho tối đa 5 phó nhóm mỗi kênh. */
export const MAX_DEPUTIES = 5

export const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Trưởng nhóm', deputy: 'Phó nhóm', member: 'Thành viên' }

/** Vai trò trong nhóm của một người (danh sách thành viên có memberRole). */
export function roleOf(members: readonly UserSummary[], userId: string): MemberRole | undefined {
  return (members as readonly RoomMember[]).find((m) => m.id === userId)?.memberRole
}
