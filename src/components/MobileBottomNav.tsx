import { Link } from '@tanstack/react-router'
import { Bot, ClipboardList, LayoutDashboard, ScrollText, Settings, UserCog, UserPlus } from 'lucide-react'
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
  const role = session?.user ? (session.user as any).role : null

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
        {role === 'school_user' && (
          <>
            <Link to="/school-onboarding" className={mobileNavLinkClass} activeProps={{ className: mobileNavActiveClass }}>
              <ClipboardList size={18} aria-hidden="true" />
              <span>Onboarding</span>
            </Link>
            <Link
              to="/school-onboarding"
              onClick={openVertexAI}
              className={mobileNavLinkClass}
              activeProps={{ className: mobileNavLinkClass }}
            >
              <Bot size={18} aria-hidden="true" />
              <span>VertexAI</span>
            </Link>
          </>
        )}
      </nav>
    </div>
  )
}
