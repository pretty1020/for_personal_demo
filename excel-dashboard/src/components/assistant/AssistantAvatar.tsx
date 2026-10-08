type Props = {
  size?: 'sm' | 'md' | 'lg'
}

/** Chart mark for the AI assistant. */
export function AssistantAvatar({ size = 'md' }: Props) {
  return (
    <span className={`ai-analyst-avatar ai-analyst-avatar--${size}`} aria-hidden>
      <svg viewBox="0 0 48 48" className="ai-analyst-avatar__icon" role="img" aria-label="AI Assistant">
        <rect width="48" height="48" fill="#1c1915" />
        <path d="M9 37.25h30" stroke="#8c7348" strokeWidth="1.25" />
        <rect x="12" y="27" width="3.5" height="8.5" fill="#f7f3ec" />
        <rect x="18.25" y="22" width="3.5" height="13.5" fill="#f7f3ec" />
        <rect x="24.5" y="16.5" width="3.5" height="19" fill="#e7eee9" />
        <rect x="30.75" y="11" width="3.5" height="24.5" fill="#8c7348" />
        <path
          d="M13.2 25.2 20 20.2l6.4-4.2 7.6-5.4"
          fill="none"
          stroke="#f7f3ec"
          strokeWidth="1.15"
          strokeLinejoin="round"
        />
        <circle cx="13.2" cy="25.2" r="1.15" fill="#f7f3ec" />
        <circle cx="20" cy="20.2" r="1.15" fill="#f7f3ec" />
        <circle cx="26.4" cy="16" r="1.15" fill="#f7f3ec" />
        <circle cx="34" cy="10.6" r="1.15" fill="#8c7348" />
      </svg>
    </span>
  )
}
