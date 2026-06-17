import { Link } from '@tanstack/react-router'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="mt-14 border-t border-[var(--line)] bg-white/55 px-4 pb-8 pt-8 text-[var(--sea-ink-soft)] backdrop-blur-sm sm:mt-20 sm:pb-10 sm:pt-10">
      <div className="page-wrap flex flex-col items-center justify-between gap-4 text-center sm:flex-row sm:text-left">
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
          <img src="/brand/vertex-horizontal.svg" alt="Vertex Education" className="h-5 w-auto" />
          <p className="m-0 text-sm font-semibold">
            &copy; {year} Vertex Education. All rights reserved.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 sm:items-end">
          <Link
            to="/security-privacy"
            className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--vertex-blue)] no-underline hover:text-[var(--lagoon-deep)]"
          >
            Security & Privacy
          </Link>
          <p className="island-kicker m-0 text-xs">
            Vertex Bridge &bull; Onboarding Portal MVP
          </p>
        </div>
      </div>
    </footer>
  )
}
