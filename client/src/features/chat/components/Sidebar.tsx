import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { describeChatError } from '../errors'
import { useRooms } from '../hooks'
import { compareTimestamps } from '../messages'
import type { Room } from '../types'
import { Avatar } from './Avatar'
import { BrowseChannelsDialog } from './BrowseChannelsDialog'
import { CreateChannelDialog } from './CreateChannelDialog'
import { NewDirectMessageDialog } from './NewDirectMessageDialog'
import { PeopleSection } from './PeopleSection'
import { usePresence } from '../presence'

type Dialog = 'create' | 'browse' | 'dm' | null

const byRecent = (a: Room, b: Room) => compareTimestamps(b.lastMessageAt ?? '', a.lastMessageAt ?? '')

function RoomLink({ room, online }: { room: Room; online?: boolean }) {
  return (
    <NavLink to={`/rooms/${room.id}`} className={({ isActive }) => `room-link${isActive ? ' room-link--active' : ''}`}>
      {room.type === 'dm' ? <Avatar name={room.name} size="sm" online={online ?? false} /> : <span className="room-hash">#</span>}
      <span className="room-link-name">{room.name}</span>
    </NavLink>
  )
}

export function Sidebar() {
  const rooms = useRooms()
  const presence = usePresence()
  const [dialog, setDialog] = useState<Dialog>(null)
  const close = () => setDialog(null)

  const all = rooms.data ?? []
  const channels = all.filter((r) => r.type === 'channel' && r.joined).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const dms = all.filter((r) => r.type === 'dm').sort(byRecent)

  return (
    <nav className="sidebar" aria-label="Danh sách phòng">
      <section className="sidebar-section">
        <div className="sidebar-heading">
          <h2>Kênh</h2>
          <div className="sidebar-actions">
            <button type="button" className="icon-btn" aria-label="Duyệt kênh" title="Duyệt kênh" onClick={() => setDialog('browse')}>
              ☰
            </button>
            <button type="button" className="icon-btn" aria-label="Tạo kênh" title="Tạo kênh" onClick={() => setDialog('create')}>
              +
            </button>
          </div>
        </div>
        {rooms.isPending && <p className="muted small">Đang tải…</p>}
        {rooms.error && <p className="field-error">{describeChatError(rooms.error)}</p>}
        {rooms.isSuccess && channels.length === 0 && (
          <button type="button" className="link-btn" onClick={() => setDialog('browse')}>
            Bạn chưa tham gia kênh nào — duyệt kênh
          </button>
        )}
        <ul>
          {channels.map((room) => (
            <li key={room.id}>
              <RoomLink room={room} />
            </li>
          ))}
        </ul>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-heading">
          <h2>Tin nhắn riêng</h2>
          <button type="button" className="icon-btn" aria-label="Tin nhắn mới" title="Tin nhắn mới" onClick={() => setDialog('dm')}>
            +
          </button>
        </div>
        {rooms.isSuccess && dms.length === 0 && <p className="muted small">Chưa có cuộc trò chuyện riêng.</p>}
        <ul>
          {dms.map((room) => (
            <li key={room.id}>
              <RoomLink room={room} online={presence.get(room.peer?.id)?.online} />
            </li>
          ))}
        </ul>
      </section>

      <PeopleSection />

      {dialog === 'create' && <CreateChannelDialog onClose={close} />}
      {dialog === 'browse' && <BrowseChannelsDialog onClose={close} />}
      {dialog === 'dm' && <NewDirectMessageDialog onClose={close} />}
    </nav>
  )
}
