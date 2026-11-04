import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FormAlert } from '../../auth/components/FormAlert'
import { chatApi } from '../chatApi'
import { describeChatError } from '../errors'
import { closeProfile, useOpenProfile } from '../profileViewer'
import { Avatar } from './Avatar'
import { Modal } from './Modal'
import { ProfileDetails } from './ProfileAvatarDialog'

/** Xem hồ sơ đồng nghiệp: thông tin cá nhân chỉ hiện khi họ để công khai. Gắn một lần trong layout chat. */
export function UserProfileHost() {
  const userId = useOpenProfile()
  // Rời màn hình chat (vd đăng xuất) thì đóng hồ sơ đang mở.
  useEffect(() => closeProfile, [])
  const profile = useQuery({
    queryKey: ['chat', 'user-profile', userId],
    queryFn: () => chatApi.getUserProfile(userId!),
    enabled: Boolean(userId),
    // Luôn tải lại khi mở: người kia có thể vừa đổi công khai / riêng tư.
    staleTime: 0,
  })
  if (!userId) return null
  const data = profile.data

  return (
    <Modal title="Thông tin tài khoản" onClose={closeProfile}>
      <div className="profile-card">
        <div className="profile-cover" aria-hidden="true" />
        <div className="profile-head">
          <span className="profile-avatar-static">
            <Avatar name={data?.displayName ?? '…'} userId={userId} size="lg" />
          </span>
          <h3 className="profile-name">{data?.displayName ?? 'Đang tải…'}</h3>
        </div>
        {profile.error && <FormAlert>{describeChatError(profile.error)}</FormAlert>}
        {data && (data.profilePublic || data.self) ? (
          <ProfileDetails profile={data} />
        ) : (
          data && (
            <section className="profile-info" aria-label="Thông tin cá nhân">
              <h4>Thông tin cá nhân</h4>
              <p className="muted">{data.displayName} để thông tin cá nhân ở chế độ riêng tư.</p>
            </section>
          )
        )}
      </div>
    </Modal>
  )
}
