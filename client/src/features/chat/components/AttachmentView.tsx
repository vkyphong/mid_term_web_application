import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { chatApi } from '../chatApi'
import { downloadAttachment } from '../downloads'
import { describeChatError } from '../errors'
import { fileKind, formatBytes, type FileKind } from '../uploads'
import type { Attachment } from '../types'

/**
 * F15: ảnh đính kèm được tải bằng Bearer token rồi hiển thị qua blob URL
 * (thẻ <img src> thường không gửi được header xác thực). Blob URL được thu hồi khi không dùng nữa.
 */
function useBlobUrl(attachment: Attachment, enabled: boolean) {
  const blob = useQuery({
    queryKey: ['chat', 'file', attachment.id],
    queryFn: () => chatApi.downloadFile(attachment.url),
    enabled,
    staleTime: Infinity,
    retry: false,
  })
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob.data) return
    const objectUrl = URL.createObjectURL(blob.data)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob.data])
  return { url, error: blob.error, isPending: enabled && blob.isPending }
}

const FILE_ICONS: Record<FileKind, string> = {
  image: '🖼️',
  pdf: '📕',
  word: '📘',
  excel: '📗',
  powerpoint: '📙',
  archive: '🗜️',
  text: '📄',
}


export function AttachmentView({ attachment, pending }: { attachment: Attachment; pending?: boolean }) {
  const isImage = attachment.mediaType.startsWith('image/')
  const image = useBlobUrl(attachment, isImage)
  const [error, setError] = useState<string>()

  const onDownload = () => {
    setError(undefined)
    downloadAttachment(attachment).catch((err) => setError(describeChatError(err)))
  }

  return (
    <div className="attachment">
      {isImage && (
        image.url ? (
          <a href={image.url} target="_blank" rel="noopener noreferrer" title="Mở ảnh gốc">
            <img className="attachment-image" src={image.url} alt={attachment.filename} />
          </a>
        ) : (
          <div className="attachment-placeholder">
            {image.error ? `Không tải được ảnh: ${describeChatError(image.error)}` : 'Đang tải ảnh…'}
          </div>
        )
      )}
      <button type="button" className="attachment-file" onClick={onDownload} disabled={pending}>
        <span aria-hidden="true">{FILE_ICONS[fileKind(attachment.filename, attachment.mediaType)]}</span>
        <span className="attachment-name">{attachment.filename}</span>
        <span className="attachment-size">{formatBytes(attachment.size)}</span>
        <span className="sr-only">Tải xuống</span>
      </button>
      {error && <span className="message-status message-status--failed">{error}</span>}
    </div>
  )
}
