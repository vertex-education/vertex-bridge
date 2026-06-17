import * as React from 'react'
import { cn } from '#/lib/utils'

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm'
}

export function Button({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-bold transition disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vertex-blue)] focus-visible:ring-offset-2',
        variant === 'default' && 'bg-[var(--vertex-blue)] text-white shadow-sm hover:bg-[var(--lagoon-deep)]',
        variant === 'outline' && 'border border-[var(--chip-line)] bg-white text-[var(--sea-ink)] hover:bg-[var(--link-bg-hover)]',
        variant === 'ghost' && 'bg-transparent text-[var(--sea-ink)] hover:bg-[var(--link-bg-hover)]',
        size === 'default' && 'h-10 px-4 py-2',
        size === 'sm' && 'h-8 px-3 py-1.5 text-xs',
        className,
      )}
      {...props}
    />
  )
}
