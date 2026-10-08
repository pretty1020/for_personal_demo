type Props = {
  className?: string
  alt?: string
}

/** Movate brand mark (gradient M icon). */
export function MovateLogo({ className = 'movate-brand-mark__img', alt = 'Movate' }: Props) {
  return <img src="/movate-logo.png" alt={alt} className={className} width={40} height={40} />
}
