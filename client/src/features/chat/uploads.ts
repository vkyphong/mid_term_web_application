import { useCallback, useEffect, useRef, useState } from 'react'
import { chatApi } from './chatApi'
import { describeChatError } from './errors'
import type { Upload } from './types'

/** F15: giới hạn theo docs/api/groups-members-files.md (BE kiểm tra lại chữ ký/cấu trúc file). */
/** Khớp mặc định của BE (`UPLOAD_MAX_FILE_SIZE`, 100 MB); BE vẫn là nơi quyết định cuối. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024
export const MAX_UPLOAD_LABEL = '100 MB'
export const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'] as const
/** Kiểm tra theo đuôi file vì MIME trình duyệt báo không ổn định; BE tự xác định MIME. */
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

/** Tối đa ảnh trong một lần gửi (khay ảnh). */
export const MAX_TRAY_IMAGES = 20

export interface TrayImage {
  id: string
  file: File
  /** blob URL để xem trước. */
  preview: string
  status: 'uploading' | 'done' | 'error'
  progress: number
  upload?: Upload
  error?: string
}

let traySeq = 0

/** Khay ảnh chờ gửi: tải lên ngay, mỗi ảnh gửi thành một tin. */
export function useImageTray(roomId: string) {
  const [items, setItems] = useState<TrayImage[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const previews = useRef(new Map<string, string>())

  const patch = (id: string, change: Partial<TrayImage>) =>
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...change } : item)))

  const add = useCallback(
    (files: readonly File[]) => {
      const room = MAX_TRAY_IMAGES - previews.current.size
      for (const file of files.slice(0, Math.max(0, room))) {
        const id = `img-${++traySeq}`
        const preview = URL.createObjectURL(file)
        previews.current.set(id, preview)
        const invalid = validateFile(file, true)
        if (invalid) {
          setItems((list) => [...list, { id, file, preview, status: 'error', progress: 0, error: invalid }])
          continue
        }
        const controller = new AbortController()
        controllers.current.set(id, controller)
        setItems((list) => [...list, { id, file, preview, status: 'uploading', progress: 0 }])
        chatApi
          .uploadFile(roomId, file, (progress) => !controller.signal.aborted && patch(id, { progress }), controller.signal)
          .then((upload) => !controller.signal.aborted && patch(id, { status: 'done', upload, progress: 1 }))
          .catch((err) => !controller.signal.aborted && patch(id, { status: 'error', error: describeChatError(err) }))
          .finally(() => controllers.current.delete(id))
      }
    },
    [roomId],
  )

  const remove = useCallback((id: string) => {
    controllers.current.get(id)?.abort()
    controllers.current.delete(id)
    const preview = previews.current.get(id)
    if (preview) URL.revokeObjectURL(preview)
    previews.current.delete(id)
    setItems((list) => list.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => {
    controllers.current.forEach((c) => c.abort())
    controllers.current.clear()
    previews.current.forEach((url) => URL.revokeObjectURL(url))
    previews.current.clear()
    setItems([])
  }, [])

  // Rời phòng thì huỷ upload đang chạy và giải phóng ảnh xem trước.
  useEffect(() => clear, [clear])

  return { items, add, remove, clear }
}

/** Ảnh dán đổi sang PNG (server chỉ nhận JPG / PNG), tên "anh-dan-<giờ>.png". */
export async function normalizePastedImage(file: File, index = 0): Promise<File> {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const name = `anh-dan-${stamp}${index ? `-${index + 1}` : ''}`
  if (file.type === 'image/png' || file.type === 'image/jpeg') {
    const ext = file.type === 'image/png' ? '.png' : '.jpg'
    return /\.(png|jpe?g)$/i.test(file.name) && file.name !== 'image.png' ? file : new File([file], name + ext, { type: file.type })
  }
  if (typeof createImageBitmap !== 'function') return file
  const bitmap = await createImageBitmap(file)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  return blob ? new File([blob], `${name}.png`, { type: 'image/png' }) : file
}
