import { createServerFn } from '@tanstack/react-start'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { assertTrustedOrigin, getServerRequest } from './security'
import type { AppSession } from './security'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isSchoolAccountRole(role: string | null | undefined) {
  return role === 'school_leader' || role === 'school_staff' || role === 'school_user'
}

function normalizeSchoolAccountRole(role: string) {
  return role === 'school_user' ? 'school_leader' : role
}

async function hashInviteToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function getEnv() {
  const { getCloudflareEnv } = await import('./cloudflare-env.server')
  return getCloudflareEnv()
}

async function requireAdminSession() {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })

  if (!session?.user || (session.user as any).role !== 'admin') {
    throw new Error('Unauthorized. Admin role required.')
  }

  return session
}

async function ensureClientProfilesTable(db: any) {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS client_profiles (
      id text PRIMARY KEY NOT NULL,
      school_name text NOT NULL UNIQUE,
      state text NOT NULL,
      services text NOT NULL,
      client_type text NOT NULL,
      primary_contact_name text NOT NULL,
      primary_contact_email text NOT NULL,
      onboarding_coordinator text NOT NULL,
      onboarding_start_date text NOT NULL,
      hubspot_company_id text NOT NULL,
      hubspot_deal_id text NOT NULL,
      lifecycle_stage text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `)
}

function buildInviteEmail(data: {
  inviteLink: string
  schoolName?: string
  services?: string
  schoolContactRole?: 'school_leader' | 'school_staff'
  expiresAt: Date
}) {
  const expiration = data.expiresAt.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const safeInviteLink = escapeHtml(data.inviteLink)
  const safeExpiration = escapeHtml(expiration)

  const isSchoolStaffInvite = data.schoolContactRole === 'school_staff'
  const schoolName = data.schoolName || 'your school'
  const subject = isSchoolStaffInvite
    ? `You have been invited to support ${schoolName} onboarding`
    : `Welcome to Vertex Bridge`
  const introText = isSchoolStaffInvite
    ? `You have been invited as School Staff to help ${schoolName} complete its Vertex Bridge onboarding tasks.`
    : `Vertex Education has prepared an account for you.`
  const heading = isSchoolStaffInvite
    ? `Help your school complete onboarding.`
    : `Your onboarding workspace is ready.`
  const bodyText = isSchoolStaffInvite
    ? `Vertex Bridge gives school staff a shared view of the onboarding journey, while showing which tasks need your follow-up. You can review the full process, complete tasks assigned to you, and coordinate next steps with your school team.`
    : `Vertex Education has prepared an account for you. Vertex Bridge will help you access the right workspace, review tasks, upload required documents, and get help along the way.`

  return {
    subject,
    text: [
      isSchoolStaffInvite ? `Vertex Bridge school staff invitation.` : `Welcome to Vertex Bridge.`,
      ``,
      introText,
      ``,
      `Accept your invite and set your password here:`,
      data.inviteLink,
      ``,
      `This invite expires on ${expiration}.`,
      ``,
      `Vertex Education`,
    ].join('\n'),
    html: `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f6f7; color:#404342; font-family:'DM Sans', Arial, sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f7; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; background:#ffffff; border:1px solid rgba(0,56,101,0.12); border-radius:18px; overflow:hidden; box-shadow:0 18px 40px rgba(0,56,101,0.10);">
            <tr>
              <td style="padding:28px 32px 18px 32px; border-bottom:1px solid rgba(0,56,101,0.10);">
                <img src="https://brand.vertexeducation.com/assets/vertex-horizontal.svg" alt="Vertex Education" width="164" style="display:block; max-width:164px; height:auto; margin-bottom:18px;" />
                <div style="font-size:11px; line-height:1.4; letter-spacing:0.16em; text-transform:uppercase; font-weight:700; color:#CBA052;">
                  ${isSchoolStaffInvite ? 'School Staff Onboarding Support' : 'Vertex Bridge Onboarding'}
                </div>
                <h1 style="margin:8px 0 0 0; font-family:'Red Hat Display', Arial, sans-serif; font-size:30px; line-height:1.12; color:#003865; font-weight:800;">
                  ${escapeHtml(heading)}
                </h1>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <p style="margin:0 0 16px 0; font-size:16px; line-height:1.7; color:#404342;">
                  ${escapeHtml(bodyText)}
                </p>
                <p style="margin:0 0 24px 0; font-size:14px; line-height:1.7; color:#707372;">
                  Use the secure link below to accept your invite and set your password. This invite expires on <strong>${safeExpiration}</strong>.
                </p>
                <a href="${safeInviteLink}" style="display:inline-block; background:#003865; color:#ffffff; text-decoration:none; font-size:14px; font-weight:800; padding:14px 22px; border-radius:999px;">
                  Accept Invite
                </a>
                <p style="margin:22px 0 0 0; font-size:12px; line-height:1.6; color:#707372;">
                  If the button does not work, copy and paste this link into your browser:<br />
                  <a href="${safeInviteLink}" style="color:#003865; word-break:break-all;">${safeInviteLink}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 30px 32px;">
                <div style="height:1px; background:rgba(0,56,101,0.10); margin-bottom:18px;"></div>
                <p style="margin:0; font-size:12px; line-height:1.6; color:#707372;">
                  Vertex Education<br />
                  We change lives through education.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  }
}

