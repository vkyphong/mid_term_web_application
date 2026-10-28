import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { LoginPage } from './features/auth/components/LoginPage'
import { RegisterPage } from './features/auth/components/RegisterPage'
import { AdminRoute, GuestRoute, ProtectedRoute } from './features/auth/components/RouteGuards'
import { ChatLayout } from './features/chat/components/ChatLayout'
import { AdminDashboard } from './features/admin/AdminDashboard'
const ProtocolLab = lazy(() => import('./features/lab/ProtocolLab').then((module) => ({ default: module.ProtocolLab })))

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/lab" element={<Suspense fallback={<div className="full-page-center" role="status">Đang tải Protocol Lab…</div>}><ProtocolLab /></Suspense>} />
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<AdminDashboard />} />
        </Route>
        <Route path="/" element={<ChatLayout />} />
        <Route path="/rooms/:roomId" element={<ChatLayout />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
