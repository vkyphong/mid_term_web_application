/** Mã lỗi chung theo contract của dự án. */
export type ErrorCode =
  | 'unauthorized'
  | 'rate_limited'
  | 'invalid_payload'
  | 'forbidden'
  | 'network_error'
  | 'unknown'

/** Lý do chi tiết cho REST auth (xem docs/api/auth.md). */
export type ErrorReason =
  | 'domain_not_allowed'
  | 'email_taken'
  | 'invalid_credentials'
  | 'refresh_invalid'
  | 'banned'
  | 'validation'
  | 'room_name_taken'
  | 'not_found'

export interface FieldIssue {
  field: string
  message: string
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message?: string
    reason?: ErrorReason
    details?: FieldIssue[]
    retryAfter?: number
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly reason?: ErrorReason
  readonly details: FieldIssue[]
  readonly retryAfter?: number

  constructor(status: number, body: ApiErrorBody['error']) {
    super(body.message ?? body.code)
    this.name = 'ApiError'
    this.status = status
    this.code = body.code
    this.reason = body.reason
    this.details = body.details ?? []
    this.retryAfter = body.retryAfter
  }
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'invalid_payload',
  401: 'unauthorized',
  403: 'forbidden',
  409: 'invalid_payload',
  422: 'invalid_payload',
  429: 'rate_limited',
}

/** Chuẩn hoá response lỗi bất kỳ (kể cả body không đúng contract) thành ApiError. */
export async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | undefined
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  if (body?.error?.code) return new ApiError(res.status, body.error)
  return new ApiError(res.status, {
    code: STATUS_TO_CODE[res.status] ?? 'unknown',
    message: res.statusText,
  })
}
