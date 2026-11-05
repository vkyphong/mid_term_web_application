import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { chatApi } from '../chatApi'
import type { Room } from '../types'
import { Avatar } from './Avatar'

/** Ảnh nhóm tải bằng Bearer token rồi hiện qua blob URL (như ảnh đính kèm F15). */
function useAvatarImage(url: string | null | undefined) {
  const blob = useQuery({
    queryKey: ['chat', 'room-avatar', url],
    queryFn: () => chatApi.downloadFile(url!),
    enabled: Boolean(url),
    staleTime: Infinity,
    retry: false,
  })
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    if (!blob.data) return setSrc(undefined)
    const objectUrl = URL.createObjectURL(blob.data)
    setSrc(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob.data])
  return url ? src : undefined
}

interface RoomAvatarProps {
  room: Room
  size?: 'sm' | 'md' | 'lg'
  /** DM: chấm online của người kia. */
  online?: boolean
}

/** DM: avatar người kia. Kênh: ảnh nhóm, không có thì ghép 2–3 avatar thành viên. */
export function RoomAvatar({ room, size = 'md', online }: RoomAvatarProps) {
  const image = useAvatarImage(room.type === 'channel' ? room.avatarUrl : null)

  if (room.type === 'dm') {
    return <Avatar name={room.peer?.displayName ?? room.name} userId={room.peer?.id} size={size === 'sm' ? 'sm' : 'md'} online={online} />
  }
  if (image) {
    return (
      <span className={`group-avatar group-avatar--${size}`} aria-hidden="true">
        <img className="group-avatar-image" src={image} alt="" />
      </span>
    )
  }
  const members = room.previewMembers?.length ? room.previewMembers.slice(0, 3) : [{ id: room.id, displayName: room.name, email: '' }]
  if (members.length === 1) {
    return (
      <span className={`group-avatar group-avatar--${size} group-avatar--n1`} aria-hidden="true">
        <Avatar name={members[0].displayName} userId={members[0].id} size="sm" />
      </span>
    )
  }
  return (
    <span className={`group-avatar group-avatar--${size} group-avatar--n${members.length}`} aria-hidden="true">
      {members.map((m) => (
        <Avatar key={m.id} name={m.displayName} userId={m.id} size="sm" />
      ))}
    </span>
  )
}
