type Props = {
  className?: string;
  alt?: string;
  size?: number;
};

/** Small mark used beside the product name. */
export function MovateLogo({ className = "h-9 w-9 object-contain", alt = "Data Quality", size = 36 }: Props) {
  return (
    <svg
      viewBox="0 0 36 36"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={alt}
    >
      <rect width="36" height="36" rx="4" fill="#1c1915" />
      <path d="M8 27V18h3.2v9H8zm8.2 0V13h3.2v14h-3.2zm8.2 0V9h3.2v18h-3.2z" fill="#f7f3ec" />
      <rect x="8" y="28.2" width="19.6" height="1.4" fill="#8c7348" />
    </svg>
  );
}
