import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq, like, or } from 'drizzle-orm'
import type { FormEvent } from 'react'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BrandedAlert } from '#/components/BrandedAlert'
import { assertTrustedOrigin, getServerRequest, requireAdminSession } from '#/lib/security'

type UserRole = 'school_leader' | 'school_staff' | 'vertex_user' | 'admin'
type AdminUserRow = {
  id: string
  name: string
  email: string
  role: string
  emailVerified: boolean
  createdAt: Date | string
  updatedAt: Date | string
}
type EditUserDraft = {
  id: string
  name: string
  email: string
  role: UserRole
}

const roleOptions: Array<{ value: UserRole; label: string; description: string }> = [
  {
    value: 'school_leader',
    label: 'School Leader',
    description: 'Lead school contact access to assigned onboarding workspaces and school staff coordination.',
  },
  {
    value: 'school_staff',
    label: 'School Staff',
    description: 'School staff access to assigned onboarding tasks and view-only journey context.',
  },
  {
    value: 'vertex_user',
    label: 'Vertex Staff',
    description: 'Internal dashboard and restricted audit log access.',
  },
  {
    value: 'admin',
    label: 'Admin',
    description: 'Full administrative access, including user role changes.',
  },
]

const getAdminUsersAccess = createServerFn({ method: 'GET' }).handler(async () => {
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

const listUsersForAdmin = createServerFn({ method: 'GET' })
  .validator((filters: { query?: string } | undefined) => filters || {})
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { user } = await import('#/db/schema')

    await requireAdminSession()

    const query = data.query?.trim()
    const baseQuery = db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .from(user)

    if (query) {
      return baseQuery
        .where(or(
          like(user.name, `%${query}%`),
          like(user.email, `%${query}%`),
          like(user.role, `%${query}%`),
        ))
        .orderBy(desc(user.updatedAt))
        .limit(100)
        .all()
    }

    return baseQuery
      .orderBy(desc(user.updatedAt))
      .limit(100)
      .all()
  })

const updateUserAccount = createServerFn({ method: 'POST' })
  .validator((data: { userId: string; name: string; email: string; role: UserRole }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { session, user } = await import('#/db/schema')

    await assertTrustedOrigin()
    const adminSession = await requireAdminSession()

    const allowedRoles = new Set<UserRole>(['school_leader', 'school_staff', 'vertex_user', 'admin'])
    if (!allowedRoles.has(data.role)) {
      throw new Error('Select a valid role.')
    }
    const cleanName = data.name.trim()
    if (!cleanName) {
      throw new Error('Name is required.')
    }
    const cleanEmail = data.email.trim().toLowerCase()
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Enter a valid email address.')
    }

    const [targetUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, data.userId))
      .all()

    if (!targetUser) {
      throw new Error('User not found.')
    }

    if (targetUser.id === adminSession.user.id && targetUser.role === 'admin' && data.role !== 'admin') {
      throw new Error('You cannot remove your own admin role from this page.')
    }

    const nameChanged = targetUser.name !== cleanName
    const emailChanged = targetUser.email !== cleanEmail
    const roleChanged = targetUser.role !== data.role

    if (emailChanged) {
      const [existingEmailUser] = await db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, cleanEmail))
        .all()

      if (existingEmailUser && existingEmailUser.id !== targetUser.id) {
        throw new Error('Another user already has that email address.')
      }
    }

    if (!nameChanged && !emailChanged && !roleChanged) {
      return {
        id: targetUser.id,
        previousEmail: targetUser.email,
        email: targetUser.email,
        previousName: targetUser.name,
        name: targetUser.name,
        previousRole: targetUser.role,
        role: targetUser.role,
        nameChanged: false,
        emailChanged: false,
        roleChanged: false,
        changed: false,
      }
    }

    const now = new Date()
    await db
      .update(user)
      .set({
        name: cleanName,
        email: cleanEmail,
        emailVerified: emailChanged ? false : targetUser.emailVerified,
        role: data.role,
        updatedAt: now,
      })
      .where(eq(user.id, targetUser.id))
      .run()

    if (emailChanged || roleChanged) {
      await db
        .delete(session)
        .where(eq(session.userId, targetUser.id))
        .run()
    }

    const { recordAuditEvent } = await import('#/lib/audit')
    await recordAuditEvent({
      session: adminSession,
      request: await getServerRequest(),
      surface: 'admin',
      category: 'admin',
      action: 'user_account_updated',
      message: `${adminSession.user.email} updated ${targetUser.email}.`,
      entityType: 'user',
      entityId: targetUser.id,
      clientEmail: cleanEmail,
      metadata: {
        previousName: targetUser.name,
        name: cleanName,
        previousEmail: targetUser.email,
        email: cleanEmail,
        previousRole: targetUser.role,
        role: data.role,
        nameChanged,
        emailChanged,
        roleChanged,
        emailVerified: emailChanged ? false : targetUser.emailVerified,
        sessionsRevoked: emailChanged || roleChanged,
      },
    })

    return {
      id: targetUser.id,
      previousEmail: targetUser.email,
      email: cleanEmail,
      previousName: targetUser.name,
      name: cleanName,
      previousRole: targetUser.role,
      role: data.role,
      nameChanged,
      emailChanged,
      roleChanged,
      changed: true,
    }
  })

