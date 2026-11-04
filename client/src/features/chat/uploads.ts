import { useCallback, useRef, useState } from 'react'
import { chatApi } from './chatApi'
import { describeChatError } from './errors'
import type { Upload } from './types'

/** F15: giới hạn theo docs/api/groups-members-files.md (BE kiểm tra lại chữ ký/cấu trúc file). */
/** Khớp mặc định của BE (`UPLOAD_MAX_FILE_SIZE`, 100 MB); BE vẫn là nơi quyết định cuối. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '100 MB'
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const
/**
 * Kiểm tra theo đuôi file chứ không theo `file.type`: trình duyệt trên Windows báo CSV là
 * application/vnd.ms-excel và ZIP là application/x-zip-compressed; BE tự xác định MIME.
 */
export const ACCEPTED_EXTENSIONS = [...IMAGE_EXTENSIONS, '.pdf', '.txt', '.csv', '.docx', '.xlsx', '.pptx', '.zip'] as const
export const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',')
export const IMAGE_ACCEPT_ATTR = IMAGE_EXTENSIONS.join(',')
export const ACCEPTED_LABEL = 'ảnh JPG/PNG, PDF, TXT, CSV, Word, Excel, PowerPoint hoặc ZIP'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot).toLowerCase()
}

/** Kiểm tra trước khi upload để báo lỗi sớm; null = hợp lệ. */
export function validateFile(file: File, imagesOnly = false): string | null {
  if (file.size === 0) return 'Tệp rỗng.'
  if (file.size > MAX_UPLOAD_BYTES) return `Tệp ${formatBytes(file.size)} vượt quá giới hạn ${MAX_UPLOAD_LABEL}.`
  const allowed: readonly string[] = imagesOnly ? IMAGE_EXTENSIONS : ACCEPTED_EXTENSIONS
  if (!allowed.includes(extensionOf(file.name))) {
    return imagesOnly ? 'Chỉ gửi được ảnh JPG hoặc PNG.' : `Chỉ hỗ trợ ${ACCEPTED_LABEL}.`
  }
  return null
}

export type FileKind = 'image' | 'pdf' | 'word' | 'excel' | 'powerpoint' | 'archive' | 'text'

/** Loại file để chọn biểu tượng; ưu tiên MIME do BE xác định. */
export function fileKind(filename: string, mediaType: string): FileKind {
  if (mediaType.startsWith('image/')) return 'image'
  const ext = extensionOf(filename)
  if (mediaType === 'application/pdf' || ext === '.pdf') return 'pdf'
  if (mediaType.includes('wordprocessingml') || ext === '.docx') return 'word'
  if (mediaType.includes('spreadsheetml') || ext === '.xlsx' || ext === '.csv') return 'excel'
  if (mediaType.includes('presentationml') || ext === '.pptx') return 'powerpoint'
  if (mediaType === 'application/zip' || ext === '.zip') return 'archive'
  return 'text'
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
    (file: File, imagesOnly = false) => {
      abort.current?.abort()
      const invalid = validateFile(file, imagesOnly)
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
