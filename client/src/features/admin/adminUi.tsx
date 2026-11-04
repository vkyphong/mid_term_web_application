import { useEffect, useRef, type ReactNode } from 'react'

export type IconName = 'pulse' | 'users' | 'message' | 'channel' | 'shield' | 'broadcast'

export function Icon({ name }: { name: IconName }) {
  const paths = {
    pulse: 'M3 12h4l3-8 4 16 3-8h4',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    message: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z',
    channel: 'M4 9h16M3 15h16M10 3 8 21M16 3l-2 18',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11ZM9 12l2 2 4-4',
    broadcast: 'M3 10v4h4l12 5V5L7 10H3ZM7 14l2 7h4l-2-5M22 9v6',
  }
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

export function Confirmation({ title, busy, onClose, children, className = '', icon = 'shield' }: { title: string; busy: boolean; onClose: () => void; children: ReactNode; className?: string; icon?: IconName }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current
    dialog?.showModal()
    return () => { dialog?.close(); previous?.focus() }
  }, [])
  return (
    <dialog ref={ref} className={`admin-dialog ${className}`} aria-labelledby="admin-confirm-title" onCancel={(e) => { e.preventDefault(); if (!busy) onClose() }}>
      <div className="admin-dialog-icon"><Icon name={icon} /></div>
      <h2 id="admin-confirm-title">{title}</h2>
      {children}
    </dialog>
  )
}