export const Route = createFileRoute('/admin-users')({
  beforeLoad: async ({ location }) => {
    const access = await getAdminUsersAccess()

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
  component: AdminUsersPage,
})

function roleLabel(value: string) {
  if (value === 'school_user') return 'School Leader'
  return roleOptions.find(option => option.value === value)?.label || value
}

function normalizeUserRole(value: string): UserRole {
  if (value === 'school_staff') return 'school_staff'
  if (value === 'vertex_user') return 'vertex_user'
  if (value === 'admin') return 'admin'
  return 'school_leader'
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [appliedQuery, setAppliedQuery] = useState('')
  const [editDraft, setEditDraft] = useState<EditUserDraft | null>(null)
  const [message, setMessage] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)

  const { data: users = [], isLoading, isError } = useQuery({
    queryKey: ['admin-users', appliedQuery],
    queryFn: () => listUsersForAdmin({ data: { query: appliedQuery } }),
  })

  const updateAccountMutation = useMutation({
    mutationFn: (input: { userId: string; name: string; email: string; role: UserRole }) => updateUserAccount({ data: input }),
    onSuccess: (result) => {
      setEditDraft(null)

      const changedParts = [
        result.nameChanged ? 'name' : '',
        result.emailChanged ? 'email' : '',
        result.roleChanged ? 'role' : '',
      ].filter(Boolean).join(' and ')

      setMessage({
        type: result.changed ? 'success' : 'warning',
        title: result.changed ? 'User updated' : 'No change made',
        message: result.changed
          ? `${result.email} ${changedParts} updated.${result.emailChanged || result.roleChanged ? ' Existing sessions for that user were revoked.' : ''}`
          : `${result.email} already had the selected name, email, and role.`,
      })
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
    },
    onError: (err: any) => {
      setMessage({
        type: 'error',
        title: 'User update failed',
        message: err?.message || 'Could not update this user.',
      })
    },
  })

  const userRows = useMemo(() => users, [users])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    setAppliedQuery(query.trim())
  }

  const openEditModal = (row: AdminUserRow) => {
    setMessage(null)
    setEditDraft({
      id: row.id,
      name: row.name,
      email: row.email,
      role: normalizeUserRole(row.role),
    })
  }

  const closeEditModal = () => {
    if (updateAccountMutation.isPending) return
    setEditDraft(null)
  }

  const saveUser = (event: FormEvent) => {
    event.preventDefault()
    if (!editDraft) return
    setMessage(null)
    updateAccountMutation.mutate({
      userId: editDraft.id,
      name: editDraft.name,
      email: editDraft.email,
      role: editDraft.role,
    })
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-wide page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">
            User Administration
          </div>
          <h1 className="page-title">
            User Accounts
          </h1>
          <p className="page-subtitle">
            Search existing accounts and change database names, emails, or roles for Vertex Bridge access.
          </p>
        </div>

        {message && (
          <BrandedAlert variant={message.type} title={message.title}>
            {message.message}
          </BrandedAlert>
        )}

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <form onSubmit={handleSearch} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="text-sm font-bold text-[var(--sea-ink)]">
              Search users
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, email, or role"
                className="mt-2 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--sea-ink)] outline-none transition focus:border-[var(--vertex-blue)] focus:ring-4 focus:ring-[color-mix(in_oklab,var(--vertex-blue)_14%,transparent)]"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className="inline-flex justify-center rounded-full bg-[var(--vertex-blue)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
              >
                Search
              </button>
              {appliedQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('')
                    setAppliedQuery('')
                  }}
                  className="inline-flex justify-center rounded-full border border-[var(--chip-line)] bg-white px-5 py-3 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                >
                  Clear
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="island-shell overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--chip-line)] p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-xl font-bold text-[var(--vertex-blue)]">
                  Accounts
                </h2>
                <p className="mt-1 text-sm leading-6 text-[var(--sea-ink-soft)]">
                  Showing up to 100 users, sorted by most recently updated.
                </p>
              </div>
              <div className="text-xs font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">
                {userRows.length} users
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="p-6 text-sm font-semibold text-[var(--sea-ink-soft)]">
              Loading users...
            </div>
          ) : isError ? (
            <div className="p-6">
              <BrandedAlert variant="error" title="Could not load users">
                Refresh the page or try a narrower search.
              </BrandedAlert>
            </div>
          ) : userRows.length === 0 ? (
            <div className="p-6 text-sm font-semibold text-[var(--sea-ink-soft)]">
              No users matched that search.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="bg-[var(--foam)] text-xs font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">
                  <tr>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Current Role</th>
                    <th className="px-5 py-3">Verified</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--chip-line)]">
                  {userRows.map((row) => {
                    return (
                      <tr key={row.id} className="bg-white align-top">
                        <td className="px-5 py-4">
                          <div className="font-bold text-[var(--sea-ink)]">{row.name || 'Unnamed user'}</div>
                          <div className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">{row.email}</div>
                        </td>
                        <td className="px-5 py-4">
                          <span className="inline-flex rounded-full bg-[var(--foam)] px-3 py-1 text-xs font-black uppercase tracking-wide text-[var(--vertex-blue)]">
                            {roleLabel(row.role)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold text-[var(--sea-ink-soft)]">
                          {row.emailVerified ? 'Yes' : 'No'}
                        </td>
                        <td className="px-5 py-4 text-sm font-semibold text-[var(--sea-ink-soft)]">
                          {formatDate(row.updatedAt)}
                        </td>
                        <td className="px-5 py-4">
                          <button
                            type="button"
                            onClick={() => openEditModal(row)}
                            className="rounded-full bg-[var(--vertex-blue)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {editDraft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(0,0,0,0.45)] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-user-title"
        >
          <form
            onSubmit={saveUser}
            className="w-full max-w-lg rounded-2xl border border-[var(--chip-line)] bg-white p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="page-kicker">
                  Admin Edit
                </div>
                <h2 id="edit-user-title" className="font-display text-2xl font-black text-[var(--vertex-blue)]">
                  Edit User Account
                </h2>
              </div>
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-full border border-[var(--chip-line)] bg-white px-3 py-1.5 text-sm font-black text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
              >
                Close
              </button>
            </div>

            <div className="grid gap-4">
              <label className="text-sm font-bold text-[var(--sea-ink)]">
                Name
                <input
                  value={editDraft.name}
                  onChange={(event) => setEditDraft(current => current ? { ...current, name: event.target.value } : current)}
                  className="mt-2 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--sea-ink)] outline-none transition focus:border-[var(--vertex-blue)] focus:ring-4 focus:ring-[color-mix(in_oklab,var(--vertex-blue)_14%,transparent)]"
                />
              </label>
              <label className="text-sm font-bold text-[var(--sea-ink)]">
                Email
                <input
                  type="email"
                  value={editDraft.email}
                  onChange={(event) => setEditDraft(current => current ? { ...current, email: event.target.value } : current)}
                  className="mt-2 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--sea-ink)] outline-none transition focus:border-[var(--vertex-blue)] focus:ring-4 focus:ring-[color-mix(in_oklab,var(--vertex-blue)_14%,transparent)]"
                />
              </label>
              <label className="text-sm font-bold text-[var(--sea-ink)]">
                Role
                <select
                  value={editDraft.role}
                  onChange={(event) => setEditDraft(current => current ? { ...current, role: event.target.value as UserRole } : current)}
                  className="mt-2 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--sea-ink)] outline-none transition focus:border-[var(--vertex-blue)] focus:ring-4 focus:ring-[color-mix(in_oklab,var(--vertex-blue)_14%,transparent)]"
                >
                  {roleOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">
                {roleOptions.find(option => option.value === editDraft.role)?.description}
              </p>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeEditModal}
                className="rounded-full border border-[var(--chip-line)] bg-white px-5 py-3 text-sm font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={updateAccountMutation.isPending || !editDraft.name.trim() || !editDraft.email.trim()}
                className="rounded-full bg-[var(--vertex-blue)] px-5 py-3 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:bg-[var(--vertex-gray)]"
              >
                {updateAccountMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  )
}
