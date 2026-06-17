import { Link } from '@tanstack/react-router'
import { authClient } from '#/lib/auth-client'
import BetterAuthHeader from '../integrations/better-auth/header-user.tsx'

export default function Header() {
  const { data: session } = authClient.useSession()
  const role = session?.user ? (session.user as any).role : null

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] px-2 backdrop-blur-md sm:px-4">
      <nav className="page-wrap flex items-center justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-4 md:gap-6">
            <Link to="/" className="flex min-w-0 items-center gap-2 no-underline sm:gap-3">
              <img
                src="/brand/vertex-horizontal.svg"
                alt="Vertex Education"
                className="h-4 w-auto max-w-[8rem] flex-shrink-0 sm:h-6 sm:max-w-none"
              />
              <div className="flex min-w-0 flex-col border-l border-[var(--chip-line)] pl-2 sm:pl-3">
                <span className="truncate font-display text-xs font-black uppercase leading-tight tracking-[0.08em] text-[var(--vertex-blue)] sm:text-sm">
                  Vertex Bridge
                </span>
                <span className="hidden text-[9px] font-semibold uppercase leading-none tracking-[0.18em] text-[var(--vertex-gray)] sm:block">
                  Education Onboarding
                </span>
              </div>
            </Link>

            {/* Navigation Links based on role */}
            <div className="hidden items-center gap-6 text-sm font-semibold md:flex">
              {role === 'admin' && (
                <>
                  <Link to="/admin" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    School Invites
                  </Link>
                  <Link to="/vertex-dashboard" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    Onboarding Dashboard
                  </Link>
                  <Link to="/admin-integrations" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    Integrations
                  </Link>
                  <Link to="/admin-audit-log" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    Audit Log
                  </Link>
                </>
              )}

              {role === 'vertex_user' && (
                <>
                  <Link to="/vertex-dashboard" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    Onboarding Dashboard
                  </Link>
                  <Link to="/admin-audit-log" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                    Audit Log
                  </Link>
                </>
              )}

              {role === 'school_user' && (
                <Link to="/school-onboarding" className="nav-link" activeProps={{ className: 'nav-link is-active' }}>
                  My Onboarding
                </Link>
              )}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <BetterAuthHeader />
        </div>
      </nav>
    </header>
  )
}