export const listInviteSchools = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { db } = await import('#/db')
    const { clientProfiles } = await import('#/db/schema')

    await requireAdminSession()
    await ensureClientProfilesTable(db)

    return db.select({
      id: clientProfiles.id,
      schoolName: clientProfiles.schoolName,
      state: clientProfiles.state,
      services: clientProfiles.services,
      clientType: clientProfiles.clientType,
      primaryContactName: clientProfiles.primaryContactName,
      primaryContactEmail: clientProfiles.primaryContactEmail,
      onboardingCoordinator: clientProfiles.onboardingCoordinator,
    })
      .from(clientProfiles)
      .orderBy(asc(clientProfiles.schoolName))
      .all()
  })

export const sendInvite = createServerFn({ method: 'POST' })
  .validator((data: {
    email: string
    role: 'school_leader' | 'school_staff' | 'vertex_user' | 'admin' | 'school_user'
    schoolContactRole?: 'school_leader' | 'school_staff'
    schoolName?: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { clientProfiles, invitations } = await import('#/db/schema')

    await assertTrustedOrigin()
    const session = await requireAdminSession()
    const isSchoolRole = isSchoolAccountRole(data.role)
    const normalizedRole = normalizeSchoolAccountRole(data.role)
    const schoolContactRole = isSchoolRole
      ? data.schoolContactRole || (normalizedRole === 'school_staff' ? 'school_staff' : 'school_leader')
      : null
    
    const token = crypto.randomUUID()
    const tokenHash = await hashInviteToken(token)
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days expiry
    let schoolProfile: {
      schoolName: string | null
      state: string | null
      services: string | null
      clientType: string | null
    }

    if (isSchoolRole) {
      if (!data.schoolName?.trim()) {
        throw new Error('Select a school before sending a school invite.')
      }

      await ensureClientProfilesTable(db)
      const selectedProfiles = await db.select()
        .from(clientProfiles)
        .where(eq(clientProfiles.schoolName, data.schoolName.trim()))
        .all()
      const selectedProfile = selectedProfiles[0]

      if (!selectedProfile) {
        throw new Error('Selected school was not found in client profiles.')
      }

      schoolProfile = {
        schoolName: selectedProfile.schoolName,
        state: selectedProfile.state,
        services: selectedProfile.services,
        clientType: selectedProfile.clientType,
      }
    } else {
      schoolProfile = {
        schoolName: null,
        state: null,
        services: null,
        clientType: null,
      }
    }

    // Save invitation to D1
    await db.insert(invitations).values({
      id: crypto.randomUUID(),
      email: data.email,
      role: normalizedRole,
      schoolContactRole,
      schoolName: schoolProfile.schoolName,
      state: schoolProfile.state,
      services: schoolProfile.services,
      clientType: schoolProfile.clientType,
      invitedByUserId: session.user.id,
      invitedByEmail: session.user.email,
      token: tokenHash,
      expiresAt,
      accepted: false,
      createdAt: new Date(),
    }).onConflictDoUpdate({
      target: [invitations.email, invitations.schoolName],
      set: {
        role: normalizedRole,
        schoolContactRole,
        schoolName: schoolProfile.schoolName,
        state: schoolProfile.state,
        services: schoolProfile.services,
        clientType: schoolProfile.clientType,
        invitedByUserId: session.user.id,
        invitedByEmail: session.user.email,
        token: tokenHash,
        expiresAt,
        accepted: false,
        createdAt: new Date(),
      }
    })

    const env = await getEnv()
    const authUrl = (env as any).BETTER_AUTH_URL || 'http://localhost:3000'
    const inviteLink = `${authUrl}/login?invite_token=${token}`
    const inviteEmail = buildInviteEmail({
      inviteLink,
      schoolName: schoolProfile.schoolName ?? undefined,
      services: schoolProfile.services ?? undefined,
      schoolContactRole: schoolContactRole ?? undefined,
      expiresAt,
    })

    // Attempt to send email via Cloudflare Worker binding
    let emailSent = false
    let emailError = ''
    try {
      const emailSender = (env as any).EMAIL
      if (emailSender && typeof emailSender.send === 'function') {
        await emailSender.send({
          to: data.email,
          from: { email: 'onboarding@rcormier.dev', name: 'Vertex Education' },
          subject: inviteEmail.subject,
          text: inviteEmail.text,
          html: inviteEmail.html,
        })
        emailSent = true
      } else {
        emailError = 'Cloudflare EMAIL binding not found or not configured.'
      }
    } catch (e: any) {
      emailError = e?.message || String(e)
    }

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'admin',
      category: 'invite',
      action: emailSent ? 'invite_sent' : 'invite_created',
      message: emailSent
        ? `Invite sent to ${data.email}.`
        : `Invite created for ${data.email}; email delivery was not completed.`,
      entityType: 'invitation',
      schoolName: schoolProfile.schoolName,
      clientEmail: data.email,
      metadata: {
        role: normalizedRole,
        schoolContactRole,
        state: schoolProfile.state,
        services: schoolProfile.services,
        clientType: schoolProfile.clientType,
        expiresAt: expiresAt.toISOString(),
        emailSent,
        emailError: emailError || null,
      },
    })

    return {
      success: true,
      inviteLink,
      emailSent,
      emailError,
    }
  })

