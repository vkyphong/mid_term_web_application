import { chatApi } from './chatApi'
import type { Attachment } from './types'

/** Tải file đính kèm bằng Bearer token rồi lưu đúng tên gốc (link thường không gắn được token). */
export async function downloadAttachment(attachment: Attachment) {
  const blob = await chatApi.downloadFile(attachment.url)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = attachment.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
