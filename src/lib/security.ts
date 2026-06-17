import { and, eq } from 'drizzle-orm'

export type AppSession = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>

const staffRoles = new Set(['vertex_user', 'admin'])

function getAllowedOrigins(request: Request) {
  const currentOrigin = new URL(request.url).origin
  return new Set([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://vertex.rcormier.dev',
    'https://vertex-bridge.rcormier.workers.dev',
    currentOrigin,
  ])
}

export async function getServerRequest() {
  const { getRequest } = await import('@tanstack/start-server-core')
  return getRequest()
}

export async function assertTrustedOrigin(request?: Request) {
  const currentRequest = request ?? await getServerRequest()
  const origin = currentRequest.headers.get('origin')
  if (!origin) return

  if (!getAllowedOrigins(currentRequest).has(origin)) {
    throw new Error('Unauthorized request origin.')
  }
}

export async function getCurrentSession() {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  return session
}

export async function requireSession() {
  const session = await getCurrentSession()
  if (!session?.user) {
    throw new Error('You must be logged in.')
  }

  return session
}

export function getUserRole(session: AppSession) {
  return (session.user as any).role as string | undefined
}

export function isStaffSession(session: AppSession) {
  return staffRoles.has(getUserRole(session) || '')
}

export async function requireStaffSession() {
  const session = await requireSession()
  if (!isStaffSession(session)) {
    throw new Error('Unauthorized. Vertex staff only.')
  }

  return session
}

export async function requireAdminSession() {
  const session = await requireSession()
  if (getUserRole(session) !== 'admin') {
    throw new Error('Unauthorized. Admin only.')
  }

  return session
}

export async function getSessionSchoolNames(session: AppSession) {
  if (isStaffSession(session)) return null

  const { db } = await import('#/db')
  const { clientProfiles, invitations } = await import('#/db/schema')
  const email = session.user.email

  const [inviteRows, clientRows] = await Promise.all([
    db
      .select({ schoolName: invitations.schoolName })
      .from(invitations)
      .where(eq(invitations.email, email))
      .all(),
    db
      .select({ schoolName: clientProfiles.schoolName })
      .from(clientProfiles)
      .where(eq(clientProfiles.primaryContactEmail, email))
      .all(),
  ])

  const names = new Set<string>()
  for (const row of inviteRows) {
    if (row.schoolName) names.add(row.schoolName)
  }
  for (const row of clientRows) {
    if (row.schoolName) names.add(row.schoolName)
  }

  return names
}

export async function assertCanAccessSchool(session: AppSession, schoolName: string) {
  if (isStaffSession(session)) return

  const allowedSchoolNames = await getSessionSchoolNames(session)
  if (!allowedSchoolNames?.has(schoolName)) {
    throw new Error('Unauthorized. This school is not assigned to your account.')
  }
}

export async function getAccessibleSubmission(submissionId: string, session: AppSession) {
  const { db } = await import('#/db')
  const { submissions } = await import('#/db/schema')

  const rows = await db
    .select()
    .from(submissions)
    .where(
      isStaffSession(session)
        ? eq(submissions.id, submissionId)
        : and(eq(submissions.id, submissionId), eq(submissions.uploadedBy, session.user.id)),
    )
    .all()
  const submission = rows[0]

  if (!submission) {
    throw new Error('Document not found.')
  }

  await assertCanAccessSchool(session, submission.schoolName)

  return submission
}
