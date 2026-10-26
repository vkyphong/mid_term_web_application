import { useNavigate } from 'react-router-dom'
import { useSession } from '../../auth/hooks'
import { describeChatError } from '../errors'
import { useOpenDm, useUserSearch } from '../hooks'
import { describePresence, usePresence } from '../presence'
import { Avatar } from './Avatar'

/** F06: đồng nghiệp (tối đa 20, theo API tìm kiếm) kèm online / lần hoạt động cuối; bấm để mở DM. */
export function PeopleSection() {
  const navigate = useNavigate()
  const { user: self } = useSession()
  const users = useUserSearch('')
  const presence = usePresence()
  const openDm = useOpenDm()

  const people = [...(users.data ?? [])].sort((a, b) => {
    const online = Number(presence.get(b.id)?.online ?? false) - Number(presence.get(a.id)?.online ?? false)
    return online || a.displayName.localeCompare(b.displayName, 'vi')
  })
  // Đếm trên snapshot presence của mọi user (danh sách tên chỉ có tối đa 20 người).
  const onlineCount = [...presence.byUser.values()].filter((p) => p.online && p.userId !== self?.id).length

  return (
    <section className="sidebar-section" aria-labelledby="people-heading">
      <div className="sidebar-heading">
        <h2 id="people-heading">Đồng nghiệp</h2>
        <span className="muted small">{onlineCount} đang online</span>
      </div>
      {users.error && <p className="field-error">{describeChatError(users.error)}</p>}
      {openDm.error && <p className="field-error">{describeChatError(openDm.error)}</p>}
      <ul>
        {people.map((u) => {
          const p = presence.get(u.id)
          return (
            <li key={u.id}>
              <button
                type="button"
                className="room-link person-link"
                disabled={openDm.isPending}
                onClick={() => openDm.mutate(u.id, { onSuccess: (room) => navigate(`/rooms/${room.id}`) })}
              >
                <Avatar name={u.displayName} size="sm" online={p?.online ?? false} />
                <span className="person-text">
                  <span className="room-link-name">{u.displayName}</span>
                  <span className="person-status">{describePresence(p)}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
