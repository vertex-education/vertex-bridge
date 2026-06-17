import * as React from 'react'
import { cn } from '#/lib/utils'

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]', className)}
      {...props}
    />
  )
}
