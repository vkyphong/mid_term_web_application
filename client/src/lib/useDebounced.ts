import { useEffect, useState } from 'react'

/** Giá trị chỉ cập nhật sau khi ngừng thay đổi `ms` mili giây (vd ô tìm kiếm). */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