export const sendSchoolStaffInvite = createServerFn({ method: 'POST' })
  .validator((data: {
    email: string
    schoolName: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { clientProfiles, invitations, schoolContacts } = await import('#/db/schema')
    const { assertCanAccessSchool, requireSession } = await import('./security')

    await assertTrustedOrigin()
    const session = await requireSession()
    const schoolName = data.schoolName.trim()
    const email = data.email.trim().toLowerCase()

    if (!email) {
      throw new Error('Enter a staff email address before sending an invite.')
    }
    if (!schoolName) {
      throw new Error('Select a school before sending a staff invite.')
    }

    await assertCanAccessSchool(session, schoolName)
    await ensureClientProfilesTable(db)

    const [profile] = await db.select()
      .from(clientProfiles)
      .where(eq(clientProfiles.schoolName, schoolName))
      .all()

    if (!profile) {
      throw new Error('Selected school was not found in client profiles.')
    }

    const [contactRows, inviteRows] = await Promise.all([
      db
        .select()
        .from(schoolContacts)
        .where(eq(schoolContacts.schoolName, schoolName))
        .all(),
      db
        .select()
        .from(invitations)
        .where(eq(invitations.schoolName, schoolName))
        .all(),
    ])
    const sessionEmail = String(session.user.email || '').trim().toLowerCase()
    const currentContact = contactRows.find((contact: any) =>
      String(contact.email || '').trim().toLowerCase() === sessionEmail,
    )
    const currentInvite = inviteRows.find((invite: any) =>
      String(invite.email || '').trim().toLowerCase() === sessionEmail
        && isSchoolAccountRole(invite.role),
    )
    const isPrimaryContact = String(profile.primaryContactEmail || '').trim().toLowerCase() === sessionEmail
    const isSchoolContact = isPrimaryContact || Boolean(currentContact) || Boolean(currentInvite)

    if (!isSchoolContact) {
      throw new Error('Only a school contact can invite additional school staff.')
    }

    const token = crypto.randomUUID()
    const tokenHash = await hashInviteToken(token)
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
    const now = new Date()

    await db.insert(invitations).values({
      id: crypto.randomUUID(),
      email,
      role: 'school_staff',
      schoolContactRole: 'school_staff',
      schoolName: profile.schoolName,
      state: profile.state,
      services: profile.services,
      clientType: profile.clientType,
      invitedByUserId: session.user.id,
      invitedByEmail: session.user.email,
      token: tokenHash,
      expiresAt,
      accepted: false,
      createdAt: now,
    }).onConflictDoUpdate({
      target: [invitations.email, invitations.schoolName],
      set: {
        role: 'school_staff',
        schoolContactRole: 'school_staff',
        state: profile.state,
        services: profile.services,
        clientType: profile.clientType,
        invitedByUserId: session.user.id,
        invitedByEmail: session.user.email,
        token: tokenHash,
        expiresAt,
        accepted: false,
        createdAt: now,
      }
    })

    const env = await getEnv()
    const authUrl = (env as any).BETTER_AUTH_URL || 'http://localhost:3000'
    const inviteLink = `${authUrl}/login?invite_token=${token}`
    const inviteEmail = buildInviteEmail({
      inviteLink,
      schoolName: profile.schoolName,
      services: profile.services,
      schoolContactRole: 'school_staff',
      expiresAt,
    })

    let emailSent = false
    let emailError = ''
    try {
      const emailSender = (env as any).EMAIL
      if (emailSender && typeof emailSender.send === 'function') {
        await emailSender.send({
          to: email,
          from: { email: 'onboarding@rcormier.dev', name: 'Vertex Education' },
          subject: inviteEmail.subject,
          text: inviteEmail.text,
          html: inviteEmail.html,
        })
        emailSent = true
      } else {
        emailError = 'Cloudflare EMAIL binding not found or not configured.'
      }
    } catch (e: any) {
      emailError = e?.message || String(e)
    }

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'client',
      category: 'invite',
      action: emailSent ? 'school_staff_invite_sent' : 'school_staff_invite_created',
      message: emailSent
        ? `School staff invite sent to ${email}.`
        : `School staff invite created for ${email}; email delivery was not completed.`,
      entityType: 'invitation',
      schoolName: profile.schoolName,
      clientEmail: email,
      metadata: {
        role: 'school_staff',
        schoolContactRole: 'school_staff',
        invitedByEmail: session.user.email,
        expiresAt: expiresAt.toISOString(),
        emailSent,
        emailError: emailError || null,
      },
    })

    return {
      success: true,
      inviteLink,
      emailSent,
      emailError,
    }
  })

