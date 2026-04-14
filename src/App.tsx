import { Navigate, Route, Routes } from 'react-router-dom'

import { ProtectedRoute } from '@/components/ProtectedRoute'
import { ThemeSwitcher } from '@/components/ThemeSwitcher'
import AppLayout from '@/layouts/AppLayout'
import { isSupabaseConfigured } from '@/lib/supabase'
import AdminPage from '@/pages/AdminPage'
import GuestListPage from '@/pages/GuestListPage'
import GuestPage from '@/pages/GuestPage'
import HomePage from '@/pages/HomePage'
import LoginPage from '@/pages/LoginPage'
import NotesPage from '@/pages/NotesPage'
import ClosedRoomsPage from '@/pages/ClosedRoomsPage'
import RoomCleaningPage from '@/pages/RoomCleaningPage'
import SummaryPage from '@/pages/SummaryPage'

export default function App() {
  if (!isSupabaseConfigured) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="absolute right-4 top-4 z-10">
          <ThemeSwitcher />
        </div>
        <h1 className="text-xl font-semibold">Нужна конфигурация Supabase</h1>
        <p className="max-w-md text-muted-foreground">
          Скопируйте <code className="rounded bg-muted px-1">.env.example</code> в{' '}
          <code className="rounded bg-muted px-1">.env.local</code> и укажите ключи проекта. Примените
          SQL из <code className="rounded bg-muted px-1">supabase/migrations</code> в SQL Editor.
        </p>
      </div>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="summary" element={<SummaryPage />} />
        <Route path="notes" element={<NotesPage />} />
        <Route path="guests" element={<GuestListPage />} />
        <Route path="closed-rooms" element={<ClosedRoomsPage />} />
        <Route path="room-cleaning" element={<RoomCleaningPage />} />
        <Route path="guest/:guestId" element={<GuestPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
