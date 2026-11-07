import { describe, expect, it } from 'vitest'
import { splitLinks } from './links'

describe('splitLinks', () => {
  it('tách link http(s) và www., bỏ dấu câu dính cuối', () => {
    expect(splitLinks('Xem https://youtu.be/MYnmsE6VFzg?si=mnstuYQ181iC6qq- nhé.')).toEqual([
      { text: 'Xem ' },
      { text: 'https://youtu.be/MYnmsE6VFzg?si=mnstuYQ181iC6qq-', href: 'https://youtu.be/MYnmsE6VFzg?si=mnstuYQ181iC6qq-' },
      { text: ' nhé.' },
    ])
    expect(splitLinks('Tài liệu: www.example.com/a, rồi họp.')).toEqual([
      { text: 'Tài liệu: ' },
      { text: 'www.example.com/a', href: 'https://www.example.com/a' },
      { text: ', rồi họp.' },
    ])
  })

  it('giữ ")" khi link có "(" cân bằng; bỏ ")" của câu', () => {
    expect(splitLinks('(xem https://vi.wikipedia.org/wiki/A_(B))')[1]).toEqual({
      text: 'https://vi.wikipedia.org/wiki/A_(B)', href: 'https://vi.wikipedia.org/wiki/A_(B)',
    })
  })

  it('không biến chữ thường hay giao thức lạ thành link', () => {
    expect(splitLinks('file a.b và javascript:alert(1)')).toEqual([{ text: 'file a.b và javascript:alert(1)' }])
    expect(splitLinks('chỉ có https:// thôi')).toEqual([{ text: 'chỉ có https:// thôi' }])
  })
})