export const listInvites = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { db } = await import('#/db')
    const { invitations } = await import('#/db/schema')

    await requireAdminSession()

    const rows = await db.select().from(invitations).orderBy(desc(invitations.createdAt)).all()
    return rows.map(({ token: _token, ...invite }) => invite)
  })

export const revokeInvite = createServerFn({ method: 'POST' })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { db } = await import('#/db')
    const { invitations } = await import('#/db/schema')

    await assertTrustedOrigin()
    const session = await requireAdminSession()

    const results = await db.select().from(invitations).where(eq(invitations.id, id)).all()
    const invite = results[0]

    if (!invite) {
      throw new Error('Invitation not found.')
    }

    if (invite.accepted) {
      throw new Error('Accepted invitations cannot be revoked from this panel.')
    }

    await db.delete(invitations).where(eq(invitations.id, id)).run()

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'admin',
      category: 'invite',
      action: 'invite_revoked',
      message: `Invite revoked for ${invite.email}.`,
      entityType: 'invitation',
      entityId: invite.id,
      schoolName: invite.schoolName,
      clientEmail: invite.email,
      metadata: {
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    })

    return { success: true }
  })

async function upsertSchoolContactForInvite(db: any, invite: {
  schoolName: string | null
  email: string
  schoolContactRole: string | null
  invitedByUserId?: string | null
  invitedByEmail?: string | null
}, inviteUser: {
  id: string
  name: string
  email: string
}) {
  if (!invite.schoolName) return

  const { schoolContacts } = await import('#/db/schema')
  const now = new Date()
  await db
    .insert(schoolContacts)
    .values({
      id: crypto.randomUUID(),
      schoolName: invite.schoolName,
      userId: inviteUser.id,
      email: invite.email,
      name: inviteUser.name,
      contactRole: invite.schoolContactRole || 'school_leader',
      invitedByUserId: invite.invitedByUserId || null,
      invitedByEmail: invite.invitedByEmail || null,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schoolContacts.schoolName, schoolContacts.email],
      set: {
        userId: inviteUser.id,
        name: inviteUser.name,
        contactRole: invite.schoolContactRole || 'school_leader',
        invitedByUserId: invite.invitedByUserId || null,
        invitedByEmail: invite.invitedByEmail || null,
        acceptedAt: now,
        updatedAt: now,
      },
    })
    .run()
}

