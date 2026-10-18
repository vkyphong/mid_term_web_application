import type { ReactNode } from 'react'
import { config } from '../../../config'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: ReactNode
  footer: ReactNode
}

export function AuthLayout({ title, subtitle, children, footer }: AuthLayoutProps) {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="brand">
          <span className="brand-dot" aria-hidden="true" />
          {config.appName}
        </div>
        <h1 id="auth-title">{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
        <p className="auth-footer">{footer}</p>
      </section>
    </main>
  )
}
