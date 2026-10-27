import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { chatApi } from '../chatApi'
import { describeChatError } from '../errors'
import { formatBytes } from '../uploads'
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

async function download(attachment: Attachment) {
  const blob = await chatApi.downloadFile(attachment.url)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = attachment.filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

export function AttachmentView({ attachment, pending }: { attachment: Attachment; pending?: boolean }) {
  const isImage = attachment.mediaType.startsWith('image/')
  const image = useBlobUrl(attachment, isImage)
  const [error, setError] = useState<string>()

  const onDownload = () => {
    setError(undefined)
    download(attachment).catch((err) => setError(describeChatError(err)))
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
        <span aria-hidden="true">{isImage ? '🖼️' : '📄'}</span>
        <span className="attachment-name">{attachment.filename}</span>
        <span className="attachment-size">{formatBytes(attachment.size)}</span>
        <span className="sr-only">Tải xuống</span>
      </button>
      {error && <span className="message-status message-status--failed">{error}</span>}
    </div>
  )
}
