import { useState } from 'react'
import { useDebounced } from '../../../lib/useDebounced'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useUserSearch } from '../hooks'
import type { UserSummary } from '../types'
import { Avatar } from './Avatar'

interface MemberPickerProps {
  selected: readonly UserSummary[]
  onChange: (selected: UserSummary[]) => void
  /** Người đã ở trong nhóm: hiện nhưng không chọn được. */
  existingIds?: ReadonlySet<string>
  disabled?: boolean
}

/** Tìm nhân viên và chọn nhiều người (thêm vào nhóm). */
export function MemberPicker({ selected, onChange, existingIds, disabled = false }: MemberPickerProps) {
  const [search, setSearch] = useState('')
  const query = useDebounced(search.trim())
  const users = useUserSearch(query)
  const isSelected = (id: string) => selected.some((u) => u.id === id)
  const toggle = (user: UserSummary) =>
    onChange(isSelected(user.id) ? selected.filter((u) => u.id !== user.id) : [...selected, user])

  return (
    <div className="member-picker">
      <TextField
        label="Tìm nhân viên"
        name="member-search"
        type="search"
        placeholder="Nhập tên hoặc email"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {selected.length > 0 && (
        <ul className="member-chips" aria-label="Đã chọn">
          {selected.map((u) => (
            <li key={u.id} className="member-chip">
              <Avatar name={u.displayName} size="sm" />
              {u.displayName}
              <button type="button" className="icon-btn" aria-label={`Bỏ chọn ${u.displayName}`} disabled={disabled} onClick={() => toggle(u)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {users.error && <p className="field-error">{describeChatError(users.error)}</p>}
      {users.isPending && <p className="muted small">Đang tìm…</p>}
      {users.data?.length === 0 && <p className="muted small">Không tìm thấy nhân viên phù hợp.</p>}
      <ul className="user-results member-results">
        {users.data?.map((u) => {
          const existing = existingIds?.has(u.id) ?? false
          const checked = existing || isSelected(u.id)
          return (
            <li key={u.id}>
              <label className={`user-result member-option${existing ? ' member-option--existing' : ''}`}>
                <input type="checkbox" checked={checked} disabled={disabled || existing} onChange={() => toggle(u)} />
                <Avatar name={u.displayName} />
                <span>
                  <strong>{u.displayName}</strong>
                  <span className="muted small">{existing ? 'Đã trong nhóm' : u.email}</span>
                </span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
