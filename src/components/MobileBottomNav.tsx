import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Bot, ClipboardList, FileText, LayoutDashboard, ScrollText, Settings, UserCog, UserPlus, UsersRound } from 'lucide-react'
import { authClient } from '#/lib/auth-client'

const mobileNavLinkClass =
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-[10px] font-extrabold uppercase leading-tight text-[var(--sea-ink-soft)] no-underline'
const mobileNavActiveClass =
  'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg bg-[color-mix(in_oklab,var(--vertex-blue)_10%,white)] px-2 py-2 text-[10px] font-extrabold uppercase leading-tight text-[var(--vertex-blue)] no-underline'

function openVertexAI() {
  if (typeof window === 'undefined') return
  window.sessionStorage.setItem('vertex-bridge:open-ai-chat', 'true')
  window.dispatchEvent(new Event('vertex-bridge:open-ai-chat'))
}

export default function MobileBottomNav() {
  const { data: session } = authClient.useSession()
  const [staffUnreadCount, setStaffUnreadCount] = useState(0)
  const role = session?.user ? (session.user as any).role : null
  const isSchoolRole = role === 'school_leader' || role === 'school_staff' || role === 'school_user'

  useEffect(() => {
    if (typeof window === 'undefined') return

    const readStoredCount = () => {
      const stored = Number(window.localStorage.getItem('vertex-bridge:staff-unread-count') || '0')
      setStaffUnreadCount(Number.isFinite(stored) ? Math.max(stored, 0) : 0)
    }

    const handleUnreadCount = (event: Event) => {
      const detail = (event as CustomEvent<{ count?: number }>).detail
      if (typeof detail?.count === 'number') {
        setStaffUnreadCount(Math.max(detail.count, 0))
      } else {
        readStoredCount()
      }
    }

    readStoredCount()
    window.addEventListener('vertex-bridge:staff-unread-count', handleUnreadCount)
    return () => window.removeEventListener('vertex-bridge:staff-unread-count', handleUnreadCount)
  }, [])

  if (!role) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[var(--surface-strong)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 shadow-[0_-12px_32px_rgba(0,56,101,0.12)] backdrop-blur-md md:hidden">
      <nav className="mx-auto flex max-w-md items-center gap-2" aria-label="Mobile role navigation">
        {role === 'admin' && (
          <>
            <Link to="/admin" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <UserPlus size={18} aria-hidden="true" />
              <span>Invites</span>
            </Link>
            <Link to="/vertex-dashboard" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <LayoutDashboard size={18} aria-hidden="true" />
              <span>Dashboard</span>
            </Link>
            <Link to="/admin-users" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <UsersRound size={18} aria-hidden="true" />
              <span>Users</span>
            </Link>
            <Link to="/admin-settings" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <UserCog size={18} aria-hidden="true" />
              <span>Admin</span>
            </Link>
            <Link to="/admin-audit-log" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <ScrollText size={18} aria-hidden="true" />
              <span>Audit</span>
            </Link>
          </>
        )}
        {role === 'vertex_user' && (
          <>
            <Link to="/vertex-dashboard" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <LayoutDashboard size={18} aria-hidden="true" />
              <span>Dashboard</span>
            </Link>
            <Link to="/user-settings" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <Settings size={18} aria-hidden="true" />
              <span>Settings</span>
            </Link>
            <Link to="/admin-audit-log" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <ScrollText size={18} aria-hidden="true" />
              <span>Audit</span>
            </Link>
          </>
        )}
        {isSchoolRole && (
          <>
            <Link to="/school-onboarding" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <ClipboardList size={18} aria-hidden="true" />
              <span>Journey</span>
            </Link>
            <Link to="/my-submissions" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <FileText size={18} aria-hidden="true" />
              <span>Files</span>
            </Link>
            <Link
              to="/school-onboarding"
              onClick={openVertexAI}
              className={mobileNavLinkClass}
              activeProps={{ className: mobileNavLinkClass }}
            >
              <span className="relative inline-flex">
                <Bot size={18} aria-hidden="true" />
                {staffUnreadCount > 0 && (
                  <span className="absolute -right-2.5 -top-2.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-black leading-none text-white shadow-lg ring-2 ring-white">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--vertex-gold)] opacity-55" aria-hidden="true" />
                    <span className="relative">{staffUnreadCount}</span>
                  </span>
                )}
              </span>
              <span>Get Help</span>
            </Link>
          </>
        )}
      </nav>
    </div>
  )
}
