/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_ALLOWED_EMAIL_DOMAINS?: string
  readonly VITE_USE_MOCK_API?: string
  readonly VITE_MOCK_ACCESS_TTL_SECONDS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
