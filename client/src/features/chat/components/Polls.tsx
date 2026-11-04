import { useState, type FormEvent } from 'react'
import { FormAlert } from '../../auth/components/FormAlert'
import { TextField } from '../../auth/components/TextField'
import { describeChatError } from '../errors'
import { useCreatePoll, useVote } from '../hooks'
import type { Poll, UserSummary } from '../types'
import { Modal } from './Modal'

const MAX_POLL_OPTIONS = 10

/** Tạo bình chọn: câu hỏi + 2 lựa chọn ban đầu, bấm "+" để thêm (tối đa 10). */
export function CreatePollDialog({ roomId, onClose }: { roomId: string; onClose: () => void }) {
  const create = useCreatePoll(roomId)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [multiple, setMultiple] = useState(true)
  const [error, setError] = useState<string>()

  const setOption = (i: number, value: string) => setOptions((list) => list.map((o, j) => (j === i ? value : o)))
  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const filled = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim()) return setError('Nhập câu hỏi bình chọn.')
    if (filled.length < 2) return setError('Cần ít nhất 2 lựa chọn.')
    if (new Set(filled.map((o) => o.toLowerCase())).size !== filled.length) return setError('Các lựa chọn không được trùng nhau.')
    create.mutate({ question: question.trim(), options: filled, multiple }, { onSuccess: onClose })
  }

  return (
    <Modal title="Tạo bình chọn" onClose={onClose}>
      {(error || create.error) && <FormAlert>{error ?? describeChatError(create.error)}</FormAlert>}
      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Câu hỏi"
          name="question"
          value={question}
          maxLength={200}
          autoFocus
          placeholder="Đặt câu hỏi bình chọn"
          onChange={(e) => {
            setQuestion(e.target.value)
            setError(undefined)
          }}
        />
        <fieldset className="member-fieldset">
          <legend>Các lựa chọn</legend>
          {options.map((o, i) => (
            <div key={i} className="poll-option-input">
              <TextField
                label={`Lựa chọn ${i + 1}`}
                name={`option-${i}`}
                value={o}
                maxLength={100}
                placeholder={`Lựa chọn ${i + 1}`}
                onChange={(e) => {
                  setOption(i, e.target.value)
                  setError(undefined)
                }}
              />
              {options.length > 2 && (
                <button type="button" className="icon-btn" aria-label={`Bỏ lựa chọn ${i + 1}`} onClick={() => setOptions((list) => list.filter((_, j) => j !== i))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {options.length < MAX_POLL_OPTIONS && (
            <button type="button" className="link-btn poll-add-option" onClick={() => setOptions((list) => [...list, ''])}>
              + Thêm lựa chọn
            </button>
          )}
        </fieldset>
        <label className="checkbox-row">
          <input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} />
          Cho phép chọn nhiều phương án
        </label>
        <button type="submit" className="btn-primary" disabled={create.isPending}>
          {create.isPending ? 'Đang tạo…' : 'Tạo bình chọn'}
        </button>
      </form>
    </Modal>
  )
}

/** Bình chọn trong khung chat: bấm để chọn / bỏ chọn, thanh tỉ lệ, rê chuột xem ai đã chọn. */
export function PollCard(props: { poll: Poll; selfId: string; members: readonly UserSummary[]; disabled?: boolean }) {
  const { poll, selfId, members, disabled } = props
  const vote = useVote()
  const mine = poll.options.filter((o) => o.voters.includes(selfId)).map((o) => o.id)
  const voters = new Set(poll.options.flatMap((o) => o.voters))
  const nameOf = (id: string) => (id === selfId ? 'Bạn' : (members.find((m) => m.id === id)?.displayName ?? 'Ai đó'))

  const toggle = (optionId: string) => {
    const chosen = mine.includes(optionId)
    const next = poll.multiple ? (chosen ? mine.filter((id) => id !== optionId) : [...mine, optionId]) : chosen ? [] : [optionId]
    vote.mutate({ pollId: poll.id, optionIds: next })
  }

  return (
    <div className="poll-card" role="group" aria-label={`Bình chọn: ${poll.question}`}>
      <p className="poll-question">📊 {poll.question}</p>
      <p className="muted small">
        {poll.multiple ? 'Chọn được nhiều phương án' : 'Chọn một phương án'} · {voters.size} người đã bình chọn
      </p>
      <ul className="poll-options">
        {poll.options.map((o) => {
          const chosen = mine.includes(o.id)
          const percent = voters.size ? Math.round((o.voters.length / voters.size) * 100) : 0
          return (
            <li key={o.id}>
              <button
                type="button"
                className={`poll-option${chosen ? ' poll-option--chosen' : ''}`}
                role={poll.multiple ? 'checkbox' : 'radio'}
                aria-checked={chosen}
                aria-label={`${o.label}: ${o.voters.length} phiếu`}
                disabled={disabled || vote.isPending}
                onClick={() => toggle(o.id)}
              >
                <span className="poll-option-bar" style={{ width: `${percent}%` }} aria-hidden="true" />
                <span className="poll-option-mark" aria-hidden="true">{chosen ? '✓' : ''}</span>
                <span className="poll-option-label">{o.label}</span>
                <span className="poll-option-count">{o.voters.length}</span>
                {o.voters.length > 0 && (
                  <span className="reaction-who" aria-hidden="true">
                    {o.voters.map(nameOf).join(', ')}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
      {vote.error && <p className="field-error small">{describeChatError(vote.error)}</p>}
    </div>
  )
}
