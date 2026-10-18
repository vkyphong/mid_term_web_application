import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthContext } from '../AuthContext'
import { describeAuthError } from '../errors'
import { useLogin } from '../hooks'
import { clearFieldError, loginSchema, toFieldErrors, type FieldErrors } from '../schemas'
import { AuthLayout } from './AuthLayout'
import { FormAlert } from './FormAlert'
import { TextField } from './TextField'

const initialValues = { email: '', password: '' }

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const { sessionExpired, dismissSessionExpired } = useAuthContext()
  const login = useLogin()

  const [values, setValues] = useState(initialValues)
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})

  const serverError = login.error ? describeAuthError(login.error) : null
  const errors = { ...serverError?.fields, ...clientErrors }

  const update = (field: keyof typeof values) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }))
    setClientErrors((errs) => clearFieldError(errs, field))
    if (login.error) login.reset()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = loginSchema.safeParse(values)
    if (!parsed.success) {
      setClientErrors(toFieldErrors(parsed.error))
      return
    }
    dismissSessionExpired()
    login.mutate(parsed.data, { onSuccess: () => navigate(from, { replace: true }) })
  }

  return (
    <AuthLayout
      title="Đăng nhập"
      subtitle="Dùng email công ty để tiếp tục."
      footer={
        <>
          Chưa có tài khoản? <Link to="/register">Đăng ký</Link>
        </>
      }
    >
      {sessionExpired && !serverError && (
        <FormAlert tone="info">Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.</FormAlert>
      )}
      {serverError && <FormAlert>{serverError.message}</FormAlert>}

      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          value={values.email}
          onChange={update('email')}
          error={errors.email}
        />
        <TextField
          label="Mật khẩu"
          type="password"
          name="password"
          autoComplete="current-password"
          value={values.password}
          onChange={update('password')}
          error={errors.password}
        />
        <button type="submit" className="btn-primary" disabled={login.isPending}>
          {login.isPending ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </AuthLayout>
  )
}
