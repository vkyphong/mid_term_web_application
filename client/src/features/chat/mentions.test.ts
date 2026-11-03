import { describe, expect, it } from 'vitest'
import { MENTION_ALL, filterMentionCandidates, insertMention, mentionQueryAt, resolveMentions, splitMentions } from './mentions'

const phong = { id: 'u2', displayName: 'Vòng Phong', email: 'phong@dqgm.dev' }
const an = { id: 'u3', displayName: 'Nguyễn An', email: 'an@dqgm.dev' }
const me = { id: 'u1', displayName: 'Thành Đạt', email: 'dat@dqgm.dev' }
const members = [me, phong, an]

describe('F09 mention', () => {
  it('nhận "@query" trước con trỏ, không nhận email hay "@" giữa từ', () => {
    expect(mentionQueryAt('Chào @Pho', 9)).toEqual({ start: 5, query: 'Pho' })
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQueryAt('mail dat@dqgm', 13)).toBeNull()
    expect(mentionQueryAt('Chào @Phong xong rồi', 20)).toBeNull()
  })

  it('lọc thành viên theo đầu từ, bỏ dấu tiếng Việt, không gợi ý chính mình', () => {
    expect(filterMentionCandidates(members, 'phong', 'u1')).toEqual([phong])
    expect(filterMentionCandidates(members, 'nguyen', 'u1')).toEqual([an])
    expect(filterMentionCandidates(members, 'an', 'u1')).toEqual([an])
    expect(filterMentionCandidates(members, '', 'u1')).toEqual([phong, an])
  })

  it('chèn tên và đặt con trỏ sau dấu cách', () => {
    expect(insertMention('Nhờ @pho xem', 4, 8, phong)).toEqual({ text: 'Nhờ @Vòng Phong  xem', caret: 16 })
  })

  it('chỉ gửi id của người vẫn còn "@Tên" trong nội dung', () => {
    expect(resolveMentions('Nhờ @Vòng Phong xem', [phong, an])).toEqual(['u2'])
    expect(resolveMentions('đã xoá tên', [phong])).toEqual([])
  })

  it('tách "@Tên" để tô màu, giữ nguyên phần còn lại dạng text', () => {
    expect(splitMentions('Nhờ @Vòng Phong và @Thành Đạt <b>x</b>', members)).toEqual([
      { text: 'Nhờ ' },
      { text: '@Vòng Phong', mention: phong },
      { text: ' và ' },
      { text: '@Thành Đạt', mention: me },
      { text: ' <b>x</b>' },
    ])
    expect(splitMentions('không có ai', members)).toEqual([{ text: 'không có ai' }])
  })

  it('bỏ tài khoản bị khoá khỏi gợi ý', () => {
    const locked = { id: 'u4', displayName: 'Phạm Khoá', email: 'k@dqgm.dev', enabled: false }
    expect(filterMentionCandidates([...members, locked], 'pham', 'u1')).toEqual([])
    expect(filterMentionCandidates([...members, locked], '', 'u1')).toEqual([phong, an])
  })

  it('"@All" chỉ có trong kênh, đứng đầu và khớp "all" / "tất cả"', () => {
    expect(filterMentionCandidates(members, '', 'u1', true)).toEqual([MENTION_ALL, phong, an])
    expect(filterMentionCandidates(members, 'al', 'u1', true)).toEqual([MENTION_ALL])
    expect(filterMentionCandidates(members, 'tất', 'u1', true)).toEqual([MENTION_ALL])
    expect(filterMentionCandidates(members, 'phong', 'u1', true)).toEqual([phong])
    expect(filterMentionCandidates([me], '', 'u1', true)).toEqual([])
  })

  it('"@All" gửi ID mọi thành viên đang hoạt động trừ người gửi, tối đa 20, người chọn riêng xếp trước', () => {
    const locked = { id: 'u4', displayName: 'Phạm Khoá', email: 'k@dqgm.dev', enabled: false }
    expect(resolveMentions('@All họp nhé', [MENTION_ALL], [...members, locked], 'u1')).toEqual(['u2', 'u3'])
    expect(resolveMentions('đã xoá', [MENTION_ALL], members, 'u1')).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, displayName: `Người ${i}`, email: '' }))
    const ids = resolveMentions('@Nguyễn An @All', [MENTION_ALL, an], [...many, an], 'u1')
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe('u3')
  })

  it('tô "@All" khi được bật', () => {
    expect(splitMentions('@All họp', members, true)).toEqual([{ text: '@All', mention: MENTION_ALL }, { text: ' họp' }])
    expect(splitMentions('@All họp', members)).toEqual([{ text: '@All họp' }])
  })
})
