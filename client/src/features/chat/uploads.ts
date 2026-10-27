import { useCallback, useRef, useState } from 'react'
import { chatApi } from './chatApi'
import { describeChatError } from './errors'
import type { Upload } from './types'

/** F15: giới hạn theo contract (BE kiểm tra lại chữ ký file). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',')

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Kiểm tra trước khi upload để báo lỗi sớm; null = hợp lệ. */
export function validateFile(file: File): string | null {
  if (file.size === 0) return 'Tệp rỗng.'
  if (file.size > MAX_UPLOAD_BYTES) return `Tệp ${formatBytes(file.size)} vượt quá giới hạn 5 MB.`
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return 'Chỉ hỗ trợ ảnh JPEG, PNG hoặc tệp PDF.'
  return null
}

export type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; file: File; progress: number }
  | { status: 'done'; file: File; upload: Upload }
  | { status: 'error'; file?: File; error: string }

/** Upload ngay khi chọn file, có tiến trình và huỷ được. */
export function useFileUpload(roomId: string) {
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)

  const start = useCallback(
    (file: File) => {
      abort.current?.abort()
      const invalid = validateFile(file)
      if (invalid) return setState({ status: 'error', file, error: invalid })
      const controller = new AbortController()
      abort.current = controller
      setState({ status: 'uploading', file, progress: 0 })
      chatApi
        .uploadFile(roomId, file, (progress) => {
          if (!controller.signal.aborted) setState({ status: 'uploading', file, progress })
        }, controller.signal)
        .then((upload) => {
          if (!controller.signal.aborted) setState({ status: 'done', file, upload })
        })
        .catch((err) => {
          if (!controller.signal.aborted) setState({ status: 'error', file, error: describeChatError(err) })
        })
    },
    [roomId],
  )

  const clear = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    setState({ status: 'idle' })
  }, [])

  return { state, start, clear }
}