export const getInviteByToken = createServerFn({ method: 'GET' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const { db } = await import('#/db')
    const { invitations, user } = await import('#/db/schema')

    const tokenHash = await hashInviteToken(token)
    const results = await db.select().from(invitations).where(eq(invitations.token, tokenHash)).all()
    if (!results || results.length === 0) {
      throw new Error('Invitation link is invalid.')
    }
    const invite = results[0]
    if (!invite.accepted && invite.expiresAt.getTime() < Date.now()) {
      throw new Error('This invitation has expired.')
    }
    const existingUsers = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, invite.email))
      .all()
    const { token: _token, ...safeInvite } = invite

    return {
      ...safeInvite,
      accountExists: existingUsers.length > 0,
    }
  })

export const acceptInviteForCurrentUser = createServerFn({ method: 'POST' })
  .validator((token: string) => token)
  .handler(async ({ data: token }) => {
    const { auth } = await import('#/lib/auth')
    const { db } = await import('#/db')
    const { invitations, user } = await import('#/db/schema')

    await assertTrustedOrigin()

    const request = await getServerRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user?.email) {
      throw new Error('Sign in before accepting this invitation.')
    }

    const tokenHash = await hashInviteToken(token)
    const results = await db.select().from(invitations).where(eq(invitations.token, tokenHash)).all()
    const invite = results[0]

    if (!invite) {
      throw new Error('Invitation is invalid.')
    }
    if (invite.email !== session.user.email) {
      throw new Error('This invitation belongs to a different email address.')
    }
    if (!invite.accepted && invite.expiresAt.getTime() < Date.now()) {
      throw new Error('Invitation has expired.')
    }

    const inviteUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, invite.email))
      .all()
    const inviteUser = inviteUsers[0]

    if (!inviteUser) {
      throw new Error('Account was not found for this invitation.')
    }

    if (!['admin', 'vertex_user'].includes(inviteUser.role) || !isSchoolAccountRole(invite.role)) {
      await db.update(user)
        .set({ role: normalizeSchoolAccountRole(invite.role) })
        .where(eq(user.email, invite.email))
        .run()
    }

    await upsertSchoolContactForInvite(db, invite, inviteUser)

    await db.update(invitations)
      .set({ accepted: true })
      .where(eq(invitations.token, tokenHash))
      .run()

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request,
      surface: isSchoolAccountRole(invite.role) ? 'client' : 'vertex',
      category: 'invite',
      action: 'invite_accepted_existing_account',
      message: `Invite accepted by ${invite.email}.`,
      entityType: 'invitation',
      entityId: invite.id,
      schoolName: invite.schoolName,
      clientEmail: invite.email,
      metadata: {
        role: invite.role,
      },
    })

    return {
      success: true,
      email: invite.email,
      role: normalizeSchoolAccountRole(invite.role),
      schoolContactRole: invite.schoolContactRole,
      schoolName: invite.schoolName,
    }
  })

export const acceptInvite = createServerFn({ method: 'POST' })
  .validator((data: {
    token: string
    name: string
    password?: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { account, invitations, user } = await import('#/db/schema')
    const { auth } = await import('#/lib/auth')
    const { hashPassword } = await import('@better-auth/utils/password')
    const { and } = await import('drizzle-orm')

    await assertTrustedOrigin()

    const password = data.password?.trim()
    if (!password || password.length < 6) {
      throw new Error('Password must be at least 6 characters.')
    }

    const tokenHash = await hashInviteToken(data.token)
    const results = await db.select().from(invitations).where(eq(invitations.token, tokenHash)).all()
    if (!results || results.length === 0) {
      throw new Error('Invitation is invalid.')
    }
    const invite = results[0]
    if (invite.accepted) {
      throw new Error('Invitation already accepted.')
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new Error('Invitation has expired.')
    }

    // Hash and store user credentials via Better Auth's email/password endpoint.
    try {
      await auth.api.signUpEmail({
        headers: new Headers(),
        body: {
          email: invite.email,
          password,
          name: data.name,
        },
      })
    } catch (e: any) {
      const message = String(e?.message || e)
      if (!message.includes('already exists') && !message.includes('USER_ALREADY_EXISTS')) {
        throw e
      }
    }

    const inviteUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, invite.email))
      .all()
    const inviteUser = inviteUsers[0]

    if (!inviteUser) {
      throw new Error('Account was not created for this invitation.')
    }

    if (!['admin', 'vertex_user'].includes(inviteUser.role) || !isSchoolAccountRole(invite.role)) {
      await db.update(user)
        .set({ role: normalizeSchoolAccountRole(invite.role) })
        .where(eq(user.email, invite.email))
        .run()
    }

    await upsertSchoolContactForInvite(db, invite, inviteUser)

    // Ensure retry/reinvite flows use the password entered on this invite screen.
    const hashedPassword = await hashPassword(password)
    const now = new Date()
    const existingCredentialAccount = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, inviteUser.id), eq(account.providerId, 'credential')))
      .get()

    if (existingCredentialAccount) {
      await db
        .update(account)
        .set({
          accountId: inviteUser.id,
          password: hashedPassword,
          updatedAt: now,
        })
        .where(eq(account.id, existingCredentialAccount.id))
        .run()
    } else {
      await db
        .insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: inviteUser.id,
          providerId: 'credential',
          userId: inviteUser.id,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    // Mark invitation as accepted
    await db.update(invitations)
      .set({ accepted: true })
      .where(eq(invitations.token, tokenHash))
      .run()

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session: {
        user: {
          id: inviteUser.id,
          email: inviteUser.email,
          name: inviteUser.name,
          role: invite.role,
        },
      } as AppSession,
      request: await getServerRequest(),
      surface: isSchoolAccountRole(invite.role) ? 'client' : 'vertex',
      category: 'invite',
      action: 'invite_accepted_new_account',
      message: `Invite accepted and account prepared for ${invite.email}.`,
      entityType: 'invitation',
      entityId: invite.id,
      schoolName: invite.schoolName,
      clientEmail: invite.email,
      metadata: {
        role: invite.role,
      },
    })

    return {
      success: true,
      email: invite.email,
      role: normalizeSchoolAccountRole(invite.role),
      schoolContactRole: invite.schoolContactRole,
    }
  })

