import { useNavigate, useParams } from 'react-router-dom'

import { GuestDetailPanel } from '@/components/GuestDetailPanel'

export default function GuestPage() {
  const navigate = useNavigate()
  const { guestId } = useParams<{ guestId: string }>()
  return (
    <GuestDetailPanel guestId={guestId} layout="page" onNavigateHome={() => navigate('/')} />
  )
}
