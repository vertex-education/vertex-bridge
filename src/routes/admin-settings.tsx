import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getServerRequest } from '#/lib/security'

const getAdminSettingsAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  return {
    isSignedIn: Boolean(session?.user),
    isAdmin: (session?.user as any)?.role === 'admin',
  }
})

export const Route = createFileRoute('/admin-settings')({
  beforeLoad: async ({ location }) => {
    const access = await getAdminSettingsAccess()

    if (!access.isSignedIn) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    if (!access.isAdmin) {
      throw redirect({
        to: '/vertex-dashboard',
      })
    }
  },
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-standard page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">
            Admin Settings
          </div>
          <h1 className="page-title">
            Administration
          </h1>
        </div>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <h2 className="mb-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
            Admin Tools
          </h2>
          <p className="mb-6 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Manage administrative workflows for Vertex Bridge. Account-level password changes now live under User Settings.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/admin"
              className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--foam)]"
            >
              School Invites
              <span className="mt-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Create school, staff, and admin invitations.
              </span>
            </Link>
            <Link
              to="/admin-users"
              className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--foam)]"
            >
              User Accounts
              <span className="mt-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Change existing user names and roles in the database.
              </span>
            </Link>
            <Link
              to="/vertex-dashboard"
              className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--foam)]"
            >
              Onboarding Dashboard
              <span className="mt-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Review progress, uploads, and nudges.
              </span>
            </Link>
            <Link
              to="/admin-integrations"
              className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--foam)]"
            >
              Integrations
              <span className="mt-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Configure Asana OAuth and demo HubSpot status.
              </span>
            </Link>
            <Link
              to="/admin-audit-log"
              className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:-translate-y-0.5 hover:bg-[var(--foam)]"
            >
              Audit Log
              <span className="mt-1 block text-xs font-semibold text-[var(--sea-ink-soft)]">
                Review admin actions, Vertex workflow events, and VertexAI searches.
              </span>
            </Link>
          </div>
        </section>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <h2 className="mb-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
            Account Settings
          </h2>
          <p className="mb-4 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Password reset and profile details are available from User Settings.
          </p>
          <Link
            to="/user-settings"
            className="inline-flex w-full justify-center rounded-full bg-[var(--vertex-blue)] px-5 py-2.5 text-sm font-bold text-white no-underline transition hover:bg-[var(--lagoon-deep)] sm:w-auto"
          >
            Open User Settings
          </Link>
        </section>
      </div>
    </main>
  )
}
