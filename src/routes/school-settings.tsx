import { Link, createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { BrandedAlert } from '#/components/BrandedAlert'
import { authClient } from '#/lib/auth-client'
import { sendSchoolStaffInvite } from '#/lib/invitations'
import { getServerRequest } from '#/lib/security'

type SchoolProfile = {
  schoolName: string
  contactRole: 'school_leader' | 'school_staff'
}

type SchoolContact = {
  id: string
  email: string
  name: string | null
  contactRole: 'school_leader' | 'school_staff'
  acceptedAt: Date | null
}

const selectedSchoolStorageKey = 'vertex-bridge:selected-school'

const getSchoolSettingsAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  const role = (session?.user as any)?.role

  return {
    isSignedIn: Boolean(session?.user),
    isSchoolUser: role === 'school_leader' || role === 'school_staff' || role === 'school_user',
  }
})

const listUserSchoolProfiles = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { db } = await import('#/db')
    const { auth } = await import('#/lib/auth')
    const { clientProfiles, invitations, schoolContacts } = await import('#/db/schema')
    const { asc, eq } = await import('drizzle-orm')

    const request = await getServerRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user?.email) return []

    const [profileRows, contactRows, inviteRows] = await Promise.all([
      db
        .select()
        .from(clientProfiles)
        .where(eq(clientProfiles.primaryContactEmail, session.user.email))
        .orderBy(asc(clientProfiles.schoolName))
        .all(),
      db
        .select()
        .from(schoolContacts)
        .where(eq(schoolContacts.email, session.user.email))
        .orderBy(asc(schoolContacts.schoolName))
        .all(),
      db
        .select()
        .from(invitations)
        .where(eq(invitations.email, session.user.email))
        .orderBy(asc(invitations.schoolName))
        .all(),
    ])

    const profilesBySchool = new Map<string, SchoolProfile>()

    for (const profile of profileRows) {
      profilesBySchool.set(profile.schoolName, {
        schoolName: profile.schoolName,
        contactRole: 'school_leader',
      })
    }

    for (const contact of contactRows) {
      profilesBySchool.set(contact.schoolName, {
        schoolName: contact.schoolName,
        contactRole: contact.contactRole === 'school_leader' ? 'school_leader' : 'school_staff',
      })
    }

    for (const invite of inviteRows) {
      if (!invite.schoolName || profilesBySchool.has(invite.schoolName)) continue
      profilesBySchool.set(invite.schoolName, {
        schoolName: invite.schoolName,
        contactRole: invite.schoolContactRole === 'school_staff' ? 'school_staff' : 'school_leader',
      })
    }

    return Array.from(profilesBySchool.values())
  })

const listSchoolSettingsContacts = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { clientProfiles, schoolContacts } = await import('#/db/schema')
    const { assertCanAccessSchool, requireSession } = await import('#/lib/security')
    const { eq } = await import('drizzle-orm')

    const session = await requireSession()
    await assertCanAccessSchool(session, schoolName)

    const [profiles, contacts] = await Promise.all([
      db
        .select()
        .from(clientProfiles)
        .where(eq(clientProfiles.schoolName, schoolName))
        .all(),
      db
        .select()
        .from(schoolContacts)
        .where(eq(schoolContacts.schoolName, schoolName))
        .all(),
    ])

    const contactsByEmail = new Map<string, SchoolContact>()
    const profile = profiles[0]

    if (profile?.primaryContactEmail) {
      contactsByEmail.set(profile.primaryContactEmail, {
        id: `primary:${profile.primaryContactEmail}`,
        email: profile.primaryContactEmail,
        name: profile.primaryContactName,
        contactRole: 'school_leader',
        acceptedAt: new Date(0),
      })
    }

    for (const contact of contacts) {
      contactsByEmail.set(contact.email, {
        id: contact.id,
        email: contact.email,
        name: contact.name,
        contactRole: contact.contactRole === 'school_leader' ? 'school_leader' : 'school_staff',
        acceptedAt: contact.acceptedAt,
      })
    }

    return Array.from(contactsByEmail.values()).sort((a, b) => {
      if (a.contactRole !== b.contactRole) return a.contactRole === 'school_leader' ? -1 : 1
      return a.email.localeCompare(b.email)
    })
  })

export const Route = createFileRoute('/school-settings')({
  beforeLoad: async ({ location }) => {
    const access = await getSchoolSettingsAccess()

    if (!access.isSignedIn) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    if (!access.isSchoolUser) {
      throw redirect({
        to: '/vertex-dashboard',
      })
    }
  },
  component: SchoolSettingsPage,
})

