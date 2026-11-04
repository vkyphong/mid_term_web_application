import type { ReactNode, SVGProps } from 'react'

/** Icon nét cho thanh công cụ soạn tin (theo màu chữ hiện tại). */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const SmileIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8" />
    <path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.6" />
  </Icon>
)

export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.5" />
    <path d="m21 16-5-5-8 8" />
  </Icon>
)

export const PaperclipIcon = () => (
  <Icon>
    <path d="m20.5 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
  </Icon>
)

export const AtIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3.6" />
    <path d="M15.6 8.4v4.8a2.4 2.4 0 0 0 4.8 0V12a8.4 8.4 0 1 0-3.3 6.7" />
  </Icon>
)

export const UserPlusIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M19 8v6M16 11h6" />
  </Icon>
)

export const ThumbsUpIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <path d="M2 10.5A1.5 1.5 0 0 1 3.5 9H6v12H3.5A1.5 1.5 0 0 1 2 19.5v-9ZM8 20.2V9.6l4.4-6.5a1.6 1.6 0 0 1 2.9 1.2L14.6 9h5a2.2 2.2 0 0 1 2.2 2.6l-1.5 7.3A2.6 2.6 0 0 1 17.7 21H9a1 1 0 0 1-1-.8Z" />
  </Icon>
)

export const SendIcon = () => (
  <Icon>
    <path d="M21 3 10 14" />
    <path d="m21 3-6.5 18-4.5-7-7-4.5L21 3Z" />
  </Icon>
)

export const PollIcon = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
  </Icon>
)

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Icon>
)

/** Trả lời (dấu ngoặc kép như Zalo). */
export const QuoteIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <path d="M4 11.5C4 8 6.2 5.6 9.4 5l.6 1.7c-1.9.6-3 1.9-3.2 3.6H9.6c.8 0 1.4.6 1.4 1.4V17c0 .8-.6 1.4-1.4 1.4H5.4C4.6 18.4 4 17.8 4 17v-5.5Zm9 0C13 8 15.2 5.6 18.4 5l.6 1.7c-1.9.6-3 1.9-3.2 3.6h2.8c.8 0 1.4.6 1.4 1.4V17c0 .8-.6 1.4-1.4 1.4h-4.2c-.8 0-1.4-.6-1.4-1.4v-5.5Z" />
  </Icon>
)

/** Chuyển tiếp (mũi tên chia sẻ). */
export const ShareIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <path d="M13.5 5.2a1 1 0 0 1 1.6-.8l6.4 5.6a1.2 1.2 0 0 1 0 1.8l-6.4 5.6a1 1 0 0 1-1.6-.8v-2.9c-4.1.1-6.9 1.4-8.9 4.4-.3.5-1.1.2-1-.4.8-5 3.9-8.6 9.9-9.2V5.2Z" />
  </Icon>
)

export const MoreIcon = () => (
  <Icon fill="currentColor" stroke="none">
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </Icon>
)

/** Thả cảm xúc (ngón cái, viền). */
export const LikeOutlineIcon = () => (
  <Icon>
    <path d="M7 10v10H4.5A1.5 1.5 0 0 1 3 18.5v-7A1.5 1.5 0 0 1 4.5 10H7Zm0 0 4.2-6.2a1.6 1.6 0 0 1 2.9 1.1L13.6 9h5.1a2.2 2.2 0 0 1 2.2 2.6l-1.4 7a2.4 2.4 0 0 1-2.4 2H7" />
  </Icon>
)
