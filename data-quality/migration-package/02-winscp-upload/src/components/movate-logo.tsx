import Image from "next/image";

type Props = {
  className?: string;
  alt?: string;
  size?: number;
};

/** Movate brand mark (gradient M icon). */
export function MovateLogo({ className = "h-9 w-9 object-contain", alt = "Movate", size = 36 }: Props) {
  return (
    <Image
      src="/movate-logo.png"
      alt={alt}
      width={size}
      height={size}
      className={className}
      priority
    />
  );
}