export const resetInviteAccountPassword = createServerFn({ method: 'POST' })
  .validator((data: {
    token: string
    password: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { account, invitations, user } = await import('#/db/schema')
    const { hashPassword } = await import('@better-auth/utils/password')
    const { and } = await import('drizzle-orm')

    await assertTrustedOrigin()

    const password = data.password.trim()
    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.')
    }

    const tokenHash = await hashInviteToken(data.token)
    const results = await db.select().from(invitations).where(eq(invitations.token, tokenHash)).all()
    const invite = results[0]

    if (!invite) {
      throw new Error('Invitation is invalid.')
    }
    if (!invite.accepted && invite.expiresAt.getTime() < Date.now()) {
      throw new Error('Invitation has expired.')
    }

    const inviteUsers = await db
      .select()
      .from(user)
      .where(eq(user.email, invite.email))
      .all()
    const inviteUser = inviteUsers[0]

    if (!inviteUser) {
      throw new Error('No account exists for this invitation yet.')
    }

    const hashedPassword = await hashPassword(password)
    const now = new Date()
    const existingCredentialAccount = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, inviteUser.id), eq(account.providerId, 'credential')))
      .get()

    if (existingCredentialAccount) {
      await db
        .update(account)
        .set({
          accountId: inviteUser.id,
          password: hashedPassword,
          updatedAt: now,
        })
        .where(eq(account.id, existingCredentialAccount.id))
        .run()
    } else {
      await db
        .insert(account)
        .values({
          id: crypto.randomUUID(),
          accountId: inviteUser.id,
          providerId: 'credential',
          userId: inviteUser.id,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    }

    if (!['admin', 'vertex_user'].includes(inviteUser.role) || !isSchoolAccountRole(invite.role)) {
      await db.update(user)
        .set({ role: normalizeSchoolAccountRole(invite.role) })
        .where(eq(user.email, invite.email))
        .run()
    }

    await upsertSchoolContactForInvite(db, invite, inviteUser)

    await db.update(invitations)
      .set({ accepted: true })
      .where(eq(invitations.token, tokenHash))
      .run()

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session: {
        user: {
          id: inviteUser.id,
          email: inviteUser.email,
          name: inviteUser.name,
          role: invite.role,
        },
      } as AppSession,
      request: await getServerRequest(),
      surface: isSchoolAccountRole(invite.role) ? 'client' : 'vertex',
      category: 'account',
      action: 'invite_password_reset',
      message: `Invite account password reset for ${invite.email}.`,
      entityType: 'invitation',
      entityId: invite.id,
      schoolName: invite.schoolName,
      clientEmail: invite.email,
      metadata: {
        role: invite.role,
        schoolContactRole: invite.schoolContactRole,
      },
    })

    return {
      success: true,
      email: invite.email,
      role: normalizeSchoolAccountRole(invite.role),
      schoolContactRole: invite.schoolContactRole,
      schoolName: invite.schoolName,
    }
  })
