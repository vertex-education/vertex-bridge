import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { authClient } from '#/lib/auth-client'
import { BrandedAlert } from '#/components/BrandedAlert'
import { getServerRequest } from '#/lib/security'

const getUserSettingsAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  return {
    isSignedIn: Boolean(session?.user),
  }
})

const resetCurrentUserPassword = createServerFn({ method: 'POST' })
  .validator((data: { newPassword: string }) => data)
  .handler(async ({ data }) => {
    const { auth } = await import('#/lib/auth')
    const { db } = await import('#/db')
    const { account } = await import('#/db/schema')
    const { eq, and } = await import('drizzle-orm')
    const { hashPassword } = await import('@better-auth/utils/password')

    const request = await getServerRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user) {
      throw new Error('You must be signed in to reset your password.')
    }

    const newPassword = data.newPassword.trim()
    if (newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters.')
    }

    const password = await hashPassword(newPassword)
    const now = new Date()
    const userId = session.user.id
    const existingAccount = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'credential')))
      .get()

    if (existingAccount) {
      await db
        .update(account)
        .set({
          accountId: userId,
          password,
          updatedAt: now,
        })
        .where(eq(account.id, existingAccount.id))
        .run()
    } else {
      await db
        .insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: userId,
          providerId: 'credential',
          userId,
          password,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    return { success: true }
  })

export const Route = createFileRoute('/user-settings')({
  beforeLoad: async ({ location }) => {
    const access = await getUserSettingsAccess()

    if (!access.isSignedIn) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }
  },
  component: UserSettingsPage,
})

function UserSettingsPage() {
  const { data: session } = authClient.useSession()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const role = session?.user ? (session.user as any).role : null
  const roleLabel =
    role === 'admin' ? 'Admin' : role === 'vertex_user' ? 'Vertex Staff' : 'Client'

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await resetCurrentUserPassword({
        data: {
          newPassword,
        },
      })
      setNewPassword('')
      setConfirmPassword('')
      setMessage('Password reset successfully. Use the new password the next time you sign in.')
    } catch (err: any) {
      setError(err.message || 'Failed to reset password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-standard page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">
            User Settings
          </div>
          <h1 className="page-title">
            Account Settings
          </h1>
        </div>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <h2 className="mb-4 font-display text-xl font-bold text-[var(--vertex-blue)]">
            Profile
          </h2>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                Name
              </dt>
              <dd className="m-0 font-semibold text-[var(--sea-ink)]">
                {session?.user?.name || 'Signed-in user'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                Role
              </dt>
              <dd className="m-0 font-semibold text-[var(--sea-ink)]">{roleLabel}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                Email
              </dt>
              <dd className="m-0 font-semibold text-[var(--sea-ink)]">
                {session?.user?.email}
              </dd>
            </div>
          </dl>
        </section>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <h2 className="display-title mb-2 text-xl font-bold text-[var(--vertex-blue)] sm:text-2xl">
            Reset Your Password
          </h2>
          <p className="mb-6 text-sm text-[var(--sea-ink-soft)]">
            Set a new password for your account. The change takes effect immediately for future sign-ins.
          </p>

          {message && (
            <BrandedAlert variant="success" title="Password updated" className="mb-4">
              {message}
            </BrandedAlert>
          )}
          {error && (
            <BrandedAlert variant="error" title="Password reset failed" className="mb-4">
              {error}
            </BrandedAlert>
          )}

          <form onSubmit={handlePasswordReset} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                New Password
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                Confirm New Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full cursor-pointer rounded-xl bg-[var(--vertex-blue)] py-3 font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)] disabled:opacity-50"
            >
              {loading ? 'Resetting Password...' : 'Reset Password'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}
