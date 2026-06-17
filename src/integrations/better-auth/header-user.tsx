import { authClient } from '#/lib/auth-client'
import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, LogOut, Settings, Shield, UserCircle } from 'lucide-react'
import { useState } from 'react'

export default function BetterAuthHeader() {
  const { data: session, isPending } = authClient.useSession()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  if (isPending) {
    return (
      <div className="h-8 w-8 bg-[var(--light-gray)] animate-pulse rounded-full" />
    )
  }

  if (session?.user) {
    const role = (session.user as any).role
    const roleLabel = role === 'admin' 
      ? 'Admin' 
      : role === 'vertex_user' 
        ? 'Vertex Staff' 
        : 'Client'
    
    return (
      <div className="relative flex items-center gap-3">
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-[var(--chip-line)] bg-white px-2 py-1.5 text-left text-[var(--sea-ink)] shadow-sm transition hover:bg-[var(--link-bg-hover)] sm:gap-2 sm:px-2.5"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--vertex-blue)] text-white">
            <UserCircle size={17} strokeWidth={2.4} />
          </span>
          <span className="hidden flex-col pr-1 md:flex">
            <span className="max-w-36 truncate text-sm font-semibold leading-tight">
              {session.user.name}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-[var(--sea-ink-soft)]">
              {roleLabel}
            </span>
          </span>
          <ChevronDown size={15} className="text-[var(--vertex-gray)]" strokeWidth={2.4} />
        </button>

        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-12 z-50 w-[min(16rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-[var(--line)] bg-white py-2 text-sm shadow-xl"
          >
            <div className="border-b border-[var(--line)] px-4 pb-3 pt-2">
              <p className="m-0 truncate font-bold text-[var(--sea-ink)]">{session.user.name}</p>
              <p className="m-0 truncate text-xs text-[var(--sea-ink-soft)]">{session.user.email}</p>
            </div>

            <Link
              to="/user-settings"
              role="menuitem"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-3 px-4 py-2.5 font-semibold text-[var(--sea-ink)] no-underline hover:bg-[var(--foam)]"
            >
              <Settings size={16} strokeWidth={2.3} />
              User Settings
            </Link>

            {role === 'admin' && (
              <Link
                to="/admin-settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 font-semibold text-[var(--sea-ink)] no-underline hover:bg-[var(--foam)]"
              >
                <Shield size={16} strokeWidth={2.3} />
                Admin Settings
              </Link>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={async () => {
                setMenuOpen(false)
                await authClient.signOut()
                navigate({ to: '/login' })
              }}
              className="flex w-full cursor-pointer items-center gap-3 border-0 bg-white px-4 py-2.5 text-left font-semibold text-[var(--sea-ink)] hover:bg-[var(--foam)]"
            >
              <LogOut size={16} strokeWidth={2.3} />
              Sign out
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      to="/login"
      className="inline-flex h-9 items-center rounded-full bg-[var(--vertex-blue)] px-3 text-xs font-semibold text-white no-underline transition hover:bg-[var(--lagoon-deep)] sm:px-4"
    >
      Sign in
    </Link>
  )
}
