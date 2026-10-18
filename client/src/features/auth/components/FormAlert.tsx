import type { ReactNode } from 'react'

interface FormAlertProps {
  tone?: 'error' | 'info'
  children: ReactNode
}

export function FormAlert({ tone = 'error', children }: FormAlertProps) {
  return (
    <div className={`form-alert form-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  )
}
