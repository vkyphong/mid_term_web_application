import '@testing-library/jest-dom/vitest'

// Node 24 có sẵn `localStorage` thử nghiệm (undefined khi không có --localstorage-file), che mất
// bản của jsdom nên test dùng localStorage lỗi trên máy dev. CI chạy Node 22 không bị; bù bằng bản trong bộ nhớ.
if (typeof globalThis.localStorage === 'undefined' || globalThis.localStorage === null) {
  const data = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
}
