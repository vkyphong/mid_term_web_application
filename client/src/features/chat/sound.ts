import { useSyncExternalStore } from 'react'

/**
 * Âm báo tin nhắn mới, tạo bằng Web Audio (không cần file âm thanh). Trình duyệt chỉ cho phát âm
 * thanh sau khi người dùng đã tương tác với trang, nên AudioContext được mở ở lần bấm/gõ đầu tiên.
 */

const MUTE_KEY = 'pulsechat:sound-muted'
const LAST_KEY = 'pulsechat:sound-last'
const MIN_GAP_MS = 1_200

let context: AudioContext | null = null
let lastPlayed = 0
const listeners = new Set<() => void>()

function storageGet(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* chế độ riêng tư: bỏ qua */
  }
}

export function isSoundMuted() {
  return storageGet(MUTE_KEY) === '1'
}

export function setSoundMuted(muted: boolean) {
  storageSet(MUTE_KEY, muted ? '1' : '0')
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key === MUTE_KEY && listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useSoundMuted() {
  return useSyncExternalStore(subscribe, isSoundMuted)
}

/** Gọi khi người dùng bấm/gõ: tạo hoặc mở lại AudioContext để lần sau phát được. */
export function unlockSound() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  context ??= new Ctor()
  if (context.state === 'suspended') void context.resume()
}

/**
 * Tiếng "bóp" hai nhịp kiểu Messenger, tự tổng hợp (không dùng file âm thanh có bản quyền):
 * mỗi nhịp là sóng sine trượt cao độ lên nhanh, bật tức thì rồi tắt dần như bong bóng vỡ.
 */
function chime(ctx: AudioContext) {
  const start = ctx.currentTime
  const blips: [delay: number, from: number, to: number][] = [
    [0, 520, 880],
    [0.095, 780, 1260],
  ]
  for (const [delay, from, to] of blips) {
    const at = start + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(from, at)
    osc.frequency.exponentialRampToValueAtTime(to, at + 0.06)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.32, at + 0.006)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.16)
  }
}

/**
 * Phát âm báo cho một tin. Nhiều tab cùng nhận một tin thì chỉ một tab kêu: tab đang hiển thị
 * giành trước, tab ẩn chờ một chút rồi kiểm tra ID tin đã phát (lưu ở localStorage).
 */
export function playMessageSound(messageId: string) {
  const run = () => {
    if (isSoundMuted() || storageGet(LAST_KEY) === messageId) return
    storageSet(LAST_KEY, messageId)
    const now = Date.now()
    if (now - lastPlayed < MIN_GAP_MS || !context || context.state !== 'running') return
    lastPlayed = now
    chime(context)
  }
  if (document.visibilityState === 'visible') run()
  else setTimeout(run, 150)
}
