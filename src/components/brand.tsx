export function BrandMark({ className = 'size-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <rect width="48" height="48" rx="14" fill="currentColor" className="text-primary" />
      <path
        d="M16 14h16l-1.6 8.2a8.2 8.2 0 0 1-4.2 6.1L24 30.2l-2.2-1.9a8.2 8.2 0 0 1-4.2-6.1L16 14z"
        fill="none"
        stroke="oklch(0.2 0.03 55)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M24 30.5V36" stroke="oklch(0.2 0.03 55)" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 36h10" stroke="oklch(0.2 0.03 55)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
