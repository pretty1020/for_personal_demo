type Props = {
  className?: string
  alt?: string
}

/** Mark shown beside the product name. */
export function MovateLogo({ className = 'movate-brand-mark__img', alt = 'Capacity Plan' }: Props) {
  return (
    <svg viewBox="0 0 36 36" className={className} role="img" aria-label={alt} width={40} height={40}>
      <rect width="36" height="36" rx="4" fill="#1c1915" />
      <path d="M8 27V18h3.2v9H8zm8.2 0V13h3.2v14h-3.2zm8.2 0V9h3.2v18h-3.2z" fill="#f7f3ec" />
      <rect x="8" y="28.2" width="19.6" height="1.4" fill="#8c7348" />
    </svg>
  )
}
