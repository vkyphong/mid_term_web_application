import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from './features/auth/components/LoginPage'
import { RegisterPage } from './features/auth/components/RegisterPage'
import { GuestRoute, ProtectedRoute } from './features/auth/components/RouteGuards'
import { ChatLayout } from './features/chat/components/ChatLayout'

export default function App() {
  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<ChatLayout />} />
        <Route path="/rooms/:roomId" element={<ChatLayout />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
