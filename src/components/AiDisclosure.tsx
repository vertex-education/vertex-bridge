import { Sparkles } from 'lucide-react'

const defaultTooltip = 'AI was used to give that response.'

export function AiDisclosure({
  label = defaultTooltip,
  className = '',
}: {
  label?: string
  className?: string
}) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--vertex-blue)_24%,white)] bg-[color-mix(in_oklab,var(--vertex-blue)_8%,white)] text-[var(--vertex-blue)] ${className}`}
      title={label}
      aria-label={label}
      tabIndex={0}
      role="img"
    >
      <Sparkles size={12} aria-hidden="true" />
    </span>
  )
}
