/** Âm báo bằng Web Audio; AudioContext chỉ mở được sau lần tương tác đầu tiên. */

const LAST_KEY = 'pulsechat:sound-last'
const MIN_GAP_MS = 1_200

let context: AudioContext | null = null
let lastPlayed = 0

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

/** Gọi khi người dùng bấm/gõ: tạo hoặc mở lại AudioContext để lần sau phát được. */
export function unlockSound() {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return
  context ??= new Ctor()
  if (context.state === 'suspended') void context.resume()
}

/** Âm "bóp" hai nhịp tự tổng hợp bằng sóng sine. */
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

/** Nhiều tab cùng nhận một tin thì chỉ một tab phát âm báo. */
export function playMessageSound(messageId: string) {
  const run = () => {
    if (storageGet(LAST_KEY) === messageId) return
    storageSet(LAST_KEY, messageId)
    const now = Date.now()
    if (now - lastPlayed < MIN_GAP_MS || !context || context.state !== 'running') return
    lastPlayed = now
    chime(context)
  }
  if (document.visibilityState === 'visible') run()
  else setTimeout(run, 150)
}
