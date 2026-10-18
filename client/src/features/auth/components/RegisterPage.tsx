import { useState, type ChangeEvent, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { config } from '../../../config'
import { describeAuthError } from '../errors'
import { useRegister } from '../hooks'
import { clearFieldError, registerSchema, toFieldErrors, type FieldErrors } from '../schemas'
import { AuthLayout } from './AuthLayout'
import { FormAlert } from './FormAlert'
import { TextField } from './TextField'

const initialValues = { email: '', displayName: '', password: '', confirmPassword: '' }

const domainHint = config.allowedEmailDomains.length
  ? `Chỉ chấp nhận email @${config.allowedEmailDomains.join(', @')}`
  : undefined

export function RegisterPage() {
  const navigate = useNavigate()
  const register = useRegister()

  const [values, setValues] = useState(initialValues)
  const [clientErrors, setClientErrors] = useState<FieldErrors>({})

  const serverError = register.error ? describeAuthError(register.error) : null
  const errors = { ...serverError?.fields, ...clientErrors }

  const update = (field: keyof typeof values) => (e: ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [field]: e.target.value }))
    setClientErrors((errs) => clearFieldError(errs, field))
    if (register.error) register.reset()
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const parsed = registerSchema.safeParse(values)
    if (!parsed.success) {
      setClientErrors(toFieldErrors(parsed.error))
      return
    }
    const { email, displayName, password } = parsed.data
    register.mutate(
      { email, displayName, password },
      { onSuccess: () => navigate('/', { replace: true }) },
    )
  }

  return (
    <AuthLayout
      title="Tạo tài khoản"
      subtitle="Chỉ dành cho nhân viên có email công ty."
      footer={
        <>
          Đã có tài khoản? <Link to="/login">Đăng nhập</Link>
        </>
      }
    >
      {serverError && <FormAlert>{serverError.message}</FormAlert>}

      <form onSubmit={onSubmit} noValidate>
        <TextField
          label="Email công ty"
          type="email"
          name="email"
          autoComplete="email"
          value={values.email}
          onChange={update('email')}
          error={errors.email}
          hint={domainHint}
        />
        <TextField
          label="Tên hiển thị"
          name="displayName"
          autoComplete="nickname"
          value={values.displayName}
          onChange={update('displayName')}
          error={errors.displayName}
        />
        <TextField
          label="Mật khẩu"
          type="password"
          name="password"
          autoComplete="new-password"
          value={values.password}
          onChange={update('password')}
          error={errors.password}
          hint="Tối thiểu 8 ký tự, có cả chữ và số."
        />
        <TextField
          label="Xác nhận mật khẩu"
          type="password"
          name="confirmPassword"
          autoComplete="new-password"
          value={values.confirmPassword}
          onChange={update('confirmPassword')}
          error={errors.confirmPassword}
        />
        <button type="submit" className="btn-primary" disabled={register.isPending}>
          {register.isPending ? 'Đang tạo tài khoản…' : 'Đăng ký'}
        </button>
      </form>
    </AuthLayout>
  )
}
