import * as React from 'react'
import { cn } from '#/lib/utils'

export function Input({ className, type = 'text', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-10 w-full rounded-lg border border-[var(--chip-line)] bg-white px-3 py-2 text-sm text-[var(--sea-ink)] shadow-sm transition',
        'placeholder:text-[var(--sea-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vertex-blue)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
