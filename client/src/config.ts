const env = import.meta.env

function parseDomains(raw: string | undefined): string[] {
  return (raw ?? 'DQGM.dev')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
}

export const config = {
  appName: 'PulseChat',
  apiBaseUrl: (env.VITE_API_BASE_URL ?? '').replace(/\/$/, ''),
  allowedEmailDomains: parseDomains(env.VITE_ALLOWED_EMAIL_DOMAINS),
  useMockApi: env.VITE_USE_MOCK_API === 'true',
  mockAccessTtlSeconds: Number(env.VITE_MOCK_ACCESS_TTL_SECONDS) || 900,
} as const
