import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSession } from '../hooks'

function FullPageSpinner() {
  return (
    <div className="full-page-center" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Đang kiểm tra phiên đăng nhập…</span>
    </div>
  )
}

/** Chỉ cho vào khi đã đăng nhập; nếu chưa thì về /login và nhớ trang đích. */
export function ProtectedRoute() {
  const { status } = useSession()
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}

/** Trang login/register: đã đăng nhập thì chuyển vào app. */
export function GuestRoute() {
  const { status } = useSession()
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
