import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listInvites, listInviteSchools, revokeInvite, sendInvite } from '#/lib/invitations'
import { BrandedAlert } from '#/components/BrandedAlert'
import { getServerRequest } from '#/lib/security'

type InviteRoleOption = 'school_leader' | 'school_staff' | 'vertex_user' | 'admin'

const getAdminAccess = createServerFn({ method: 'GET' }).handler(async () => {
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

export const Route = createFileRoute('/admin')({
  beforeLoad: async ({ location }) => {
    const access = await getAdminAccess()

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
  component: AdminPage,
})

function AdminPage() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRoleOption>('school_leader')
  const [selectedSchoolName, setSelectedSchoolName] = useState('')
  const [schoolMenuOpen, setSchoolMenuOpen] = useState(false)
  const schoolMenuRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<{
    success: boolean
    inviteLink: string
    emailSent: boolean
    emailError?: string
  } | null>(null)
  const [alertStatus, setAlertStatus] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)

  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['admin-invites'],
    queryFn: () => listInvites(),
  })

  const { data: inviteSchools = [], isLoading: inviteSchoolsLoading } = useQuery({
    queryKey: ['admin-invite-schools'],
    queryFn: () => listInviteSchools(),
  })

  const selectedSchool = useMemo(
    () => inviteSchools.find((school) => school.schoolName === selectedSchoolName),
    [inviteSchools, selectedSchoolName],
  )

  useEffect(() => {
    if (!schoolMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!schoolMenuRef.current?.contains(event.target as Node)) {
        setSchoolMenuOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSchoolMenuOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [schoolMenuOpen])

  const inviteMutation = useMutation({
    mutationFn: () =>
      sendInvite({
        data: {
          email: email.trim(),
          role,
          schoolContactRole: role === 'school_leader' || role === 'school_staff' ? role : undefined,
          schoolName: role === 'school_leader' || role === 'school_staff' ? selectedSchoolName : undefined,
        },
      }),
    onSuccess: (resp) => {
      setResult(resp)
      setEmail('')
      setSelectedSchoolName('')
      setAlertStatus(null)
      queryClient.invalidateQueries({ queryKey: ['admin-invites'] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeInvite({ data: id }),
    onSuccess: () => {
      setAlertStatus({
        type: 'success',
        title: 'Invite revoked',
        message: 'The invite token has been removed and can no longer be used.',
      })
      queryClient.invalidateQueries({ queryKey: ['admin-invites'] })
    },
  })

  const handleInvite = async (e: FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setAlertStatus({
        type: 'error',
        title: 'Email required',
        message: 'Enter an email address before sending an invite.',
      })
      return
    }

    if ((role === 'school_leader' || role === 'school_staff') && !selectedSchoolName) {
      setAlertStatus({
        type: 'error',
        title: 'School required',
        message: 'Select the school this invite should onboard.',
      })
      return
    }

    setResult(null)
    setAlertStatus(null)
    inviteMutation.mutate(undefined, {
      onError: (err: any) => {
        setAlertStatus({
          type: 'error',
          title: 'Invite failed',
          message: err.message || 'Failed to send invite.',
        })
      },
    })
  }

  const handleRevoke = (id: string, inviteEmail: string) => {
    if (!confirm(`Revoke the pending invite for ${inviteEmail}?`)) {
      return
    }

    revokeMutation.mutate(id, {
      onError: (err: any) => {
        setAlertStatus({
          type: 'error',
          title: 'Revoke failed',
          message: err.message || 'Failed to revoke invite.',
        })
      },
    })
  }

  const roleLabel = (inviteRole: string) => {
    if (inviteRole === 'admin') return 'Vertex Admin'
    if (inviteRole === 'vertex_user') return 'Vertex Staff'
    return 'School Leader'
  }

  const schoolRoleLabel = (invite: { role: string; schoolContactRole?: string | null }) => {
    if (invite.role !== 'school_user' && invite.role !== 'school_leader' && invite.role !== 'school_staff') return roleLabel(invite.role)
    if (invite.role === 'school_staff') return 'School Staff'
    if (invite.role === 'school_leader') return 'School Leader'
    if (invite.schoolContactRole === 'school_staff') return 'School Staff'
    return 'School Leader'
  }

  const inviteStatus = (invite: { accepted: boolean; expiresAt: Date | string }) => {
    if (invite.accepted) return 'Accepted'
    if (new Date(invite.expiresAt).getTime() < Date.now()) return 'Expired'
    return 'Pending'
  }

  const formatDate = (value: Date | string) => {
    return new Date(value).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-wide">
        <div className="page-heading">
          <div className="page-kicker">
            Onboarding Administration
          </div>
          <h1 className="page-title">
            School Invites
          </h1>
        </div>

        <div className={`island-shell relative mb-6 rounded-2xl p-5 sm:mb-8 sm:p-6 ${schoolMenuOpen ? 'z-50' : 'z-10'}`}>
          <p className="text-sm text-[var(--sea-ink-soft)] mb-6">
            Send school, staff, and admin account invitations and revoke pending invites that should no longer be used.
          </p>

          <form onSubmit={handleInvite} className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_200px_auto] lg:items-end">
            <div className="min-w-0">
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              />
            </div>

            <div className={role === 'school_leader' || role === 'school_staff' ? 'min-w-0' : 'hidden lg:block'}>
              {(role === 'school_leader' || role === 'school_staff') && (
                <>
                  <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                    School
                  </label>
                  <div ref={schoolMenuRef} className="relative z-50">
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={schoolMenuOpen}
                      disabled={inviteSchoolsLoading || inviteSchools.length === 0}
                      onClick={() => setSchoolMenuOpen((open) => !open)}
                      className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-left text-sm font-semibold text-[var(--sea-ink)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className={`min-w-0 truncate ${selectedSchoolName ? '' : 'text-[var(--sea-ink-soft)]'}`}>
                        {selectedSchoolName || (inviteSchoolsLoading ? 'Loading schools...' : 'Select a school')}
                      </span>
                      <span className="shrink-0 text-[10px] text-[var(--sea-ink-soft)]" aria-hidden="true">
                        ▾
                      </span>
                    </button>

                    {schoolMenuOpen && (
                      <div
                        role="listbox"
                        className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[100] max-h-64 overflow-y-auto rounded-xl border border-[var(--chip-line)] bg-white p-1 shadow-xl"
                      >
                        {inviteSchools.map((school) => (
                          <button
                            key={school.id}
                            type="button"
                            role="option"
                            aria-selected={school.schoolName === selectedSchoolName}
                            onClick={() => {
                              setSelectedSchoolName(school.schoolName)
                              setSchoolMenuOpen(false)
                              if (school.primaryContactEmail && !email.trim()) {
                                setEmail(school.primaryContactEmail)
                              }
                            }}
                            className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition ${
                              school.schoolName === selectedSchoolName
                                ? 'bg-[var(--vertex-blue)] text-white'
                                : 'text-[var(--sea-ink)] hover:bg-[var(--foam)]'
                            }`}
                          >
                            {school.schoolName}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider mb-1 text-[var(--sea-ink)]">
                Account Role
              </label>
              <select
                value={role}
                onChange={(e) => {
                  const nextRole = e.target.value as InviteRoleOption
                  setRole(nextRole)
                  if (nextRole !== 'school_leader' && nextRole !== 'school_staff') {
                    setSelectedSchoolName('')
                    setSchoolMenuOpen(false)
                  }
                }}
                className="w-full px-4 py-2 border border-[var(--chip-line)] rounded-xl bg-white"
              >
                <option value="school_leader">School Leader</option>
                <option value="school_staff">School Staff</option>
                <option value="vertex_user">Vertex Staff</option>
                <option value="admin">Vertex Admin</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={inviteMutation.isPending}
              className="w-full md:w-auto px-5 py-2.5 bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)] text-white font-bold rounded-xl shadow-md cursor-pointer transition disabled:opacity-50"
            >
              {inviteMutation.isPending ? 'Sending...' : 'Invite'}
            </button>
          </form>

          {(role === 'school_leader' || role === 'school_staff') && selectedSchool && (
            <div className="mt-3 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
              This invite will onboard {selectedSchool.schoolName} for {selectedSchool.services} as {role === 'school_leader' ? 'School Leader' : 'School Staff'}. Primary contact: {selectedSchool.primaryContactName} ({selectedSchool.primaryContactEmail}).
            </div>
          )}

          {(role === 'school_leader' || role === 'school_staff') && !inviteSchoolsLoading && inviteSchools.length === 0 && (
            <BrandedAlert variant="warning" title="No schools available" className="mt-5">
              Add client profiles to the database before sending school invites.
            </BrandedAlert>
          )}

          {result && (
            <BrandedAlert
              variant={result.emailSent ? 'success' : 'warning'}
              title={result.emailSent ? 'Invite sent' : 'Invite created'}
              className="mt-5"
            >
              {!result.emailSent && result.emailError
                ? `Email delivery was skipped: ${result.emailError}`
                : 'The invite has been added to the sent invite list.'}
            </BrandedAlert>
          )}

          {alertStatus && (
            <BrandedAlert
              variant={alertStatus.type}
              title={alertStatus.title}
              className="mt-5"
            >
              {alertStatus.message}
            </BrandedAlert>
          )}
        </div>

        <section className="island-shell relative z-0 rounded-2xl p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-[var(--vertex-blue)]">School Invites</h2>
              <p className="text-sm text-[var(--sea-ink-soft)]">
                Unaccepted invites can be revoked before they are used.
              </p>
            </div>
            {invites.length > 0 && (
              <span className="rounded-full bg-[var(--foam)] px-3 py-1 text-xs font-bold uppercase tracking-wider text-[var(--sea-ink-soft)]">
                {invites.length} total
              </span>
            )}
          </div>

          {invitesLoading ? (
            <div className="rounded-xl border border-[var(--chip-line)] bg-white p-5 text-sm text-[var(--sea-ink-soft)]">
              Loading invites...
            </div>
          ) : invites.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--chip-line)] bg-white p-5 text-sm text-[var(--sea-ink-soft)]">
              No invites have been sent yet.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--chip-line)] bg-white">
              <div className="hidden grid-cols-[1.35fr_1fr_140px_120px_120px_100px] gap-4 border-b border-[var(--chip-line)] bg-[var(--foam)] px-4 py-3 text-xs font-bold uppercase tracking-wider text-[var(--sea-ink-soft)] md:grid">
                <div>Email</div>
                <div>School</div>
                <div>Role</div>
                <div>Status</div>
                <div>Sent</div>
                <div className="text-right">Action</div>
              </div>

              <div className="divide-y divide-[var(--chip-line)]">
                {invites.map((invite) => {
                  const status = inviteStatus(invite)
                  const canRevoke = !invite.accepted
                  const isRevoking = revokeMutation.isPending && revokeMutation.variables === invite.id

                  return (
                    <div
                      key={invite.id}
                      className="grid gap-3 px-4 py-4 text-sm md:grid-cols-[1.35fr_1fr_140px_120px_120px_100px] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="break-words font-bold text-[var(--sea-ink)] md:truncate">{invite.email}</div>
                        <div className="mt-1 text-xs text-[var(--sea-ink-soft)] md:hidden">
                          {invite.schoolName ? `${invite.schoolName} - ` : ''}{schoolRoleLabel(invite)} - {status} - Sent {formatDate(invite.createdAt)}
                        </div>
                      </div>
                      <div className="hidden min-w-0 font-semibold text-[var(--sea-ink)] md:block md:truncate">
                        {invite.schoolName ?? '-'}
                      </div>
                      <div className="hidden font-semibold text-[var(--sea-ink)] md:block">
                        {schoolRoleLabel(invite)}
                      </div>
                      <div className="hidden md:block">
                        <span className="rounded-full bg-[var(--foam)] px-2.5 py-1 text-xs font-bold text-[var(--sea-ink)]">
                          {status}
                        </span>
                      </div>
                      <div className="hidden text-[var(--sea-ink-soft)] md:block">
                        {formatDate(invite.createdAt)}
                      </div>
                      <div className="flex justify-start md:justify-end">
                        <button
                          type="button"
                          disabled={!canRevoke || isRevoking}
                          onClick={() => handleRevoke(invite.id, invite.email)}
                          className="rounded-lg border border-[var(--chip-line)] bg-white px-3 py-2 text-xs font-bold text-[var(--sea-ink)] transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {isRevoking ? 'Revoking...' : 'Revoke'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
