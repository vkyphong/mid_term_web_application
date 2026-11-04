import { useCallback, useEffect, useRef, useState } from 'react'

/** Vị trí (px từ đỉnh màn hình) mà một mục được coi là "đang xem". */
const ACTIVE_OFFSET = 140

/**
 * Mục đang xem trên menu trái của dashboard: bấm thì sáng ngay, cuộn trang thì tự đổi theo mục ở đầu màn hình.
 * `ids` theo thứ tự xuất hiện; mục đầu tiên là mặc định khi đang ở đầu trang.
 */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0])
  const lockUntil = useRef(0)
  const key = ids.join('|')

  useEffect(() => {
    const list = key.split('|')
    const onScroll = () => {
      // Đang cuộn mượt sau khi bấm: giữ mục vừa chọn (mục cuối trang có thể không chạm được đỉnh màn hình).
      if (Date.now() < lockUntil.current) return
      const doc = document.documentElement
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 2 && window.scrollY > 0) {
        setActive(list[list.length - 1])
        return
      }
      let best = list[0]
      let bestTop = -Infinity
      for (const id of list.slice(1)) {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        if (top !== undefined && top <= ACTIVE_OFFSET && top > bestTop) {
          best = id
          bestTop = top
        }
      }
      setActive(best)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [key])

  const select = useCallback((id: string) => {
    lockUntil.current = Date.now() + 900
    setActive(id)
  }, [])

  return { active, select }
}
