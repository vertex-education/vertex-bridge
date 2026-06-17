import type { ReactNode } from 'react'

type AlertVariant = 'success' | 'error' | 'warning' | 'info'

const variantStyles: Record<AlertVariant, string> = {
  success: 'border-[var(--tertiary-green)] bg-[color-mix(in_oklab,var(--tertiary-green)_9%,white)] text-[var(--sea-ink)]',
  error: 'border-red-600 bg-[color-mix(in_oklab,red_6%,white)] text-[var(--sea-ink)]',
  warning: 'border-[var(--vertex-gold)] bg-[color-mix(in_oklab,var(--vertex-gold)_13%,white)] text-[var(--sea-ink)]',
  info: 'border-[var(--vertex-blue)] bg-[color-mix(in_oklab,var(--vertex-blue)_7%,white)] text-[var(--sea-ink)]',
}

export function BrandedAlert({
  variant = 'info',
  title,
  children,
  className = '',
}: {
  variant?: AlertVariant
  title: string
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-xl border-l-4 px-4 py-3 text-sm shadow-sm ${variantStyles[variant]} ${className}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <div className="font-bold text-[var(--vertex-blue)]">{title}</div>
      {children && <div className="mt-1 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">{children}</div>}
    </div>
  )
}
