import { afterEach, expect, it, vi } from 'vitest'
import { uuid } from './uuid'

afterEach(() => vi.unstubAllGlobals())

it('generates distinct version 4 UUIDs when HTTP LAN has no randomUUID', () => {
  vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) })
  const ids = Array.from({ length: 100 }, uuid)
  expect(new Set(ids).size).toBe(100)
  for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})
