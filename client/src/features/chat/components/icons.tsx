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