function SchoolSettingsPage() {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const [selectedSchoolName, setSelectedSchoolName] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)

  const { data: schools = [], isLoading: schoolsLoading } = useQuery({
    queryKey: ['school-settings-schools'],
    queryFn: () => listUserSchoolProfiles(),
  })

  const selectedSchool = schools.find((school) => school.schoolName === selectedSchoolName) ?? schools[0] ?? null
  const canInviteStaff = selectedSchool?.contactRole === 'school_leader' || selectedSchool?.contactRole === 'school_staff'

  const { data: contacts = [], isLoading: contactsLoading } = useQuery({
    queryKey: ['school-settings-contacts', selectedSchoolName],
    queryFn: () => listSchoolSettingsContacts({ data: selectedSchoolName }),
    enabled: Boolean(selectedSchoolName),
  })

  useEffect(() => {
    if (schools.length === 0) return

    const storedSchoolName = window.localStorage.getItem(selectedSchoolStorageKey)
    const nextSchoolName = storedSchoolName && schools.some((school) => school.schoolName === storedSchoolName)
      ? storedSchoolName
      : schools[0].schoolName

    setSelectedSchoolName((currentSchoolName) => (
      currentSchoolName && schools.some((school) => school.schoolName === currentSchoolName)
        ? currentSchoolName
        : nextSchoolName
    ))
  }, [schools])

  useEffect(() => {
    if (!selectedSchoolName) return
    window.localStorage.setItem(selectedSchoolStorageKey, selectedSchoolName)
  }, [selectedSchoolName])

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault()
    setStatus(null)

    if (!selectedSchoolName) {
      setStatus({
        type: 'error',
        title: 'Choose a school',
        message: 'Select a school before sending an invite.',
      })
      return
    }

    if (!staffEmail.trim()) {
      setStatus({
        type: 'error',
        title: 'Email required',
        message: 'Enter a staff email address before sending an invite.',
      })
      return
    }

    setSending(true)
    try {
      const result = await sendSchoolStaffInvite({
        data: {
          schoolName: selectedSchoolName,
          email: staffEmail,
        },
      })

      setStatus({
        type: result.emailSent ? 'success' : 'warning',
        title: result.emailSent ? 'Staff invite sent' : 'Staff invite created',
        message: result.emailSent
          ? 'The staff member will receive a school-staff onboarding invitation.'
          : `The invite link was created, but email delivery was not available: ${result.emailError}`,
      })
      setStaffEmail('')
      await queryClient.invalidateQueries({ queryKey: ['school-settings-contacts', selectedSchoolName] })
    } catch (err: any) {
      setStatus({
        type: 'error',
        title: 'Invite failed',
        message: err.message || 'Unable to send staff invite.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="page-wrap page-shell pb-28">
      <div className="page-stack page-stack-standard page-section-gap">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="page-heading">
            <div className="page-kicker">
              School Settings
            </div>
            <h1 className="page-title">
              Team Access
            </h1>
          </div>

          <Link
            to="/school-onboarding"
            className="inline-flex justify-center rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-bold text-[var(--vertex-blue)] no-underline transition hover:bg-[var(--foam)]"
          >
            Back to Journey
          </Link>
        </div>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)] lg:items-start">
            <div>
              <h2 className="display-title text-xl font-bold text-[var(--vertex-blue)] sm:text-2xl">
                Invite school staff
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--sea-ink-soft)]">
                Send subordinate staff an invite to help with assigned onboarding tasks. Staff invites are scoped to the selected school.
              </p>
            </div>

            <div className="grid gap-3">
              {schools.length > 1 ? (
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]" htmlFor="school-settings-school">
                    Choose Your School
                  </label>
                  <select
                    id="school-settings-school"
                    value={selectedSchoolName}
                    onChange={(event) => setSelectedSchoolName(event.target.value)}
                    className="min-h-10 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-bold text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  >
                    {schools.map((school) => (
                      <option key={school.schoolName} value={school.schoolName}>
                        {school.schoolName}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                    Your School:
                  </div>
                  <div className="min-h-10 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4 py-2 text-sm font-bold text-[var(--sea-ink)]">
                    {selectedSchool?.schoolName || (schoolsLoading ? 'Loading school...' : 'No school assigned')}
                  </div>
                </div>
              )}

              <form onSubmit={handleInvite} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="sr-only" htmlFor="school-staff-invite-email">
                  Staff email
                </label>
                <input
                  id="school-staff-invite-email"
                  type="email"
                  value={staffEmail}
                  onChange={(event) => setStaffEmail(event.target.value)}
                  placeholder="staff@school.org"
                  disabled={!canInviteStaff || sending}
                  className="min-h-10 min-w-0 rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!canInviteStaff || sending}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--vertex-blue)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <UserPlus size={16} aria-hidden="true" />
                  {sending ? 'Sending...' : 'Invite Staff'}
                </button>
              </form>

              {!canInviteStaff && selectedSchool && (
                <BrandedAlert variant="warning" title="Invite access unavailable">
                  Your account can view this school, but it cannot send staff invites.
                </BrandedAlert>
              )}
            </div>
          </div>

          {status && (
            <BrandedAlert variant={status.type} title={status.title} className="mt-4">
              {status.message}
            </BrandedAlert>
          )}
        </section>

        <section className="island-shell rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="display-title text-xl font-bold text-[var(--vertex-blue)] sm:text-2xl">
                School contacts
              </h2>
              <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
                {selectedSchoolName || 'Selected school'} team access.
              </p>
            </div>
            <div className="text-xs font-bold uppercase tracking-wider text-[var(--sea-ink-soft)]">
              Signed in as {session?.user?.email || 'current user'}
            </div>
          </div>

          <div className="mt-5 divide-y divide-[var(--line)]">
            {contactsLoading ? (
              <div className="py-4 text-sm font-semibold text-[var(--sea-ink-soft)]">
                Loading school contacts...
              </div>
            ) : contacts.length === 0 ? (
              <div className="py-4 text-sm font-semibold text-[var(--sea-ink-soft)]">
                No school contacts found yet.
              </div>
            ) : contacts.map((contact) => (
              <div key={contact.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold text-[var(--sea-ink)]">
                    {contact.name || contact.email}
                  </div>
                  <div className="truncate text-xs font-semibold text-[var(--sea-ink-soft)]">
                    {contact.email}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full border border-[var(--chip-line)] bg-[var(--foam)] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--sea-ink)]">
                    {contact.contactRole === 'school_leader' ? 'Leader' : 'Staff'}
                  </span>
                  <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide ${contact.acceptedAt ? 'bg-green-100 text-green-700' : 'bg-neutral-100 text-[var(--sea-ink-soft)]'}`}>
                    {contact.acceptedAt ? 'Accepted' : 'Pending'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
