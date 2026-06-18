import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckSquare, ChevronLeft, ChevronRight, Clock3, ExternalLink, Lock, MessageCircle, Mountain, Pencil, Send, Sparkles, Users, X } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { completeOnboardingTaskManually, getOnboardingTasks } from '#/lib/asana'
import { uploadOnboardingFile } from '#/lib/uploads'
import { AiDisclosure } from '#/components/AiDisclosure'
import { BrandedAlert } from '#/components/BrandedAlert'
import { getServerRequest } from '#/lib/security'

export const Route = createFileRoute('/school-onboarding')({
  component: SchoolOnboardingPage,
})

type VertexAIResponse = {
  text: string
  isFallback: boolean
  model: string
  diagnostic: string | null
}

type ChatTab = 'ai' | 'staff'

type ConversationMessage = {
  id: string
  conversationId: string
  schoolName: string
  channel: ChatTab
  senderType: 'client' | 'staff' | 'ai' | 'system'
  senderUserId: string | null
  senderEmail: string | null
  senderName: string | null
  body: string
  aiModel: string | null
  aiDiagnostic: string | null
  metadata: unknown
  createdAt: string
}

type ConversationView = {
  conversationId: string
  schoolName: string
  channel: ChatTab
  messages: ConversationMessage[]
  unreadCount: number
  lastReadAt: string | null
  lastMessageCreatedAt: string | null
}

type ContractProfile = {
  schoolName: string
  state: string
  services: string
  clientType: string
  contact: string
  csOwner: string
  contactRole: 'school_leader' | 'school_staff'
}

type SchoolContact = {
  id: string
  schoolName: string
  userId: string | null
  email: string
  name: string | null
  contactRole: 'school_leader' | 'school_staff'
  invitedByUserId: string | null
  invitedByEmail: string | null
}

type TaskAssignment = {
  id: string
  schoolName: string
  asanaTaskId: string
  assignedToUserId: string | null
  assignedToEmail: string
  assignedToName: string | null
}

type IntakeRatingQuestion = {
  id: string
  label: string
}

type IntakeStep = {
  id: string
  title: string
  prompt: string
  kind: 'rating' | 'text'
  helperText?: string
  questions?: IntakeRatingQuestion[]
  placeholder?: string
}

type IntakeResponses = Record<string, string | Record<string, number>>

type SchoolIntakeResponseState = {
  responses: IntakeResponses
  completedStepIds: string[]
  submittedAt: string | null
}

type OnboardingOperationStatus =
  | 'idle'
  | 'preparing-upload'
  | 'storing-file'
  | 'syncing-asana'
  | 'saving-task'
  | 'refreshing'
  | 'success'
  | 'error'

type DueFlag = 'overdue' | 'today' | 'soon' | null

function getDueFlagLabel(dueFlag: DueFlag, daysUntilDue: number | null) {
  if (dueFlag === 'overdue') {
    const daysOverdue = Math.abs(daysUntilDue ?? 0)
    return daysOverdue === 1 ? 'Overdue by 1 day' : `Overdue by ${daysOverdue} days`
  }
  if (dueFlag === 'today') return 'Due today'
  if (dueFlag === 'soon') {
    return daysUntilDue === 1 ? 'Due tomorrow' : `Due in ${daysUntilDue} days`
  }
  return ''
}

function getDueFlagClass(dueFlag: DueFlag) {
  if (dueFlag === 'overdue') return 'border-red-200 bg-red-100 text-red-700'
  if (dueFlag === 'today') return 'border-amber-200 bg-amber-100 text-amber-800'
  if (dueFlag === 'soon') return 'border-amber-100 bg-amber-50 text-amber-700'
  return ''
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function fetchConversation(schoolName: string, channel: ChatTab) {
  const response = await fetch(`/api/conversations?schoolName=${encodeURIComponent(schoolName)}&channel=${channel}`)
  const data = await response.json() as ConversationView | { error?: string }
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : 'Unable to load conversation.')
  }
  return data as ConversationView
}

async function markConversationReadRequest(schoolName: string, channel: ChatTab) {
  await fetch('/api/conversations/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schoolName, channel }),
  })
}

const reportContractDiscrepancy = createServerFn({ method: 'POST' })
  .validator((data: {
    discrepancy: string
    profile: ContractProfile
  }) => data)
  .handler(async ({ data }) => {
    const { auth } = await import('#/lib/auth')
    const { db } = await import('#/db')
    const { user } = await import('#/db/schema')
    const { eq } = await import('drizzle-orm')
    const { getCloudflareEnv } = await import('#/lib/cloudflare-env.server')
    const env = getCloudflareEnv()

    const request = await getServerRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user) {
      throw new Error('You must be signed in to report a discrepancy.')
    }

    const discrepancy = data.discrepancy.trim()
    if (!discrepancy) {
      throw new Error('Describe what needs to be corrected before sending.')
    }

    const admins = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.role, 'admin'))
      .all()

    const fallbackAdminEmail = (env as any).VERTEX_ADMIN_EMAIL
    const recipients = Array.from(new Set([
      ...admins.map((admin) => admin.email).filter(Boolean),
      ...(fallbackAdminEmail ? [fallbackAdminEmail] : []),
    ]))

    if (recipients.length === 0) {
      return {
        success: true,
        emailSent: false,
        emailError: 'No admin recipient is configured.',
      }
    }

    const profileLines = [
      ['School', data.profile.schoolName],
      ['State', data.profile.state],
      ['Services', data.profile.services],
      ['Client Type', data.profile.clientType],
      ['Contact', data.profile.contact],
      ['Coordinator', data.profile.csOwner],
    ]

    const reporterName = session.user.name || 'Signed-in user'
    const reporterEmail = session.user.email || 'unknown'
    const subject = `Contract profile discrepancy: ${data.profile.schoolName}`
    const text = [
      'A client reported a contract profile discrepancy in Vertex Bridge.',
      '',
      `Reported by: ${reporterName} <${reporterEmail}>`,
      '',
      'Discrepancy:',
      discrepancy,
      '',
      'Displayed contract profile:',
      ...profileLines.map(([label, value]) => `${label}: ${value}`),
    ].join('\n')

    const htmlRows = profileLines
      .map(([label, value]) => `
        <tr>
          <td style="padding:8px 12px; font-size:12px; font-weight:800; color:#707372; text-transform:uppercase; letter-spacing:0.08em;">${escapeHtml(label)}</td>
          <td style="padding:8px 12px; font-size:14px; color:#404342;">${escapeHtml(value)}</td>
        </tr>`)
      .join('')

    const html = `<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#f4f6f7; color:#404342; font-family:'DM Sans', Arial, sans-serif;">
    <div style="max-width:640px; margin:0 auto; padding:32px 16px;">
      <div style="background:#ffffff; border:1px solid rgba(0,56,101,0.12); border-radius:16px; overflow:hidden;">
        <div style="padding:24px 28px; border-bottom:1px solid rgba(0,56,101,0.10);">
          <div style="font-size:11px; line-height:1.4; letter-spacing:0.16em; text-transform:uppercase; font-weight:800; color:#CBA052;">Vertex Bridge Alert</div>
          <h1 style="margin:8px 0 0 0; font-size:24px; line-height:1.2; color:#003865;">Contract profile discrepancy</h1>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px 0; font-size:14px; line-height:1.6;">${escapeHtml(reporterName)} reported that their contract profile needs correction.</p>
          <div style="margin:0 0 20px 0; padding:14px 16px; border-left:4px solid #CBA052; background:#fbfcfc; border-radius:10px;">
            <div style="font-size:11px; font-weight:800; color:#707372; text-transform:uppercase; letter-spacing:0.1em;">Discrepancy</div>
            <p style="margin:6px 0 0 0; font-size:14px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(discrepancy)}</p>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse; border:1px solid rgba(0,56,101,0.12); border-radius:12px; overflow:hidden;">
            ${htmlRows}
          </table>
          <p style="margin:18px 0 0 0; font-size:12px; color:#707372;">Reporter email: ${escapeHtml(reporterEmail)}</p>
        </div>
      </div>
    </div>
  </body>
</html>`

    let emailSent = false
    let emailError = ''
    try {
      const emailSender = (env as any).EMAIL
      if (emailSender && typeof emailSender.send === 'function') {
        await Promise.all(
          recipients.map((recipient) =>
            emailSender.send({
              to: recipient,
              from: { email: 'onboarding@rcormier.dev', name: 'Vertex Bridge' },
              subject,
              text,
              html,
            }),
          ),
        )
        emailSent = true
      } else {
        emailError = 'Cloudflare EMAIL binding not found or not configured.'
      }
    } catch (e: any) {
      emailError = e?.message || String(e)
    }

    return {
      success: true,
      emailSent,
      emailError,
    }
  })

const listCurrentUserSchoolProfiles = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { auth } = await import('#/lib/auth')
    const { db } = await import('#/db')
    const { clientProfiles, invitations, schoolContacts } = await import('#/db/schema')
    const { asc, eq } = await import('drizzle-orm')

    const request = await getServerRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user?.email) {
      return []
    }

    const [inviteRows, profileRows, contactRows, allProfiles] = await Promise.all([
      db
        .select()
        .from(invitations)
        .where(eq(invitations.email, session.user.email))
        .orderBy(asc(invitations.schoolName))
        .all(),
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
        .from(clientProfiles)
        .orderBy(asc(clientProfiles.schoolName))
        .all(),
    ])

    const profilesBySchool = new Map<string, ContractProfile>()
    const allProfilesBySchool = new Map(allProfiles.map((school) => [school.schoolName, school]))

    for (const profile of profileRows) {
      profilesBySchool.set(profile.schoolName, {
        schoolName: profile.schoolName,
        state: profile.state,
        services: profile.services,
        clientType: profile.clientType,
        contact: session.user.name || profile.primaryContactName,
        csOwner: profile.onboardingCoordinator,
        contactRole: 'school_leader',
      })
    }

    for (const contact of contactRows) {
      const profile = allProfilesBySchool.get(contact.schoolName)
      profilesBySchool.set(contact.schoolName, {
        schoolName: contact.schoolName,
        state: profile?.state || 'Not specified',
        services: profile?.services || 'Not specified',
        clientType: profile?.clientType || 'Not specified',
        contact: session.user.name || contact.name || 'Signed-in user',
        csOwner: profile?.onboardingCoordinator || 'Vertex onboarding team',
        contactRole: contact.contactRole === 'school_leader' ? 'school_leader' : 'school_staff',
      })
    }

    for (const invite of inviteRows) {
      if (!invite.schoolName || profilesBySchool.has(invite.schoolName)) continue
      const profile = allProfilesBySchool.get(invite.schoolName)
      profilesBySchool.set(invite.schoolName, {
        schoolName: invite.schoolName,
        state: profile?.state || invite.state || 'Not specified',
        services: profile?.services || invite.services || 'Not specified',
        clientType: profile?.clientType || invite.clientType || 'Not specified',
        contact: session.user.name || 'Signed-in user',
        csOwner: profile?.onboardingCoordinator || 'Vertex onboarding team',
        contactRole: invite.schoolContactRole === 'school_staff' ? 'school_staff' : 'school_leader',
      })
    }

    return Array.from(profilesBySchool.values())
  })

const listSchoolContacts = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { clientProfiles, schoolContacts } = await import('#/db/schema')
    const { assertCanAccessSchool, requireSession } = await import('#/lib/security')
    const { eq } = await import('drizzle-orm')

    const session = await requireSession()
    await assertCanAccessSchool(session, schoolName)

    const [contacts, profiles] = await Promise.all([
      db
        .select()
        .from(schoolContacts)
        .where(eq(schoolContacts.schoolName, schoolName))
        .all(),
      db
        .select()
        .from(clientProfiles)
        .where(eq(clientProfiles.schoolName, schoolName))
        .all(),
    ])
    const profile = profiles[0]
    const contactsByEmail = new Map<string, SchoolContact>()

    if (profile?.primaryContactEmail) {
      contactsByEmail.set(profile.primaryContactEmail, {
        id: `primary:${profile.primaryContactEmail}`,
        schoolName,
        userId: null,
        email: profile.primaryContactEmail,
        name: profile.primaryContactName,
        contactRole: 'school_leader',
        invitedByUserId: null,
        invitedByEmail: null,
      })
    }

    for (const contact of contacts) {
      contactsByEmail.set(contact.email, {
        id: contact.id,
        schoolName: contact.schoolName,
        userId: contact.userId,
        email: contact.email,
        name: contact.name,
        contactRole: contact.contactRole === 'school_leader' ? 'school_leader' : 'school_staff',
        invitedByUserId: contact.invitedByUserId,
        invitedByEmail: contact.invitedByEmail,
      })
    }

    return Array.from(contactsByEmail.values()).sort((a, b) => {
      if (a.contactRole !== b.contactRole) return a.contactRole === 'school_leader' ? -1 : 1
      return a.email.localeCompare(b.email)
    })
  })

const listTaskAssignments = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { schoolOnboardingTaskAssignments } = await import('#/db/schema')
    const { assertCanAccessSchool, requireSession } = await import('#/lib/security')
    const { eq } = await import('drizzle-orm')

    const session = await requireSession()
    await assertCanAccessSchool(session, schoolName)

    return db
      .select({
        id: schoolOnboardingTaskAssignments.id,
        schoolName: schoolOnboardingTaskAssignments.schoolName,
        asanaTaskId: schoolOnboardingTaskAssignments.asanaTaskId,
        assignedToUserId: schoolOnboardingTaskAssignments.assignedToUserId,
        assignedToEmail: schoolOnboardingTaskAssignments.assignedToEmail,
        assignedToName: schoolOnboardingTaskAssignments.assignedToName,
      })
      .from(schoolOnboardingTaskAssignments)
      .where(eq(schoolOnboardingTaskAssignments.schoolName, schoolName))
      .all()
  })

const assignOnboardingTask = createServerFn({ method: 'POST' })
  .validator((data: {
    schoolName: string
    taskId: string
    assignedToEmail: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { clientProfiles, schoolContacts, schoolOnboardingTaskAssignments } = await import('#/db/schema')
    const { assertCanAccessSchool, assertTrustedOrigin, requireSession } = await import('#/lib/security')
    const { eq } = await import('drizzle-orm')

    await assertTrustedOrigin()
    const session = await requireSession()
    await assertCanAccessSchool(session, data.schoolName)

    const [contacts, profiles] = await Promise.all([
      db
        .select()
        .from(schoolContacts)
        .where(eq(schoolContacts.schoolName, data.schoolName))
        .all(),
      db
        .select()
        .from(clientProfiles)
        .where(eq(clientProfiles.schoolName, data.schoolName))
        .all(),
    ])
    const profile = profiles[0]
    const targetEmail = data.assignedToEmail.trim().toLowerCase()
    const currentContact = contacts.find((contact: any) => contact.email === session.user.email)
    const isSchoolLeader = profile?.primaryContactEmail === session.user.email || currentContact?.contactRole === 'school_leader'

    const targetContact = contacts.find((contact: any) => contact.email === targetEmail)
    const targetIsPrimary = profile?.primaryContactEmail === targetEmail

    if (!targetContact && !targetIsPrimary) {
      throw new Error('Choose a staff member from this school before assigning the task.')
    }

    if (!isSchoolLeader) {
      throw new Error('Only School Leaders can change task owners.')
    }

    const now = new Date()
    await db
      .insert(schoolOnboardingTaskAssignments)
      .values({
        id: crypto.randomUUID(),
        schoolName: data.schoolName,
        asanaTaskId: data.taskId,
        assignedToUserId: targetContact?.userId || null,
        assignedToEmail: targetEmail,
        assignedToName: targetContact?.name || (targetIsPrimary ? profile?.primaryContactName : null),
        assignedByUserId: session.user.id,
        assignedByEmail: session.user.email,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [schoolOnboardingTaskAssignments.schoolName, schoolOnboardingTaskAssignments.asanaTaskId],
        set: {
          assignedToUserId: targetContact?.userId || null,
          assignedToEmail: targetEmail,
          assignedToName: targetContact?.name || (targetIsPrimary ? profile?.primaryContactName : null),
          assignedByUserId: session.user.id,
          assignedByEmail: session.user.email,
          assignedAt: now,
          updatedAt: now,
        },
      })
      .run()

    return { success: true }
  })

const getSchoolIntakeResponses = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { schoolOnboardingIntakeResponses } = await import('#/db/schema')
    const { assertCanAccessSchool, requireSession } = await import('#/lib/security')
    const { eq } = await import('drizzle-orm')

    const session = await requireSession()
    await assertCanAccessSchool(session, schoolName)

    const rows = await db
      .select()
      .from(schoolOnboardingIntakeResponses)
      .where(eq(schoolOnboardingIntakeResponses.schoolName, schoolName))
      .all()

    const row = rows[0]
    if (!row) return getEmptyIntakeState()

    try {
      const submittedAt = row.submittedAt instanceof Date
        ? row.submittedAt.toISOString()
        : row.submittedAt
          ? new Date(row.submittedAt).toISOString()
          : null

      return {
        responses: JSON.parse(row.responseJson || '{}') as IntakeResponses,
        completedStepIds: JSON.parse(row.completedStepIdsJson || '[]') as string[],
        submittedAt,
      }
    } catch {
      return getEmptyIntakeState()
    }
  })

const saveSchoolIntakeResponses = createServerFn({ method: 'POST' })
  .validator((data: {
    schoolName: string
    responses: IntakeResponses
    completedStepIds: string[]
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { schoolOnboardingIntakeResponses } = await import('#/db/schema')
    const { assertCanAccessSchool, assertTrustedOrigin, requireSession } = await import('#/lib/security')

    await assertTrustedOrigin()
    const session = await requireSession()
    await assertCanAccessSchool(session, data.schoolName)

    const now = new Date()
    const completedStepIds = Array.from(new Set(data.completedStepIds.filter(Boolean)))

    await db
      .insert(schoolOnboardingIntakeResponses)
      .values({
        schoolName: data.schoolName,
        responseJson: JSON.stringify(data.responses || {}),
        completedStepIdsJson: JSON.stringify(completedStepIds),
        submittedByUserId: session.user.id,
        submittedByEmail: session.user.email,
        submittedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolOnboardingIntakeResponses.schoolName,
        set: {
          responseJson: JSON.stringify(data.responses || {}),
          completedStepIdsJson: JSON.stringify(completedStepIds),
          submittedByUserId: session.user.id,
          submittedByEmail: session.user.email,
          submittedAt: now,
          updatedAt: now,
        },
      })
      .run()

    return {
      success: true,
      completedStepIds,
      submittedAt: now.toISOString(),
    }
  })

const profileStepCount = 1
const completedStageStorageKey = 'vertex-bridge:onboarding-complete-stage'
const resumeStepStorageKey = 'vertex-bridge:onboarding-resume-step'

const sfoInternalReadinessQuestions: IntakeRatingQuestion[] = [
  {
    id: 'accounting-processes-documented',
    label: 'Our accounting processes are documented and consistently followed.',
  },
  {
    id: 'ap-demand-independent',
    label: 'Our team can manage day-to-day accounts payable demands independently.',
  },
  {
    id: 'budget-visibility',
    label: 'We have reliable visibility into our budget position at any given time.',
  },
  {
    id: 'payroll-predictable',
    label: 'Our payroll process runs predictably and on schedule.',
  },
  {
    id: 'grants-compliance-confidence',
    label: 'We feel confident in our current grants tracking and compliance documentation.',
  },
]

const sfoExternalReadinessQuestions: IntakeRatingQuestion[] = [
  {
    id: 'handoff-accounting',
    label: 'Handing off day-to-day accounting responsibilities.',
  },
  {
    id: 'share-financial-access',
    label: 'Sharing access to financial systems and bank information.',
  },
  {
    id: 'communication-rhythm',
    label: 'Establishing a communication rhythm with an outside SFO team.',
  },
  {
    id: 'partner-payroll',
    label: 'Trusting an outside partner to manage payroll on our behalf.',
  },
  {
    id: 'delegate-grants',
    label: 'Delegating grants reporting and compliance documentation.',
  },
]

function getIntakeSteps(): IntakeStep[] {
  return [
    {
      id: 'sfo-internal-readiness',
      title: 'SFO Internal Readiness',
      prompt: 'Rate your confidence in each of the following statements about your current SFO operations.',
      helperText: '1 = Not at all confident, 5 = Very confident',
      kind: 'rating',
      questions: sfoInternalReadinessQuestions,
    },
    {
      id: 'sfo-external-readiness',
      title: 'SFO External Readiness',
      prompt: 'Rate your readiness to transition each of the following to an outside partner.',
      helperText: '1 = Not ready, 5 = Fully ready',
      kind: 'rating',
      questions: sfoExternalReadinessQuestions,
    },
    {
      id: 'team-context',
      title: 'Team Context',
      prompt: 'Tell us a little about your leadership team and their experience.',
      helperText: 'Open text, 2-3 sentences.',
      kind: 'text',
      placeholder: 'For example: roles, years in education or school operations, and any relevant background.',
    },
    {
      id: 'current-pain',
      title: 'Current Pain',
      prompt: "What's keeping your business office up at night right now?",
      helperText: 'Open text, 2-3 sentences.',
      kind: 'text',
    },
    {
      id: 'success-definition',
      title: 'Success Definition',
      prompt: 'A year from now, what would make you say this partnership was worth it?',
      helperText: 'Open text, 2-3 sentences.',
      kind: 'text',
    },
  ]
}

function isIntakeStepComplete(step: IntakeStep, responses: IntakeResponses) {
  const response = responses[step.id]

  if (step.kind === 'text') {
    return typeof response === 'string' && response.trim().length > 0
  }

  if (!step.questions || typeof response !== 'object' || response === null || Array.isArray(response)) {
    return false
  }

  return step.questions.every((question) => {
    const value = response[question.id]
    return Number.isInteger(value) && value >= 1 && value <= 5
  })
}

function getEmptyIntakeState(): SchoolIntakeResponseState {
  return {
    responses: {},
    completedStepIds: [],
    submittedAt: null,
  }
}

type StoredResumeStep = {
  type: 'profile' | 'intake' | 'task'
  intakeStepId?: string
  taskId?: string
}

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200/80 ${className}`} />
}

function OnboardingTaskSkeleton() {
  return (
    <div className="island-shell overflow-hidden rounded-2xl shadow-md">
      <div className="space-y-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex gap-2">
              <SkeletonBlock className="h-5 w-24 rounded-full" />
              <SkeletonBlock className="h-5 w-28 rounded-full" />
            </div>
            <SkeletonBlock className="h-8 w-full max-w-xl" />
          </div>
          <div className="space-y-2">
            <SkeletonBlock className="h-3 w-16" />
            <SkeletonBlock className="h-4 w-24" />
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200/80 bg-neutral-50 p-4">
          <SkeletonBlock className="mb-4 h-3 w-36" />
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-11/12" />
            <SkeletonBlock className="h-4 w-2/3" />
          </div>
        </div>

        <div className="border-t border-[var(--line)] pt-6">
          <SkeletonBlock className="mb-4 h-3 w-44" />
          <div className="flex min-h-44 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--chip-line)] p-8">
            <SkeletonBlock className="mb-4 h-10 w-10 rounded-full" />
            <SkeletonBlock className="mb-2 h-4 w-64 max-w-full" />
            <SkeletonBlock className="h-3 w-48 max-w-full" />
          </div>
        </div>
      </div>
    </div>
  )
}

function LoadingJourneyOverlay() {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(244,246,247,0.88)] px-4 backdrop-blur-md">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
        <div className="relative h-36 overflow-hidden bg-[var(--vertex-blue)]">
          <img
            src="/brand/mountain-blue.svg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-35"
          />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,56,101,0.92),rgba(0,56,101,0.62))]" />
          <img
            src="/brand/vertex-icon-square.png"
            alt=""
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/30 bg-white/95 p-2 shadow-xl"
          />
        </div>
        <div className="p-6 text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-solid border-[var(--vertex-blue)] border-r-transparent" />
          <p className="font-display text-xl font-bold text-[var(--vertex-blue)]">
            Loading your onboarding journey...
          </p>
        </div>
      </div>
    </div>
  )
}

const WELCOME_SEEN_KEY = 'vertex-bridge:welcome-seen'
const WELCOME_REPLAY_KEY = 'vertex-bridge:replay-welcome'

type WelcomeSlide = {
  id: number
  kicker: string
  title: string
  body: string
  visual: React.ReactNode
}

function WelcomeModal({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0)

  const slides: WelcomeSlide[] = [
    {
      id: 0,
      kicker: 'Welcome to the Vertex Hub',
      title: 'Your Base Camp Awaits',
      body: "Every great summit starts with a first step. You've crossed the bridge — and now the path to a seamless onboarding experience stretches out before you. This brief tour will orient you to everything the Vertex Hub has to offer so you can hit the trail running.",
      visual: (
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="relative flex h-24 w-24 items-center justify-center rounded-3xl bg-[var(--vertex-blue)] shadow-xl">
            <img src="/brand/vertex-icon-square.png" alt="" aria-hidden="true" className="h-16 w-16 rounded-2xl object-contain" />
          </div>
          <div className="flex items-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`inline-block h-1.5 rounded-full transition-all duration-300 ${i === 0 ? 'w-6 bg-[var(--vertex-blue)]' : 'w-1.5 bg-[var(--chip-line)]'}`}
              />
            ))}
          </div>
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-[var(--vertex-gold)]">Bridging the gap · Reaching the peak</p>
        </div>
      ),
    },
    {
      id: 1,
      kicker: 'Build Your Expedition Team',
      title: 'Add Staff to Your Journey',
      body: "You don't have to trek this path alone. Invite colleagues, administrators, or department leads to join your onboarding workspace. Head to the Staff section in your Hub to send invitations — each team member gets their own view of assigned tasks so nobody falls behind on the ascent.",
      visual: (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--foam)] shadow-sm">
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-white px-3 py-2">
            <Users className="h-4 w-4 text-[var(--vertex-blue)]" />
            <span className="text-xs font-bold text-[var(--vertex-blue)]">Team Members</span>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {[
              { name: 'Alex Rivera', role: 'School Leader', initials: 'AR', active: true },
              { name: 'Jordan Kim', role: 'School Staff', initials: 'JK', active: true },
              { name: 'Sam Patel', role: 'Invite Pending', initials: '?', active: false },
            ].map((member) => (
              <div key={member.name} className="flex items-center gap-3 px-3 py-2.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${member.active ? 'bg-[var(--vertex-blue)]' : 'bg-[var(--light-gray)]'}`}>
                  {member.initials}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[var(--sea-ink)]">{member.name}</p>
                  <p className={`text-[10px] ${member.active ? 'text-[var(--vertex-gray)]' : 'text-[var(--vertex-gold)]'}`}>{member.role}</p>
                </div>
                {member.active && <div className="ml-auto h-2 w-2 rounded-full bg-[var(--tertiary-green)]" />}
              </div>
            ))}
          </div>
          <div className="px-3 py-2">
            <button type="button" className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--vertex-blue)] py-1.5 text-xs font-bold text-white">
              <Users className="h-3.5 w-3.5" />
              Invite a Team Member
            </button>
          </div>
        </div>
      ),
    },
    {
      id: 2,
      kicker: 'Navigate the Trail',
      title: 'Tasks, Files & Milestones',
      body: 'Your onboarding journey is broken into clear checkpoints — each one a stepping stone toward the summit. Complete tasks, upload required documents, and track your progress in real time. Use Journey mode to focus on one step at a time, or switch to Checklist view to see the full trail map at a glance.',
      visual: (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--foam)] shadow-sm">
          <div className="flex items-center gap-2 border-b border-[var(--line)] bg-white px-3 py-2">
            <CheckSquare className="h-4 w-4 text-[var(--vertex-blue)]" />
            <span className="text-xs font-bold text-[var(--vertex-blue)]">Onboarding Tasks</span>
            <span className="ml-auto rounded-full bg-[var(--vertex-blue)] px-2 py-0.5 text-[10px] font-bold text-white">3 / 8</span>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {[
              { label: 'Submit signed SFO agreement', done: true },
              { label: 'Upload enrollment data file', done: true },
              { label: 'Complete intake assessment', done: true },
              { label: 'Review implementation timeline', done: false, active: true },
              { label: 'Schedule kickoff meeting', done: false },
            ].map((task) => (
              <div key={task.label} className={`flex items-center gap-3 px-3 py-2.5 ${(task as any).active ? 'bg-blue-50' : ''}`}>
                <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${task.done ? 'border-[var(--tertiary-green)] bg-[var(--tertiary-green)]' : (task as any).active ? 'border-[var(--vertex-blue)]' : 'border-[var(--chip-line)]'}`}>
                  {task.done && <span className="text-[10px] font-bold text-white">✓</span>}
                  {(task as any).active && <span className="h-2 w-2 rounded-full bg-[var(--vertex-blue)]" />}
                </div>
                <p className={`truncate text-xs ${task.done ? 'text-[var(--vertex-gray)] line-through' : (task as any).active ? 'font-semibold text-[var(--vertex-blue)]' : 'text-[var(--sea-ink)]'}`}>{task.label}</p>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: 3,
      kicker: 'Never Hike Alone',
      title: 'Your AI Guide & Vertex Team',
      body: "Whenever the trail feels steep, help is one tap away. The chat panel gives you instant access to our AI assistant — trained on your specific onboarding journey — and a direct line to your dedicated Vertex team. Look for the chat icon in the lower corner to open it anytime.",
      visual: (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--foam)] shadow-sm">
          <div className="flex border-b border-[var(--line)] bg-white">
            <div className="flex flex-1 items-center justify-center gap-1.5 border-r border-[var(--line)] py-2 text-xs font-bold text-[var(--vertex-blue)]">
              <Sparkles className="h-3.5 w-3.5" />
              AI Assistant
            </div>
            <div className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs font-semibold text-[var(--vertex-gray)]">
              <MessageCircle className="h-3.5 w-3.5" />
              Vertex Team
            </div>
          </div>
          <div className="space-y-2 p-3">
            <div className="flex gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--vertex-blue)]">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <div className="max-w-[80%] rounded-xl rounded-tl-none bg-white px-3 py-2 shadow-sm">
                <p className="text-xs text-[var(--sea-ink)]">Hi! I'm your onboarding guide. Ask me anything about your tasks, documents, or timeline.</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <div className="max-w-[80%] rounded-xl rounded-tr-none bg-[var(--vertex-blue)] px-3 py-2 shadow-sm">
                <p className="text-xs text-white">What documents do I need to upload first?</p>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--vertex-blue)]">
                <Sparkles className="h-3 w-3 text-white" />
              </div>
              <div className="max-w-[80%] rounded-xl rounded-tl-none bg-white px-3 py-2 shadow-sm">
                <p className="text-xs text-[var(--sea-ink)]">Start with your enrollment data file — it's your first trail marker!</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-[var(--line)] bg-white px-3 py-2">
            <input readOnly placeholder="Ask anything…" className="flex-1 rounded-lg bg-[var(--sand)] px-3 py-1.5 text-xs text-[var(--sea-ink)] outline-none" />
            <button type="button" className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--vertex-blue)]">
              <Send className="h-3.5 w-3.5 text-white" />
            </button>
          </div>
        </div>
      ),
    },
  ]

  const currentSlide = slides[slide]
  const isFirst = slide === 0
  const isLast = slide === slides.length - 1

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[rgba(0,30,60,0.72)] px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        {/* Header banner */}
        <div className="relative h-28 overflow-hidden bg-[var(--vertex-blue)]">
          <img
            src="/brand/mountain-blue.svg"
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,56,101,0.95),rgba(0,47,85,0.75))]" />
          <div className="absolute inset-x-0 bottom-0 flex items-end justify-between px-5 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gold)]">{currentSlide.kicker}</p>
              <h2 className="font-display text-xl font-bold text-white leading-tight">{currentSlide.title}</h2>
            </div>
            <Mountain className="h-10 w-10 shrink-0 text-white/20" />
          </div>
          <button
            type="button"
            aria-label="Dismiss welcome tour"
            onClick={onClose}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Slide body */}
        <div className="px-5 pt-5 pb-4">
          <p className="mb-5 text-sm leading-relaxed text-[var(--sea-ink-soft)]">{currentSlide.body}</p>
          {currentSlide.visual}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between border-t border-[var(--line)] px-5 py-3">
          {/* Dot indicators */}
          <div className="flex items-center gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                onClick={() => setSlide(i)}
                className={`rounded-full transition-all duration-200 ${i === slide ? 'w-5 h-2 bg-[var(--vertex-blue)]' : 'w-2 h-2 bg-[var(--chip-line)] hover:bg-[var(--vertex-gray)]'}`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                onClick={() => setSlide((s) => s - 1)}
                className="flex items-center gap-1 rounded-xl border border-[var(--chip-line)] px-3 py-1.5 text-xs font-semibold text-[var(--vertex-blue)] transition hover:bg-[var(--sand)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Back
              </button>
            )}
            {isLast ? (
              <button
                type="button"
                onClick={onClose}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--vertex-blue)] px-4 py-1.5 text-xs font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)]"
              >
                Begin Your Journey
                <Mountain className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setSlide((s) => s + 1)}
                className="flex items-center gap-1.5 rounded-xl bg-[var(--vertex-blue)] px-4 py-1.5 text-xs font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)]"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const completionBurstOffsets = [
  ['-8rem', '-2.6rem'],
  ['-5.8rem', '-0.4rem'],
  ['-6.8rem', '2.2rem'],
  ['-2.4rem', '-2.9rem'],
  ['-1.2rem', '2.8rem'],
  ['2rem', '-2.6rem'],
  ['3.2rem', '2.6rem'],
  ['6.4rem', '-1.9rem'],
  ['7.8rem', '0.7rem'],
  ['5.4rem', '2.4rem'],
] as const

function CompletionCelebration({ taskName }: { taskName: string }) {
  return (
    <div className="completion-celebration pointer-events-none fixed left-1/2 top-5 z-[90] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2" role="status" aria-live="polite">
      <div className="relative overflow-hidden rounded-xl border border-green-200 bg-white px-4 py-3 shadow-2xl">
        <div className="completion-celebration-burst" aria-hidden="true">
          {completionBurstOffsets.map(([burstX, burstY], index) => (
            <span
              key={`${burstX}-${burstY}`}
              style={{
                '--burst-index': index,
                '--burst-x': burstX,
                '--burst-y': burstY,
              } as React.CSSProperties}
            />
          ))}
        </div>
        <div className="relative flex items-center gap-3">
          <span className="completion-celebration-mark inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100" aria-hidden="true">
            <span />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">Progress completed</p>
            <p className="truncate text-sm font-bold text-[var(--sea-ink)]">{taskName}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function renderChatMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
    }

    return part
  })
}

function extractUrls(text: string) {
  const urls = Array.from(text.matchAll(/https?:\/\/[^\s)]+/gi))
    .map((match) => match[0].replace(/[.,;!?]+$/, ''))

  return Array.from(new Set(urls))
}

function removeUrls(text: string) {
  return text
    .replace(/https?:\/\/[^\s)]+/gi, '')
    .replace(/\s+([.,;!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function SchoolOnboardingPage() {
  const queryClient = useQueryClient()
  const { data: session, isPending: authPending } = authClient.useSession()

  const contactName = session?.user?.name || 'the client'

  // Tab state: 'journey' (one-by-one wizard) or 'all' (checklist)
  const [viewMode, setViewMode] = useState<'journey' | 'all'>('journey')
  const [selectedSchoolName, setSelectedSchoolName] = useState('')
  const [showProfileStep, setShowProfileStep] = useState(true)
  const [activeIntakeStepIndex, setActiveIntakeStepIndex] = useState<number | null>(null)
  const [activeTaskIndex, setActiveTaskIndex] = useState(0)
  const [showCompleteStage, setShowCompleteStage] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [profile, setProfile] = useState<ContractProfile>({
    schoolName: 'Assigned School',
    state: 'Not provided',
    services: 'SFO',
    clientType: 'Client',
    contact: 'the client',
    csOwner: 'Vertex onboarding team',
    contactRole: 'school_leader',
  })
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false)
  const [ownerEditorTaskId, setOwnerEditorTaskId] = useState<string | null>(null)
  const [dismissedAttentionKey, setDismissedAttentionKey] = useState<string | null>(null)
  const [intakeResponses, setIntakeResponses] = useState<IntakeResponses>({})
  const [completedIntakeStepIds, setCompletedIntakeStepIds] = useState<string[]>([])
  const [intakeSaving, setIntakeSaving] = useState(false)
  const [intakeStatus, setIntakeStatus] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)
  const [showWelcomeModal, setShowWelcomeModal] = useState(false)
  const [showDiscrepancyForm, setShowDiscrepancyForm] = useState(false)
  const [discrepancy, setDiscrepancy] = useState('')
  const [discrepancySending, setDiscrepancySending] = useState(false)
  const [discrepancyStatus, setDiscrepancyStatus] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)
  
  // File upload state
  const [dragActive, setDragActive] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<OnboardingOperationStatus>('idle')
  const [uploadError, setUploadError] = useState('')
  const [completionCelebration, setCompletionCelebration] = useState<{
    taskName: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingStatusTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const completionCelebrationTaskRef = useRef<string | null>(null)
  const previousCompletedCountRef = useRef<number | null>(null)
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPendingStatusTimers = () => {
    pendingStatusTimersRef.current.forEach(clearTimeout)
    pendingStatusTimersRef.current = []
  }

  const resetOperationStatus = () => {
    clearPendingStatusTimers()
    setUploadProgress('idle')
    setUploadError('')
  }

  const schedulePendingStatus = (status: OnboardingOperationStatus, delayMs: number) => {
    const timer = setTimeout(() => {
      setUploadProgress((currentStatus) => (
        ['success', 'error', 'idle', 'refreshing'].includes(currentStatus) ? currentStatus : status
      ))
    }, delayMs)

    pendingStatusTimersRef.current.push(timer)
  }

  // Chat state
  const [activeChatTab, setActiveChatTab] = useState<ChatTab>('ai')
  const [chatInput, setChatInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [teamSending, setTeamSending] = useState(false)
  const [chatError, setChatError] = useState('')
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const chatReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getModelBadge = (msg: ConversationMessage) => {
    if (msg.aiModel === '@cf/google/gemma-4-26b-a4b-it') {
      return {
        label: 'VertexAI',
        className: 'bg-green-100 text-green-700',
      }
    }

    if (msg.aiModel === 'gemma-error' || msg.aiModel === 'vertexai-error') {
      return {
        label: 'VertexAI',
        className: 'bg-red-100 text-red-700',
      }
    }

    return null
  }

  const { data: schoolProfiles = [], isLoading: schoolProfilesLoading } = useQuery({
    queryKey: ['current-user-school-profiles'],
    queryFn: () => listCurrentUserSchoolProfiles(),
    enabled: Boolean(session?.user),
  })

  const selectedProfile = schoolProfiles.find((school) => school.schoolName === selectedSchoolName) ?? schoolProfiles[0] ?? null
  const clientName = selectedProfile?.schoolName || profile.schoolName

  const { data: aiConversation, isLoading: aiConversationLoading } = useQuery({
    queryKey: ['school-conversation', selectedSchoolName, 'ai'],
    queryFn: () => fetchConversation(selectedSchoolName, 'ai'),
    enabled: Boolean(session?.user && selectedSchoolName),
  })

  const { data: staffConversation, isLoading: staffConversationLoading } = useQuery({
    queryKey: ['school-conversation', selectedSchoolName, 'staff'],
    queryFn: () => fetchConversation(selectedSchoolName, 'staff'),
    enabled: Boolean(session?.user && selectedSchoolName),
  })

  const activeConversation = activeChatTab === 'ai' ? aiConversation : staffConversation
  const activeChatMessages = activeConversation?.messages ?? []
  const activeChatLoading = activeChatTab === 'ai' ? aiConversationLoading : staffConversationLoading
  const staffUnreadCount = staffConversation?.unreadCount ?? 0
  const aiUnreadCount = aiConversation?.unreadCount ?? 0
  const hasUnreadTeamMessages = staffUnreadCount > 0

  // Query tasks using TanStack Query
  const { data: tasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['onboarding-tasks', clientName],
    queryFn: () => getOnboardingTasks({ data: clientName }),
    enabled: Boolean(session?.user && selectedProfile),
  })

  const { data: schoolContacts = [] } = useQuery({
    queryKey: ['school-contacts', selectedSchoolName],
    queryFn: () => listSchoolContacts({ data: selectedSchoolName }),
    enabled: Boolean(session?.user && selectedSchoolName),
  })

  const { data: taskAssignments = [] } = useQuery({
    queryKey: ['school-task-assignments', selectedSchoolName],
    queryFn: () => listTaskAssignments({ data: selectedSchoolName }),
    enabled: Boolean(session?.user && selectedSchoolName),
  })

  const { data: savedIntakeState = getEmptyIntakeState(), isLoading: intakeLoading } = useQuery({
    queryKey: ['school-intake-responses', selectedSchoolName],
    queryFn: () => getSchoolIntakeResponses({ data: selectedSchoolName }),
    enabled: Boolean(session?.user && selectedSchoolName),
  })

  const assignmentsByTaskId = new Map(taskAssignments.map((assignment) => [assignment.asanaTaskId, assignment]))
  const currentUserEmail = session?.user?.email || ''
  const currentSchoolContact = schoolContacts.find((contact) => contact.email === currentUserEmail)
  const currentContactRole = selectedProfile?.contactRole || currentSchoolContact?.contactRole || 'school_staff'
  const canAssignTasks = currentContactRole === 'school_leader'

  const isTaskActionableForCurrentUser = (taskId: string) => {
    const assignment = assignmentsByTaskId.get(taskId)
    if (assignment) return assignment.assignedToEmail === currentUserEmail
    return currentContactRole === 'school_leader'
  }

  const actionableTasks = tasks.filter((task) => isTaskActionableForCurrentUser(task.id))
  const displayedTasks = showMyTasksOnly ? actionableTasks : tasks
  const incompleteActionableTasks = actionableTasks.filter((task) => !task.completed)
  const attentionTasks = incompleteActionableTasks
    .filter((task) => task.isUrgent || Boolean(task.dueFlag))
    .sort((a, b) => {
      if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1
      if (a.dueFlag && b.dueFlag && a.daysUntilDue !== b.daysUntilDue) {
        return (a.daysUntilDue ?? Number.MAX_SAFE_INTEGER) - (b.daysUntilDue ?? Number.MAX_SAFE_INTEGER)
      }
      if (a.dueFlag) return -1
      if (b.dueFlag) return 1
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return a.name.localeCompare(b.name)
    })
  const visibleAttentionTasks = attentionTasks.slice(0, 3)
  const hiddenAttentionTaskCount = Math.max(attentionTasks.length - visibleAttentionTasks.length, 0)
  const attentionNotificationKey = `${selectedSchoolName}:${attentionTasks.map((task) => task.id).join('|')}`
  const showAttentionNotification = visibleAttentionTasks.length > 0 && dismissedAttentionKey !== attentionNotificationKey

  // Scroll to bottom of chat when history updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeChatMessages.length, activeChatTab, isChatOpen])

  useEffect(() => {
    if (!isChatOpen || !selectedSchoolName) return
    void markConversationReadRequest(selectedSchoolName, activeChatTab)
      .then(() => queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchoolName, activeChatTab] }))
      .catch(() => {})
  }, [activeChatMessages.length, activeChatTab, activeConversation?.lastMessageCreatedAt, isChatOpen, selectedSchoolName])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem('vertex-bridge:staff-unread-count', String(staffUnreadCount))
    window.dispatchEvent(new CustomEvent('vertex-bridge:staff-unread-count', {
      detail: { count: staffUnreadCount },
    }))
  }, [staffUnreadCount])

  useEffect(() => {
    if (!selectedSchoolName) return

    let socket: WebSocket | null = null
    let closedByEffect = false
    let reconnectAttempt = 0

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/api/conversations/ws?schoolName=${encodeURIComponent(selectedSchoolName)}`)

      socket.onopen = () => {
        reconnectAttempt = 0
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.schoolName !== selectedSchoolName) return
          if (payload?.channel === 'ai' || payload?.channel === 'staff') {
            queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchoolName, payload.channel] })
          }
        } catch {
          // Ignore non-JSON keepalive frames.
        }
      }

      socket.onclose = () => {
        if (closedByEffect) return
        reconnectAttempt += 1
        const delayMs = Math.min(1000 * reconnectAttempt, 5000)
        chatReconnectTimerRef.current = setTimeout(connect, delayMs)
      }
    }

    connect()

    return () => {
      closedByEffect = true
      if (chatReconnectTimerRef.current) {
        clearTimeout(chatReconnectTimerRef.current)
        chatReconnectTimerRef.current = null
      }
      socket?.close()
    }
  }, [selectedSchoolName, queryClient])

  useEffect(() => {
    if (isLoading) return

    const replayRequested = window.sessionStorage.getItem(WELCOME_REPLAY_KEY) === 'true'
    if (replayRequested) {
      window.sessionStorage.removeItem(WELCOME_REPLAY_KEY)
      setShowWelcomeModal(true)
      return
    }

    const alreadySeen = window.localStorage.getItem(WELCOME_SEEN_KEY) === 'true'
    if (!alreadySeen) {
      setShowWelcomeModal(true)
    }
  }, [isLoading])

  const handleWelcomeClose = () => {
    window.localStorage.setItem(WELCOME_SEEN_KEY, 'true')
    setShowWelcomeModal(false)
  }

  useEffect(() => {
    const openStoredChat = window.sessionStorage.getItem('vertex-bridge:open-ai-chat') === 'true'
    if (openStoredChat) {
      window.sessionStorage.removeItem('vertex-bridge:open-ai-chat')
      setIsChatOpen(true)
    }

    const handleOpenChat = () => setIsChatOpen(true)
    window.addEventListener('vertex-bridge:open-ai-chat', handleOpenChat)

    return () => {
      window.removeEventListener('vertex-bridge:open-ai-chat', handleOpenChat)
    }
  }, [])

  useEffect(() => {
    if (!isChatOpen) return

    const originalBodyOverflow = document.body.style.overflow
    const originalHtmlOverflow = document.documentElement.style.overflow

    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = originalBodyOverflow
      document.documentElement.style.overflow = originalHtmlOverflow
    }
  }, [isChatOpen])

  useEffect(() => {
    if (schoolProfiles.length === 0) return

    const storedSchoolName = window.localStorage.getItem('vertex-bridge:selected-school')
    const nextSchoolName = storedSchoolName && schoolProfiles.some((school) => school.schoolName === storedSchoolName)
      ? storedSchoolName
      : schoolProfiles[0].schoolName

    setSelectedSchoolName((currentSchoolName) => (
      currentSchoolName && schoolProfiles.some((school) => school.schoolName === currentSchoolName)
        ? currentSchoolName
        : nextSchoolName
    ))
  }, [schoolProfiles])

  useEffect(() => {
    if (!selectedProfile) return

    setProfile(selectedProfile)
    setShowMyTasksOnly(selectedProfile.contactRole === 'school_staff')
    setViewMode(selectedProfile.contactRole === 'school_staff' ? 'all' : 'journey')
  }, [selectedProfile])

  useEffect(() => {
    if (!selectedSchoolName) return

    window.localStorage.setItem('vertex-bridge:selected-school', selectedSchoolName)
    setShowProfileStep(true)
    setActiveIntakeStepIndex(null)
    setActiveTaskIndex(0)
    setShowCompleteStage(false)
    setViewMode(selectedProfile?.contactRole === 'school_staff' ? 'all' : 'journey')
    resetOperationStatus()
    setDiscrepancy('')
    setDiscrepancyStatus(null)
    setIntakeStatus(null)
    setIntakeResponses({})
    setCompletedIntakeStepIds([])
    setShowMyTasksOnly(selectedProfile?.contactRole === 'school_staff')
    setOwnerEditorTaskId(null)
    setCompletionCelebration(null)
    completionCelebrationTaskRef.current = null
    previousCompletedCountRef.current = null
  }, [selectedSchoolName, selectedProfile?.contactRole])

  useEffect(() => {
    if (!selectedSchoolName || intakeLoading) return

    setIntakeResponses(savedIntakeState.responses || {})
    setCompletedIntakeStepIds(savedIntakeState.completedStepIds || [])
  }, [intakeLoading, savedIntakeState, selectedSchoolName])

  // Get active task
  const activeTask = tasks[activeTaskIndex] || null
  const activeTaskAssignment = activeTask ? assignmentsByTaskId.get(activeTask.id) : null
  const activeTaskActionable = activeTask ? isTaskActionableForCurrentUser(activeTask.id) : false
  const taskDescriptionUrls = activeTask ? extractUrls(activeTask.notes) : []
  const instructionText = activeTask?.notes
    ? taskDescriptionUrls.length > 0
      ? removeUrls(activeTask.notes)
      : activeTask.notes
    : 'No instructions provided.'
  const displayedInstructionText = instructionText || 'Use the button below to continue this onboarding step.'
  const intakeSteps = useMemo(() => getIntakeSteps(), [])
  const activeIntakeStep = activeIntakeStepIndex === null ? null : intakeSteps[activeIntakeStepIndex] || null
  const asanaStepOffset = profileStepCount + intakeSteps.length
  const completedIntakeCount = intakeSteps.filter((step) => (
    completedIntakeStepIds.includes(step.id) && isIntakeStepComplete(step, intakeResponses)
  )).length
  const currentIncompleteIntakeStepIndex = intakeSteps.findIndex((step) => (
    !completedIntakeStepIds.includes(step.id) || !isIntakeStepComplete(step, intakeResponses)
  ))
  const currentIncompleteIntakeStep = currentIncompleteIntakeStepIndex >= 0
    ? intakeSteps[currentIncompleteIntakeStepIndex]
    : null
  const currentIncompleteIntakeStepNumber = currentIncompleteIntakeStepIndex >= 0
    ? currentIncompleteIntakeStepIndex + profileStepCount + 1
    : null

  const completedCount = profileStepCount + completedIntakeCount + tasks.filter(t => t.completed).length
  const totalCount = profileStepCount + intakeSteps.length + tasks.length
  const journeyStepCount = totalCount
  const currentCompletedStageStorageKey = selectedSchoolName
    ? `${completedStageStorageKey}:${selectedSchoolName}`
    : completedStageStorageKey
  const currentResumeStepStorageKey = selectedSchoolName
    ? `${resumeStepStorageKey}:${selectedSchoolName}`
    : resumeStepStorageKey
  const progressPercent = isLoading || intakeLoading || totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  const allStepsComplete = !isLoading && !intakeLoading && tasks.length > 0 && completedCount === totalCount
  const currentStepNumber = showProfileStep
    ? 1
    : activeIntakeStepIndex !== null && activeIntakeStep
      ? activeIntakeStepIndex + profileStepCount + 1
      : activeTask
        ? activeTaskIndex + asanaStepOffset + 1
        : null
  const isOperationPending = !['idle', 'success', 'error'].includes(uploadProgress)
  const pendingStatus = {
    'preparing-upload': {
      title: 'Preparing upload',
      message: 'Checking the selected file and preparing the secure upload.',
    },
    'storing-file': {
      title: 'Storing file',
      message: 'Uploading your document to Vertex Bridge storage. Keep this page open.',
    },
    'syncing-asana': {
      title: 'Updating Asana',
      message: 'Waiting for Asana to confirm the matching onboarding task update.',
    },
    'saving-task': {
      title: 'Saving completion',
      message: 'Marking this onboarding step complete in Asana.',
    },
    refreshing: {
      title: 'Refreshing progress',
      message: 'Asana is updated. Refreshing your onboarding checklist now.',
    },
  }[uploadProgress as Exclude<OnboardingOperationStatus, 'idle' | 'success' | 'error'>]

  useEffect(() => {
    if (isLoading || intakeLoading || totalCount === 0) return

    const previousCompletedCount = previousCompletedCountRef.current
    previousCompletedCountRef.current = completedCount

    if (previousCompletedCount === null || completedCount <= previousCompletedCount) return

    const completedTaskName = completionCelebrationTaskRef.current
    completionCelebrationTaskRef.current = null

    if (!completedTaskName) return

    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current)
    }

    setCompletionCelebration({
      taskName: completedTaskName,
    })

    celebrationTimeoutRef.current = setTimeout(() => {
      setCompletionCelebration(null)
      celebrationTimeoutRef.current = null
    }, 2800)
  }, [completedCount, intakeLoading, isLoading, totalCount])

  useEffect(() => () => {
    if (celebrationTimeoutRef.current) {
      clearTimeout(celebrationTimeoutRef.current)
    }
  }, [])

  const saveResumeStep = (step: StoredResumeStep) => {
    if (!selectedSchoolName) return
    window.localStorage.setItem(currentResumeStepStorageKey, JSON.stringify(step))
  }

  const scopedTaskEntries = tasks
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => isTaskActionableForCurrentUser(task.id))
  const currentIncompleteTaskEntry = scopedTaskEntries.find(({ task }) => !task.completed)
  const currentIncompleteTaskIndex = currentIncompleteTaskEntry?.index ?? -1
  const currentIncompleteTask = currentIncompleteTaskEntry?.task ?? null
  const currentIncompleteStepNumber = currentIncompleteTaskIndex >= 0
    ? currentIncompleteTaskIndex + asanaStepOffset + 1
    : null
  const nextIncompleteTaskEntry = currentIncompleteTaskIndex >= 0
    ? scopedTaskEntries.find(({ task, index }) => index > currentIncompleteTaskIndex && !task.completed)
    : null
  const canJumpToCurrentIncompleteStep = !isLoading && (
    currentIncompleteIntakeStep
      ? showProfileStep || showCompleteStage || viewMode !== 'journey' || activeIntakeStepIndex !== currentIncompleteIntakeStepIndex
      : Boolean(currentIncompleteTask)
        && currentIncompleteTaskIndex >= 0
        && (showProfileStep || showCompleteStage || viewMode !== 'journey' || activeIntakeStepIndex !== null || activeTaskIndex !== currentIncompleteTaskIndex)
  )

  const goToCurrentIncompleteStep = () => {
    if (currentIncompleteIntakeStep && currentIncompleteIntakeStepIndex >= 0) {
      setActiveIntakeStepIndex(currentIncompleteIntakeStepIndex)
      setShowProfileStep(false)
      setShowCompleteStage(false)
      setViewMode('journey')
      saveResumeStep({ type: 'intake', intakeStepId: currentIncompleteIntakeStep.id })
      resetOperationStatus()
      return
    }

    if (!currentIncompleteTask || currentIncompleteTaskIndex < 0) return

    setActiveTaskIndex(currentIncompleteTaskIndex)
    setActiveIntakeStepIndex(null)
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    saveResumeStep({ type: 'task', taskId: currentIncompleteTask.id })
    resetOperationStatus()
  }

  const goToTask = (taskId: string) => {
    const taskIndex = tasks.findIndex((task) => task.id === taskId)
    if (taskIndex < 0) return

    setActiveTaskIndex(taskIndex)
    setActiveIntakeStepIndex(null)
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    saveResumeStep({ type: 'task', taskId })
    resetOperationStatus()
  }

  const currentJourneyStep = (() => {
    if (isLoading) {
      return {
        label: 'Current step',
        title: 'Loading onboarding steps...',
        meta: 'Syncing your journey',
      }
    }

    if (showCompleteStage && allStepsComplete) {
      return {
        label: 'Current step',
        title: 'Onboarding complete',
        meta: `${totalCount} of ${totalCount} steps`,
      }
    }

    if (currentIncompleteIntakeStep && currentIncompleteIntakeStepNumber) {
      return {
        label: 'Current step',
        title: currentIncompleteIntakeStep.title,
        meta: `Step ${currentIncompleteIntakeStepNumber} of ${totalCount}`,
      }
    }

    if (currentIncompleteTask && currentIncompleteStepNumber) {
      return {
        label: 'Current step',
        title: currentIncompleteTask.name,
        meta: `Step ${currentIncompleteStepNumber} of ${totalCount}`,
      }
    }

    if (!allStepsComplete && tasks.length > 0) {
      return {
        label: 'Current step',
        title: 'Your assigned steps are complete',
        meta: 'Waiting on remaining school tasks',
      }
    }

    return {
      label: 'Current step',
      title: 'No active step',
      meta: 'Your journey is not available yet',
    }
  })()

  const nextJourneyStep = (() => {
    if (isLoading) {
      return {
        label: 'Next step',
        title: 'Preparing next step',
        meta: 'Available after sync',
      }
    }

    if (showCompleteStage && allStepsComplete) {
      return {
        label: 'Next step',
        title: 'Vertex review',
        meta: 'Your submissions are ready',
      }
    }

    if (currentIncompleteIntakeStep) {
      const nextIntakeStep = intakeSteps.find((step, index) => (
        index > currentIncompleteIntakeStepIndex
          && (!completedIntakeStepIds.includes(step.id) || !isIntakeStepComplete(step, intakeResponses))
      ))
      return {
        label: 'Next step',
        title: nextIntakeStep?.title || currentIncompleteTask?.name || 'Asana onboarding tasks',
        meta: nextIntakeStep
          ? `Step ${intakeSteps.findIndex((step) => step.id === nextIntakeStep.id) + profileStepCount + 1} of ${totalCount}`
          : currentIncompleteStepNumber
            ? `Step ${currentIncompleteStepNumber} of ${totalCount}`
            : 'After readiness questions',
      }
    }

    if (currentIncompleteTask) {
      const nextTask = nextIncompleteTaskEntry?.task
      return {
        label: 'Next step',
        title: nextTask?.name || 'Complete assigned work',
        meta: nextIncompleteTaskEntry
          ? `Step ${nextIncompleteTaskEntry.index + asanaStepOffset + 1} of ${totalCount}`
          : 'After the current assigned step',
      }
    }

    if (!allStepsComplete && tasks.length > 0) {
      return {
        label: 'Next step',
        title: 'No assigned next step',
        meta: 'Use Full view to review school-wide tasks',
      }
    }

    return {
      label: 'Next step',
      title: allStepsComplete ? 'Complete' : 'Finish remaining assigned work',
      meta: allStepsComplete ? 'Ready for Vertex review' : 'Review the checklist',
    }
  })()

  const getPageContext = () => {
    const isCompleteStageVisible = showCompleteStage && allStepsComplete

    if (isLoading) {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode: 'journey' as const,
        stage: 'loading' as const,
        stageLabel: 'Loading onboarding tasks',
        currentStepNumber,
        totalSteps: journeyStepCount,
        completedSteps: completedCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    if (isError) {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode: 'journey' as const,
        stage: 'error' as const,
        stageLabel: 'Asana sync unavailable',
        currentStepNumber,
        totalSteps: journeyStepCount,
        completedSteps: completedCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    if (isCompleteStageVisible) {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode: 'complete' as const,
        stage: 'complete' as const,
        stageLabel: 'Complete',
        currentStepNumber: totalCount,
        totalSteps: journeyStepCount,
        completedSteps: journeyStepCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    if (viewMode === 'all') {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode,
        stage: 'all-steps' as const,
        stageLabel: 'All Steps checklist',
        currentStepNumber,
        totalSteps: journeyStepCount,
        completedSteps: completedCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    if (showProfileStep) {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode,
        stage: 'profile-confirmation' as const,
        stageLabel: 'Verify school profile',
        currentStepNumber: 1,
        totalSteps: journeyStepCount,
        completedSteps: completedCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    if (activeIntakeStep) {
      return {
        pageName: 'School Onboarding',
        path: window.location.pathname,
        viewMode,
        stage: 'intake-question' as const,
        stageLabel: activeIntakeStep.title,
        currentStepNumber,
        totalSteps: journeyStepCount,
        completedSteps: completedCount,
        progressPercent,
        allStepsComplete,
        isCompleteStageVisible,
      }
    }

    return {
      pageName: 'School Onboarding',
      path: window.location.pathname,
      viewMode,
      stage: activeTask?.completed ? 'task-completed' as const : 'task-active' as const,
      stageLabel: activeTask?.completed ? 'Active onboarding step completed' : 'Active onboarding step',
      currentStepNumber,
      totalSteps: journeyStepCount,
      completedSteps: completedCount,
      progressPercent,
      allStepsComplete,
      isCompleteStageVisible,
    }
  }

  useEffect(() => {
    if (window.localStorage.getItem(currentCompletedStageStorageKey) === 'true') {
      setShowCompleteStage(true)
    }
  }, [currentCompletedStageStorageKey])

  useEffect(() => {
    if (isLoading || !selectedSchoolName || currentContactRole !== 'school_leader') return

    const storedStep = window.localStorage.getItem(currentResumeStepStorageKey)
    if (!storedStep) return

    let parsedStep: StoredResumeStep | null = null
    try {
      parsedStep = JSON.parse(storedStep) as StoredResumeStep
    } catch {
      window.localStorage.removeItem(currentResumeStepStorageKey)
      return
    }

    if (parsedStep?.type === 'profile') {
      setShowProfileStep(true)
      setActiveIntakeStepIndex(null)
      setActiveTaskIndex(0)
      setShowCompleteStage(false)
      setViewMode('journey')
      resetOperationStatus()
      return
    }

    if (parsedStep?.type === 'intake' && parsedStep.intakeStepId) {
      const savedIntakeIndex = intakeSteps.findIndex((step) => step.id === parsedStep.intakeStepId)
      const nextIntakeIndex = savedIntakeIndex >= 0
        && (!completedIntakeStepIds.includes(intakeSteps[savedIntakeIndex].id) || !isIntakeStepComplete(intakeSteps[savedIntakeIndex], intakeResponses))
        ? savedIntakeIndex
        : intakeSteps.findIndex((step, index) => (
          index > savedIntakeIndex
            && (!completedIntakeStepIds.includes(step.id) || !isIntakeStepComplete(step, intakeResponses))
        ))
      const fallbackIntakeIndex = nextIntakeIndex >= 0
        ? nextIntakeIndex
        : intakeSteps.findIndex((step) => !completedIntakeStepIds.includes(step.id) || !isIntakeStepComplete(step, intakeResponses))

      if (fallbackIntakeIndex >= 0) {
        setActiveIntakeStepIndex(fallbackIntakeIndex)
        setShowProfileStep(false)
        setShowCompleteStage(false)
        setViewMode('journey')
        resetOperationStatus()
        saveResumeStep({ type: 'intake', intakeStepId: intakeSteps[fallbackIntakeIndex].id })
        return
      }
    }

    if (currentIncompleteIntakeStep && currentIncompleteIntakeStepIndex >= 0) {
      setActiveIntakeStepIndex(currentIncompleteIntakeStepIndex)
      setShowProfileStep(false)
      setShowCompleteStage(false)
      setViewMode('journey')
      resetOperationStatus()
      saveResumeStep({ type: 'intake', intakeStepId: currentIncompleteIntakeStep.id })
      return
    }

    if (parsedStep?.type !== 'task' || !parsedStep.taskId) return

    const savedTaskIndex = tasks.findIndex((task) => task.id === parsedStep.taskId)
    const savedTaskIsActionable = savedTaskIndex >= 0 && isTaskActionableForCurrentUser(tasks[savedTaskIndex].id)
    const nextTaskIndex = savedTaskIsActionable && !tasks[savedTaskIndex].completed
      ? savedTaskIndex
      : tasks.findIndex((task, index) => index > savedTaskIndex && !task.completed && isTaskActionableForCurrentUser(task.id))
    const fallbackTaskIndex = nextTaskIndex >= 0
      ? nextTaskIndex
      : tasks.findIndex((task) => !task.completed && isTaskActionableForCurrentUser(task.id))

    if (fallbackTaskIndex < 0) return

    setActiveTaskIndex(fallbackTaskIndex)
    setActiveIntakeStepIndex(null)
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    resetOperationStatus()
    saveResumeStep({ type: 'task', taskId: tasks[fallbackTaskIndex].id })
  }, [completedIntakeStepIds, currentContactRole, currentIncompleteIntakeStep, currentIncompleteIntakeStepIndex, currentResumeStepStorageKey, intakeResponses, intakeSteps, isLoading, selectedSchoolName, tasks])

  useEffect(() => {
    if (isLoading) return
    if (!allStepsComplete) {
      setShowCompleteStage(false)
      window.localStorage.removeItem(currentCompletedStageStorageKey)
      return
    }
    setShowCompleteStage(true)
    window.localStorage.setItem(currentCompletedStageStorageKey, 'true')
  }, [allStepsComplete, currentCompletedStageStorageKey, isLoading])

  useEffect(() => () => {
    clearPendingStatusTimers()
  }, [])

  // File drag & drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isOperationPending) {
      setDragActive(false)
      return
    }
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (isOperationPending) return
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isOperationPending) return
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0])
      e.currentTarget.value = ''
    }
  }

  const uploadFile = async (file: File) => {
    if (!activeTask || isOperationPending) return
    if (!activeTaskActionable) {
      setUploadProgress('error')
      setUploadError('This step is assigned to another school contact. You can review it, but you cannot complete it from your account.')
      return
    }
    if (!activeTask.requiresFileUpload) {
      setUploadProgress('error')
      setUploadError('This onboarding step does not require a file upload. Use the complete button instead.')
      return
    }
    clearPendingStatusTimers()
    setUploadProgress('preparing-upload')
    setUploadError('')
    schedulePendingStatus('storing-file', 350)
    schedulePendingStatus('syncing-asana', 1600)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('asanaTaskId', activeTask.id)
    formData.append('asanaTaskName', activeTask.name)
    formData.append('schoolName', clientName)

    try {
      const result = await uploadOnboardingFile({ data: formData })
      if (result.success && result.asanaUpdated !== false) {
        clearPendingStatusTimers()
        setUploadProgress('refreshing')
        completionCelebrationTaskRef.current = activeTask.name
        // Invalidate tasks query to trigger dynamic update
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        setUploadProgress('success')
      } else {
        clearPendingStatusTimers()
        setUploadProgress('error')
        setUploadError(result.asanaError || 'Your file was stored, but Asana did not confirm the task update.')
      }
    } catch (err: any) {
      clearPendingStatusTimers()
      setUploadProgress('error')
      setUploadError(err.message || 'File upload failed.')
    }
  }

  const completeManualTask = async () => {
    if (!activeTask || isOperationPending) return
    if (!activeTaskActionable) {
      setUploadProgress('error')
      setUploadError('This step is assigned to another school contact. You can review it, but you cannot complete it from your account.')
      return
    }
    clearPendingStatusTimers()
    setUploadProgress('saving-task')
    setUploadError('')
    schedulePendingStatus('syncing-asana', 900)

    try {
      const result = await completeOnboardingTaskManually({
        data: {
          taskId: activeTask.id,
          taskName: activeTask.name,
          schoolName: clientName,
        },
      })

      if (result.success) {
        clearPendingStatusTimers()
        setUploadProgress('refreshing')
        completionCelebrationTaskRef.current = activeTask.name
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        setUploadProgress('success')
      } else {
        clearPendingStatusTimers()
        setUploadProgress('error')
        setUploadError(result.asanaError || 'Could not complete this onboarding step.')
      }
    } catch (err: any) {
      clearPendingStatusTimers()
      setUploadProgress('error')
      setUploadError(err.message || 'Could not complete this onboarding step.')
    }
  }

  const handleProfileConfirm = () => {
    setShowProfileStep(false)
    if (intakeSteps[0]) {
      setActiveIntakeStepIndex(0)
      saveResumeStep({ type: 'intake', intakeStepId: intakeSteps[0].id })
    } else {
      setActiveIntakeStepIndex(null)
      if (tasks[0]) {
        saveResumeStep({ type: 'task', taskId: tasks[0].id })
      }
    }
    setActiveTaskIndex(0)
    setViewMode('journey')
    resetOperationStatus()
  }

  const updateIntakeRating = (stepId: string, questionId: string, value: number) => {
    setIntakeResponses((currentResponses) => {
      const currentStepResponse = currentResponses[stepId]
      const ratingResponse = typeof currentStepResponse === 'object' && currentStepResponse !== null && !Array.isArray(currentStepResponse)
        ? currentStepResponse
        : {}

      return {
        ...currentResponses,
        [stepId]: {
          ...ratingResponse,
          [questionId]: value,
        },
      }
    })
    setIntakeStatus(null)
  }

  const updateIntakeText = (stepId: string, value: string) => {
    setIntakeResponses((currentResponses) => ({
      ...currentResponses,
      [stepId]: value,
    }))
    setIntakeStatus(null)
  }

  const goToIntakeStep = (stepIndex: number) => {
    const step = intakeSteps[stepIndex]
    if (!step) return

    setActiveIntakeStepIndex(stepIndex)
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    saveResumeStep({ type: 'intake', intakeStepId: step.id })
    resetOperationStatus()
  }

  const saveActiveIntakeStep = async () => {
    if (!activeIntakeStep || activeIntakeStepIndex === null || intakeSaving) return

    if (!isIntakeStepComplete(activeIntakeStep, intakeResponses)) {
      setIntakeStatus({
        type: 'error',
        title: 'Answer required',
        message: activeIntakeStep.kind === 'rating'
          ? 'Rate every statement before continuing.'
          : 'Add a short response before continuing.',
      })
      return
    }

    const nextCompletedStepIds = Array.from(new Set([...completedIntakeStepIds, activeIntakeStep.id]))
    setIntakeSaving(true)
    setIntakeStatus(null)

    try {
      await saveSchoolIntakeResponses({
        data: {
          schoolName: clientName,
          responses: intakeResponses,
          completedStepIds: nextCompletedStepIds,
        },
      })
      setCompletedIntakeStepIds(nextCompletedStepIds)
      await queryClient.invalidateQueries({ queryKey: ['school-intake-responses', selectedSchoolName] })

      const nextIntakeStepIndex = activeIntakeStepIndex + 1
      if (intakeSteps[nextIntakeStepIndex]) {
        goToIntakeStep(nextIntakeStepIndex)
      } else {
        setActiveIntakeStepIndex(null)
        setActiveTaskIndex(0)
        setShowProfileStep(false)
        setShowCompleteStage(false)
        setViewMode('journey')
        if (tasks[0]) {
          saveResumeStep({ type: 'task', taskId: tasks[0].id })
        }
        resetOperationStatus()
      }
    } catch (err: any) {
      setIntakeStatus({
        type: 'error',
        title: 'Answers not saved',
        message: err.message || 'Please try again before continuing.',
      })
    } finally {
      setIntakeSaving(false)
    }
  }

  const handleDiscrepancy = () => {
    setShowDiscrepancyForm(true)
    setDiscrepancyStatus(null)
  }

  const handleAssignTask = async (taskId: string, assignedToEmail: string) => {
    try {
      await assignOnboardingTask({
        data: {
          schoolName: clientName,
          taskId,
          assignedToEmail,
        },
      })
      await queryClient.invalidateQueries({ queryKey: ['school-task-assignments', selectedSchoolName] })
      setOwnerEditorTaskId(null)
    } catch (err: any) {
      setStaffInviteStatus({
        type: 'error',
        title: 'Assignment failed',
        message: err.message || 'Unable to assign this task.',
      })
    }
  }

  const handleDiscrepancySubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setDiscrepancyStatus(null)

    if (!discrepancy.trim()) {
      setDiscrepancyStatus({
        type: 'error',
        title: 'Add the discrepancy',
        message: 'Tell the Vertex team what needs to be corrected before sending.',
      })
      return
    }

    setDiscrepancySending(true)
    try {
      const result = await reportContractDiscrepancy({
        data: {
          discrepancy,
          profile,
        },
      })
      setDiscrepancyStatus({
        type: result.emailSent ? 'success' : 'warning',
        title: result.emailSent ? 'Discrepancy sent' : 'Discrepancy recorded',
        message: result.emailSent
          ? 'Vertex admins have been emailed. A team member will review the contract profile.'
          : `The discrepancy was recorded, but email delivery was not available: ${result.emailError}`,
      })
      if (result.emailSent) {
        setDiscrepancy('')
      }
    } catch (err: any) {
      setDiscrepancyStatus({
        type: 'error',
        title: 'Unable to send discrepancy',
        message: err.message || 'Please try again or contact Vertex directly.',
      })
    } finally {
      setDiscrepancySending(false)
    }
  }

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim() || !selectedSchoolName) return

    const userMsg = chatInput.trim()
    setChatInput('')
    setChatError('')

    if (activeChatTab === 'staff') {
      setTeamSending(true)
      try {
        const response = await fetch('/api/conversations/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            schoolName: selectedSchoolName,
            body: userMsg,
          }),
        })
        const data = await response.json() as { error?: string }
        if (!response.ok) throw new Error(data.error || 'Unable to send message.')
        await queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchoolName, 'staff'] })
      } catch (err: any) {
        setChatInput(userMsg)
        setChatError(err?.message || 'Unable to send message to the Vertex Team.')
      } finally {
        setTeamSending(false)
      }
      return
    }

    setAiLoading(true)
    try {
      const activeTaskInfo = showProfileStep
        ? {
            name: 'Verify School Profile',
            notes: `Confirm school profile for ${profile.schoolName}: ${profile.state}, ${profile.services}, ${profile.clientType}.`,
            dueDate: null,
            completed: true,
            stepNumber: 1,
            functionalArea: 'Profile',
            isUrgent: false,
          }
        : activeIntakeStep
        ? {
            name: activeIntakeStep.title,
            notes: activeIntakeStep.prompt,
            dueDate: null,
            completed: isIntakeStepComplete(activeIntakeStep, intakeResponses),
            stepNumber: currentStepNumber,
            functionalArea: 'Readiness intake',
            isUrgent: false,
          }
        : activeTask
        ? {
            name: activeTask.name,
            notes: activeTask.notes,
            dueDate: activeTask.dueDate,
            completed: activeTask.completed,
            stepNumber: currentStepNumber,
            functionalArea: activeTask.functionalArea,
            isUrgent: activeTask.isUrgent,
          }
        : {
            name: allStepsComplete ? 'Complete' : 'None',
            notes: allStepsComplete
              ? 'All onboarding steps are complete. Vertex representatives will review the submitted materials and reach out with next steps.'
              : '',
            dueDate: null,
            completed: allStepsComplete,
            stepNumber: allStepsComplete ? totalCount : null,
            functionalArea: null,
            isUrgent: false,
          }

      const response = await fetch('/api/ai-helper', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: userMsg,
          currentTask: activeTaskInfo,
          pageContext: getPageContext(),
          schoolContext: {
            schoolName: clientName,
            contactName,
            services: profile.services,
            clientType: profile.clientType,
            state: profile.state,
          },
          history: activeChatMessages
            .filter((message) => message.channel === 'ai' && (message.senderType === 'client' || message.senderType === 'ai'))
            .slice(-6)
            .map((message) => ({
              sender: message.senderType === 'client' ? 'user' : 'ai',
              text: message.body,
            })),
        }),
      })

      const aiResponse = await response.json() as VertexAIResponse

      if (!response.ok) {
        throw new Error(aiResponse.text || `VertexAI API returned HTTP ${response.status}`)
      }

      await queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchoolName, 'ai'] })
    } catch (err: any) {
      console.error('VertexAI chat request failed:', err)
      setChatInput(userMsg)
      setChatError(
        err instanceof Error && err.message
          ? err.message
          : 'VertexAI could not connect just now. If this page was open during an update, refresh once and try again.',
      )
    } finally {
      setAiLoading(false)
    }
  }

  if (authPending) {
    return (
      <main className="page-wrap page-center-state">
        <div>
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[var(--vertex-blue)] border-r-transparent align-[-0.125em]" />
          <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">Checking portal access...</p>
        </div>
      </main>
    )
  }

  if (!session?.user) {
    return (
      <main className="page-wrap page-shell">
        <div className="page-stack page-stack-standard">
          <BrandedAlert variant="warning" title="Sign in required">
            <span>
              Please <Link to="/login" className="font-bold underline text-[var(--vertex-blue)]">sign in</Link> to access your onboarding workspace.
            </span>
          </BrandedAlert>
        </div>
      </main>
    )
  }

  if (schoolProfilesLoading) {
    return (
      <main className="page-wrap page-center-state">
        <LoadingJourneyOverlay />
      </main>
    )
  }

  if (!schoolProfilesLoading && schoolProfiles.length === 0) {
    return (
      <main className="page-wrap page-shell pb-28">
        <section className="w-full space-y-6">
          <div>
            <div className="page-kicker">
              Onboarding Journey
            </div>
            <h1 className="page-title">
              School Onboarding
            </h1>
          </div>
          <BrandedAlert variant="warning" title="No school access found">
            Your account is not linked to a school onboarding workspace yet. Use your latest invite link or contact Vertex support.
          </BrandedAlert>
        </section>
      </main>
    )
  }

  return (
    <main className="page-wrap page-shell pb-28">
      {isLoading && <LoadingJourneyOverlay />}
      {showWelcomeModal && !isLoading && <WelcomeModal onClose={handleWelcomeClose} />}
      {completionCelebration && (
        <CompletionCelebration taskName={completionCelebration.taskName} />
      )}
      {/* Main Wizard / Checklist Panel (Left) */}
      <section className="w-full space-y-4">
        <div className="island-shell rounded-xl border border-[var(--line)] bg-white p-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)] xl:items-end">
            <div className="min-w-0">
              <div className="page-kicker">
                Onboarding Journey
              </div>
              <h1 className="display-title mt-1 truncate text-2xl font-bold text-[var(--vertex-blue)] sm:text-3xl">
                {clientName} Onboarding
              </h1>

              {!allStepsComplete && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="uppercase tracking-wider text-[var(--sea-ink-soft)]">View</span>
                  <button
                    type="button"
                    onClick={() => setViewMode('journey')}
                    aria-pressed={viewMode === 'journey'}
                    className={`rounded-md px-2 py-1 transition ${viewMode === 'journey' ? 'bg-[var(--foam)] text-[var(--vertex-blue)]' : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'}`}
                  >
                    Journey
                  </button>
                  <span className="text-[var(--chip-line)]">/</span>
                  <button
                    type="button"
                    onClick={() => setViewMode('all')}
                    aria-pressed={viewMode === 'all'}
                    className={`rounded-md px-2 py-1 transition ${viewMode === 'all' ? 'bg-[var(--foam)] text-[var(--vertex-blue)]' : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'}`}
                  >
                    Checklist ({journeyStepCount})
                  </button>
                </div>
              )}

            </div>

            <div className="grid w-full max-w-[32rem] justify-self-end gap-2 xl:self-end">
              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                {schoolProfiles.length > 1 ? (
                  <div className="grid min-w-0 items-center gap-2 justify-self-start sm:grid-cols-[auto_minmax(0,16rem)]">
                    <label className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]" htmlFor="school-workspace-select">
                      Choose Your School
                    </label>
                    <select
                      id="school-workspace-select"
                      value={selectedSchoolName}
                      onChange={(event) => setSelectedSchoolName(event.target.value)}
                      className="min-h-9 w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-1.5 text-sm font-bold text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                    >
                      {schoolProfiles.map((school) => (
                        <option key={school.schoolName} value={school.schoolName}>
                          {school.schoolName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid min-w-0 items-center gap-2 justify-self-start sm:grid-cols-[auto_minmax(0,16rem)]">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                      Your School:
                    </div>
                    <div className="min-h-9 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4 py-1.5 text-sm font-bold text-[var(--sea-ink)]">
                      {selectedProfile?.schoolName || 'No school assigned'}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="grid grid-cols-2 rounded-xl border border-neutral-300 bg-neutral-200/60 p-1">
                  <button
                    type="button"
                    onClick={() => setShowMyTasksOnly(true)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${showMyTasksOnly ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-neutral-600 hover:text-black'}`}
                  >
                    My Tasks ({actionableTasks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowMyTasksOnly(false)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${!showMyTasksOnly ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-neutral-600 hover:text-black'}`}
                  >
                    Full ({tasks.length})
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {!schoolProfilesLoading && schoolProfiles.length === 0 && (
          <BrandedAlert variant="warning" title="No school access found">
            Your account is not linked to a school onboarding workspace yet. Use your latest invite link or contact Vertex support.
          </BrandedAlert>
        )}

        <div className="island-shell w-full rounded-xl border border-[var(--line)] bg-white p-4">
          <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
            <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:col-span-2">
              {[currentJourneyStep, nextJourneyStep].map((step) => (
                <div key={step.label} className="min-w-0">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                    {step.label}
                  </div>
                  <div className="mt-1 truncate text-sm font-bold text-[var(--sea-ink)]">
                    {step.title}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                    {step.meta}
                  </div>
                </div>
              ))}
            </div>

            {canJumpToCurrentIncompleteStep && (
              <button
                type="button"
                onClick={goToCurrentIncompleteStep}
                disabled={isOperationPending}
                className="inline-flex min-h-9 items-center justify-center rounded-lg border border-[var(--chip-line)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Go to current step
              </button>
            )}
          </div>

          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <div className="mb-1 flex flex-col gap-1 text-xs font-bold text-[var(--sea-ink)] sm:flex-row sm:justify-between">
              <span>Overall Completion</span>
              <span>
                {isLoading || intakeLoading ? 'Loading steps...' : `${completedCount} of ${totalCount} Steps (${progressPercent}%)`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className={`h-full bg-gradient-to-r from-[var(--vertex-blue)] to-[var(--vertex-gold)] transition-all duration-500 ${completionCelebration ? 'completion-progress-pulse' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {allStepsComplete && (
              <div className="mt-2 rounded-lg border border-green-200 bg-green-100 p-2 text-center text-xs font-bold text-green-700">
                All Steps Complete
              </div>
            )}
          </div>
        </div>

        {!isLoading && showAttentionNotification && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <AlertTriangle size={14} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-amber-800">
                    Needs attention
                  </div>
                  <p className="mt-0.5 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">
                    Urgent items and tasks due within 7 days.
                  </p>
                </div>
              </div>

              <div className="flex min-w-0 flex-1 items-start gap-2 lg:justify-end">
                <div className="flex min-w-0 flex-1 flex-wrap gap-2 lg:justify-end">
                  {visibleAttentionTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => goToTask(task.id)}
                      title={task.name}
                      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-left text-xs font-bold text-[var(--sea-ink)] shadow-sm transition hover:border-amber-300 hover:bg-amber-50 sm:max-w-[18rem] lg:max-w-[22rem]"
                    >
                      {task.isUrgent ? (
                        <AlertTriangle size={13} className="shrink-0 text-red-600" aria-hidden="true" />
                      ) : (
                        <Clock3 size={13} className="shrink-0 text-amber-700" aria-hidden="true" />
                      )}
                      <span className="block min-w-0 max-w-[9rem] flex-1 truncate sm:max-w-[12rem] lg:max-w-[14rem]">
                        {task.name}
                      </span>
                      {task.dueDate && (
                        <span className="shrink-0 whitespace-nowrap text-[10px] font-extrabold text-[var(--sea-ink-soft)]">
                          Due {new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                      {task.dueFlag && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide ${getDueFlagClass(task.dueFlag)}`}>
                          {getDueFlagLabel(task.dueFlag, task.daysUntilDue)}
                        </span>
                      )}
                      {task.isUrgent && !task.dueFlag && (
                        <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-red-700">
                          Urgent
                        </span>
                      )}
                    </button>
                  ))}
                  {hiddenAttentionTaskCount > 0 && (
                    <span className="inline-flex items-center rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide text-amber-700">
                      +{hiddenAttentionTaskCount} more
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDismissedAttentionKey(attentionNotificationKey)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 transition hover:bg-amber-100"
                  aria-label="Dismiss attention notification"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}

        {showCompleteStage && allStepsComplete ? (
          <div className="completion-page island-shell overflow-hidden rounded-2xl border border-[rgba(0,56,101,0.16)] bg-white shadow-xl">
            <div className="relative min-h-[24rem] overflow-hidden bg-[var(--vertex-blue)] text-white">
              <img
                src="/brand/vertex-onboarding-ascent.webp"
                alt=""
                aria-hidden="true"
                className="absolute inset-0 h-full w-full object-cover opacity-70"
              />
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,56,101,0.96)_0%,rgba(0,56,101,0.78)_44%,rgba(0,56,101,0.22)_100%)]" />
              <div className="relative grid min-h-[24rem] content-end gap-5 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_24rem] lg:items-end lg:content-center">
                <div className="max-w-3xl">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                    Onboarding Complete
                  </div>
                  <h2 className="display-title mt-3 text-3xl font-bold leading-tight sm:text-5xl">
                    You completed your onboarding journey.
                  </h2>
                  <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-white/90">
                    Congratulations, {contactName}. {clientName} has completed every required onboarding step, and your submissions are ready for Vertex review.
                  </p>
                </div>

                <div className="completion-summary-panel rounded-xl border border-white/20 bg-white/95 p-4 text-[var(--sea-ink)] shadow-2xl backdrop-blur">
                  <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                    Completion Summary
                  </div>
                  <div className="mt-4 text-5xl font-extrabold leading-none text-[var(--vertex-blue)]">
                    100%
                  </div>
                  <div className="mt-1 text-sm font-bold text-green-700">
                    {completedCount} of {totalCount} steps complete
                  </div>
                  <div className="mt-5 space-y-3 border-t border-[var(--line)] pt-4">
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-semibold text-[var(--sea-ink-soft)]">School</span>
                      <span className="text-right text-xs font-bold text-[var(--sea-ink)]">{clientName}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-xs font-semibold text-[var(--sea-ink-soft)]">Journey status</span>
                      <span className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                        Complete
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-5 p-5 md:grid-cols-[1.15fr_0.85fr] sm:p-6">
              <div className="rounded-xl border border-green-200 bg-green-50 p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-green-700">
                  Your client journey is complete
                </div>
                <p className="mt-2 text-sm font-semibold leading-6 text-[var(--sea-ink)]">
                  Your Vertex client representatives will review the completed materials and reach out with next steps. You can return here any time to view your completed checklist and submitted progress.
                </p>
              </div>

              <div className="rounded-xl border border-[var(--line)] bg-white p-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                  What happens next
                </h3>
                <div className="mt-4 space-y-3">
                  {[
                    'Vertex reviews the submitted onboarding documents.',
                    'Your client representatives coordinate any follow-up items.',
                    'They reach out with next steps for the next phase of your journey.',
                  ].map((item, index) => (
                    <div key={item} className="flex gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--vertex-blue)] text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                      <p className="pt-1 text-sm font-medium leading-5 text-[var(--sea-ink)]">
                        {item}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : isLoading ? (
          <OnboardingTaskSkeleton />
        ) : isError ? (
          <div className="island-shell p-8 text-center rounded-2xl">
            <BrandedAlert variant="error" title="Asana sync unavailable" className="mb-4 text-left">
              We were unable to connect to Asana to fetch your onboarding tasks. Using cached/local task list.
            </BrandedAlert>
            <button onClick={() => refetch()} className="px-4 py-2 bg-[var(--vertex-blue)] text-white text-xs font-semibold rounded-lg cursor-pointer">
              Retry Sync
            </button>
          </div>
        ) : viewMode === 'journey' && showProfileStep ? (
          <div className="space-y-5">
            <div className="island-shell relative overflow-hidden rounded-2xl border border-[var(--line)] p-5 shadow-lg sm:p-8">
              <div className="absolute right-0 top-0 h-24 w-24 translate-x-8 -translate-y-8 rounded-full bg-[var(--hero-b)]" />

              <div className="relative">
                <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                  Step 1
                </div>
                <h2 className="display-title mb-2 text-2xl font-bold text-[var(--vertex-blue)]">
                  Verify School Profile
                </h2>
                <p className="mb-6 max-w-2xl text-sm text-[var(--sea-ink-soft)]">
                  We have your contract details ready to configure your onboarding portal. Please confirm the details below.
                </p>

                <h3 className="mb-6 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                  School Profile Card
                </h3>

                <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 md:gap-y-6">
                  <div className="border-b border-[var(--line)] pb-3 md:border-b-0 md:pb-0">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                      School Name
                    </span>
                    <span className="text-base font-bold text-[var(--sea-ink)]">
                      {profile.schoolName}
                    </span>
                  </div>

                  <div className="border-b border-[var(--line)] pb-3 md:border-b-0 md:pb-0">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                      State Jurisdiction
                    </span>
                    <span className="text-base font-bold text-[var(--sea-ink)]">
                      {profile.state}
                    </span>
                  </div>

                  <div className="border-b border-[var(--line)] pb-3 md:border-b-0 md:pb-0">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                      Contracted Services
                    </span>
                    <span className="text-base font-bold text-[var(--sea-ink)]">
                      {profile.services}
                    </span>
                  </div>

                  <div className="border-b border-[var(--line)] pb-3 md:border-b-0 md:pb-0">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                      Client Status
                    </span>
                    <span className="text-base font-bold text-[var(--sea-ink)]">
                      {profile.clientType}
                    </span>
                  </div>

                  <div className="border-t border-[var(--line)] pt-5 md:col-span-2 md:mt-2">
                    <div className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-4 md:flex-row md:items-center">
                      <div>
                        <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-[var(--vertex-gray)]">
                          Assigned Onboarding Coordinator
                        </span>
                        <span className="text-sm font-semibold text-[var(--vertex-blue)]">
                          {profile.csOwner}
                        </span>
                      </div>
                      <div className="max-w-xs text-xs leading-relaxed text-[var(--sea-ink-soft)]">
                        Eugene and the SFO payroll/accounting team will review your files once they are uploaded.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse items-stretch justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button
                onClick={handleDiscrepancy}
                className="w-full cursor-pointer rounded-xl border border-[var(--vertex-gold)] px-6 py-3 font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--hero-b)] sm:w-auto"
              >
                Something is Incorrect
              </button>

              <button
                onClick={handleProfileConfirm}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[var(--vertex-blue)] px-8 py-3 font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)] sm:w-auto"
              >
                Confirm & Continue to Step 2
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                  <path d="M6 13a1 1 0 0 1-.707-1.707L8.586 8 5.293 4.707a1 1 0 0 1 1.414-1.414l4 4a1 1 0 0 1 0 1.414l-4 4A1 1 0 0 1 6 13z" />
                </svg>
              </button>
            </div>

            {showDiscrepancyForm && (
              <form onSubmit={handleDiscrepancySubmit} className="island-shell rounded-2xl p-5">
                <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                  What needs to be corrected?
                </label>
                <textarea
                  value={discrepancy}
                  onChange={(event) => setDiscrepancy(event.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                  placeholder="Example: Our contracted services should include Payroll, but Grants should not be listed."
                />
                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="m-0 text-xs font-semibold text-[var(--sea-ink-soft)]">
                    This sends the displayed profile and your note to Vertex admins.
                  </p>
                  <button
                    type="submit"
                    disabled={discrepancySending}
                    className="w-full rounded-xl bg-[var(--vertex-blue)] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:bg-[var(--lagoon-deep)] disabled:opacity-50 sm:w-auto"
                  >
                    {discrepancySending ? 'Sending...' : 'Send to Vertex Admin'}
                  </button>
                </div>
              </form>
            )}

            {discrepancyStatus && (
              <BrandedAlert
                variant={discrepancyStatus.type}
                title={discrepancyStatus.title}
              >
                {discrepancyStatus.message}
              </BrandedAlert>
            )}
          </div>
        ) : viewMode === 'journey' && activeIntakeStep ? (
          <div className="island-shell overflow-hidden rounded-2xl shadow-md">
            <div className="space-y-6 p-5 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                    Step {currentStepNumber}
                  </div>
                  <h2 className="display-title text-2xl font-bold text-[var(--vertex-blue)]">
                    {activeIntakeStep.title}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--sea-ink-soft)]">
                    {activeIntakeStep.prompt}
                  </p>
                </div>
                {activeIntakeStep.helperText && (
                  <div className="rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4 py-3 text-xs font-bold text-[var(--vertex-blue)] sm:max-w-56">
                    {activeIntakeStep.helperText}
                  </div>
                )}
              </div>

              {activeIntakeStep.kind === 'rating' && activeIntakeStep.questions ? (
                <div className="space-y-3">
                  <div className="hidden grid-cols-[minmax(0,1fr)_repeat(5,3rem)] gap-2 px-3 text-center text-[10px] font-extrabold uppercase tracking-wide text-[var(--sea-ink-soft)] md:grid">
                    <span className="text-left">Statement</span>
                    {[1, 2, 3, 4, 5].map((rating) => (
                      <span key={rating}>{rating}</span>
                    ))}
                  </div>

                  {activeIntakeStep.questions.map((question) => {
                    const stepResponse = intakeResponses[activeIntakeStep.id]
                    const ratingResponse = typeof stepResponse === 'object' && stepResponse !== null && !Array.isArray(stepResponse)
                      ? stepResponse
                      : {}
                    const selectedRating = ratingResponse[question.id]

                    return (
                      <fieldset
                        key={question.id}
                        className="rounded-xl border border-[var(--line)] bg-white p-3"
                      >
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                          <legend className="text-sm font-bold leading-5 text-[var(--sea-ink)]">
                            {question.label}
                          </legend>
                          <div className="grid grid-cols-5 gap-2 md:w-[15rem]">
                            {[1, 2, 3, 4, 5].map((rating) => (
                              <label
                                key={rating}
                                className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border text-sm font-extrabold transition ${selectedRating === rating ? 'border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white shadow-sm' : 'border-[var(--chip-line)] bg-[var(--foam)] text-[var(--sea-ink)] hover:border-[var(--vertex-blue)]'}`}
                                title={`${rating}`}
                              >
                                <input
                                  type="radio"
                                  name={`${activeIntakeStep.id}:${question.id}`}
                                  value={rating}
                                  checked={selectedRating === rating}
                                  onChange={() => updateIntakeRating(activeIntakeStep.id, question.id, rating)}
                                  className="sr-only"
                                />
                                {rating}
                              </label>
                            ))}
                          </div>
                        </div>
                      </fieldset>
                    )
                  })}
                </div>
              ) : (
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]" htmlFor={`intake-${activeIntakeStep.id}`}>
                    Your response
                  </label>
                  <textarea
                    id={`intake-${activeIntakeStep.id}`}
                    value={typeof intakeResponses[activeIntakeStep.id] === 'string' ? (intakeResponses[activeIntakeStep.id] as string) : ''}
                    onChange={(event) => updateIntakeText(activeIntakeStep.id, event.target.value)}
                    rows={5}
                    className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm leading-6 text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                    placeholder={activeIntakeStep.placeholder || ''}
                  />
                </div>
              )}

              {intakeStatus && (
                <BrandedAlert variant={intakeStatus.type} title={intakeStatus.title}>
                  {intakeStatus.message}
                </BrandedAlert>
              )}

              <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4">
                <button
                  type="button"
                  onClick={() => {
                    if (activeIntakeStepIndex === 0) {
                      setShowProfileStep(true)
                      setActiveIntakeStepIndex(null)
                      saveResumeStep({ type: 'profile' })
                    } else if (activeIntakeStepIndex !== null) {
                      goToIntakeStep(activeIntakeStepIndex - 1)
                    }
                    resetOperationStatus()
                  }}
                  disabled={intakeSaving}
                  className="rounded-lg border border-[var(--chip-line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--link-bg-hover)] disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={saveActiveIntakeStep}
                  disabled={intakeSaving}
                  className="rounded-lg border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--lagoon-deep)] disabled:opacity-50"
                >
                  {intakeSaving
                    ? 'Saving...'
                    : activeIntakeStepIndex === intakeSteps.length - 1
                      ? 'Save & Continue to Tasks'
                      : 'Save & Continue'}
                </button>
              </div>
            </div>
          </div>
        ) : viewMode === 'journey' ? (
          /* Wizard Journey Mode */
          <div className="island-shell rounded-2xl overflow-hidden shadow-md">
            {activeTask ? (
              <div className="space-y-6 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    {/* Tags */}
                    <div className="mb-2 flex flex-wrap gap-2">
                      {activeTask.isUrgent && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">
                          <AlertTriangle size={11} aria-hidden="true" />
                          Urgent
                        </span>
                      )}
                      {!activeTask.completed && activeTask.dueFlag && (
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${getDueFlagClass(activeTask.dueFlag)}`}>
                          <Clock3 size={11} aria-hidden="true" />
                          {getDueFlagLabel(activeTask.dueFlag, activeTask.daysUntilDue)}
                        </span>
                      )}
                      <span className="px-2.5 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-[var(--vertex-blue)] uppercase tracking-wide border border-blue-100">
                        {activeTask.functionalArea}
                      </span>
                    </div>
                    <h2 className="display-title text-xl font-bold text-[var(--vertex-blue)]">
                      {activeTask.name}
                    </h2>
                  </div>

                  {/* Due Date Badge */}
                  <div className="text-left sm:text-right">
                    <span className="block text-[9px] uppercase font-bold tracking-widest text-[var(--vertex-gray)]">
                      Deadline
                    </span>
                    <span className={`text-xs font-semibold ${activeTask.dueDate ? 'text-[var(--sea-ink)]' : 'text-neutral-400 italic'}`}>
                      {activeTask.dueDate ? new Date(activeTask.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'No due date set'}
                    </span>
                    {!activeTask.completed && activeTask.dueFlag && (
                      <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${getDueFlagClass(activeTask.dueFlag)}`}>
                        <Clock3 size={10} aria-hidden="true" />
                        {getDueFlagLabel(activeTask.dueFlag, activeTask.daysUntilDue)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                        Task Owner
                      </div>
                      <p className="mt-1 text-sm font-semibold text-[var(--sea-ink)]">
                        {activeTaskAssignment
                          ? activeTaskAssignment.assignedToName || activeTaskAssignment.assignedToEmail
                          : currentContactRole === 'school_leader'
                            ? 'School Leader'
                            : 'Not assigned to you'}
                      </p>
                    </div>

                    {canAssignTasks && schoolContacts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setOwnerEditorTaskId((taskId) => taskId === activeTask.id ? null : activeTask.id)}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--chip-line)] bg-white px-3 py-2 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                      >
                        <Pencil size={14} aria-hidden="true" />
                        Change Owner
                      </button>
                    )}
                  </div>

                  {canAssignTasks && schoolContacts.length > 0 && ownerEditorTaskId === activeTask.id && (
                    <div className="mt-3 rounded-lg border border-[var(--chip-line)] bg-white p-3">
                      <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                        New task owner
                      </label>
                      <select
                        value={activeTaskAssignment?.assignedToEmail || ''}
                        onChange={(event) => handleAssignTask(activeTask.id, event.target.value)}
                        className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-bold text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                      >
                        <option value="" disabled>
                          Select owner
                        </option>
                        {schoolContacts.map((contact) => (
                          <option key={contact.id} value={contact.email}>
                            {contact.name || contact.email} - {contact.contactRole === 'school_leader' ? 'Leader' : 'Staff'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {!activeTaskActionable && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
                      <Lock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                      <span>
                        This task is view-only for your account. It must be completed by {activeTaskAssignment?.assignedToName || activeTaskAssignment?.assignedToEmail || 'a School Leader'}.
                      </span>
                    </div>
                  )}
                </div>

                {/* Instructions */}
                <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200/80 text-sm text-[var(--sea-ink)] leading-relaxed">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gray)] mb-2">
                    Task Description
                  </h4>
                  <p className="whitespace-pre-wrap">{displayedInstructionText}</p>
                  {taskDescriptionUrls.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {taskDescriptionUrls.map((url, index) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--vertex-blue)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          {taskDescriptionUrls.length === 1 ? 'Open Link' : `Open Link ${index + 1}`}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Completion / Upload Gate */}
                <div className="border-t border-[var(--line)] pt-6">
                  {activeTask.completed ? (
                    <div className="rounded-xl text-center">
                      <BrandedAlert variant="success" title="Onboarding step completed">
                        {activeTask.requiresFileUpload
                          ? `Thanks, ${contactName}. Your file has been uploaded for ${clientName}, and this onboarding step has been marked complete.`
                          : `Thanks, ${contactName}. This onboarding step has been marked complete for ${clientName}.`}
                      </BrandedAlert>
                      {activeTask.requiresFileUpload && (
                        <button
                          onClick={() => {
                            // Allow re-upload
                            resetOperationStatus()
                            // Temporarily mark as uncompleted locally so they can upload again
                          }}
                          disabled={isOperationPending}
                          className="mt-4 text-xs font-semibold underline text-[var(--vertex-blue)] hover:text-black cursor-pointer"
                        >
                          Upload a different document
                        </button>
                      )}
                    </div>
                  ) : activeTask.requiresFileUpload ? (
                    /* R2 Drag-and-Drop Uploader */
                    <div className="space-y-4">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gray)]">
                        Submit Required Document
                      </h4>
                      
                        <div
                          onDragEnter={handleDrag}
                          onDragOver={handleDrag}
                          onDragLeave={handleDrag}
                          onDrop={handleDrop}
                          onClick={() => {
                            if (!isOperationPending && activeTaskActionable) fileInputRef.current?.click()
                          }}
                          aria-busy={isOperationPending}
                          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition sm:p-8 ${!activeTaskActionable ? 'cursor-not-allowed border-neutral-200 bg-neutral-50 opacity-70' : isOperationPending ? 'cursor-not-allowed border-blue-200 bg-blue-50/60 opacity-80' : dragActive ? 'cursor-pointer border-[var(--vertex-gold)] bg-[var(--hero-b)]' : 'cursor-pointer border-[var(--chip-line)] hover:border-[var(--vertex-blue)] hover:bg-[var(--foam)]'}`}
                        >
                        <input
                          type="file"
                          ref={fileInputRef}
                            onChange={handleFileChange}
                            className="hidden"
                            accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx"
                            disabled={isOperationPending || !activeTaskActionable}
                          />
                        
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--vertex-gray)] mb-3">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>

                          <p className="text-sm font-semibold text-[var(--sea-ink)]">
                            {!activeTaskActionable ? 'View-only task' : isOperationPending ? 'Upload in progress...' : <>Drag and drop file here, or <span className="text-[var(--vertex-blue)] underline">browse files</span></>}
                          </p>
                        <p className="text-xxs text-[var(--sea-ink-soft)] mt-1.5">
                          Supports PDF, Excel, CSV, Word, or PNG/JPG images (Max 15MB)
                        </p>
                      </div>

                      {/* Upload Status Details */}
                      {isOperationPending && pendingStatus && (
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-start gap-3" role="status" aria-live="polite">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-[var(--vertex-blue)] border-r-transparent" />
                          <span className="text-left text-xs font-semibold text-blue-700">
                            <span className="block">{pendingStatus.title}</span>
                            <span className="mt-1 block font-normal text-blue-700/80">{pendingStatus.message}</span>
                          </span>
                        </div>
                      )}

                      {uploadProgress === 'error' && (
                        <BrandedAlert variant="error" title="Upload failed">
                          <span>
                            We could not complete that upload just now. Your task has not been marked complete yet. Please try again, or contact your Vertex onboarding team if the issue continues.
                            {uploadError && <span className="mt-1 block font-mono">({uploadError})</span>}
                          </span>
                        </BrandedAlert>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-5">
                        <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gray)]">
                          Complete This Step
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-[var(--sea-ink)]">
                          This step does not require a file upload. Review the instructions above, then mark it complete when finished.
                        </p>
                        <button
                          type="button"
                            role="switch"
                            aria-checked={false}
                            onClick={completeManualTask}
                            disabled={isOperationPending || !activeTaskActionable}
                            className="mt-4 inline-flex items-center gap-3 rounded-full border border-[var(--vertex-blue)] bg-white px-3 py-2 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="flex h-6 w-11 items-center rounded-full bg-neutral-200 p-1 transition">
                            <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                          </span>
                          <span>{isOperationPending ? 'Saving...' : 'Complete'}</span>
                        </button>
                      </div>

                      {isOperationPending && pendingStatus && (
                        <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4" role="status" aria-live="polite">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-[var(--vertex-blue)] border-r-transparent" />
                          <span className="text-xs font-semibold text-blue-700">
                            <span className="block">{pendingStatus.title}</span>
                            <span className="mt-1 block font-normal text-blue-700/80">{pendingStatus.message}</span>
                          </span>
                        </div>
                      )}

                      {uploadProgress === 'error' && (
                        <BrandedAlert variant="error" title="Step completion failed">
                          <span>
                            We could not complete that step just now. Please try again, or contact your Vertex onboarding team if the issue continues.
                            {uploadError && <span className="mt-1 block font-mono">({uploadError})</span>}
                          </span>
                        </BrandedAlert>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer Navigation */}
                <div className="grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4">
                  <button
                    onClick={() => {
                      if (activeTaskIndex === 0) {
                        if (intakeSteps.length > 0) {
                          const previousIntakeIndex = intakeSteps.length - 1
                          setActiveIntakeStepIndex(previousIntakeIndex)
                          setShowProfileStep(false)
                          saveResumeStep({ type: 'intake', intakeStepId: intakeSteps[previousIntakeIndex].id })
                        } else {
                          setShowProfileStep(true)
                          saveResumeStep({ type: 'profile' })
                        }
                        resetOperationStatus()
                      } else {
                        const previousTaskIndex = activeTaskIndex - 1
                        setActiveTaskIndex(previousTaskIndex)
                        saveResumeStep({ type: 'task', taskId: tasks[previousTaskIndex].id })
                        resetOperationStatus()
                      }
                    }}
                    disabled={isOperationPending}
                    className="rounded-lg border border-[var(--chip-line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--link-bg-hover)] disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => {
                      if (activeTaskIndex < tasks.length - 1) {
                        const nextTaskIndex = activeTaskIndex + 1
                        setActiveTaskIndex(nextTaskIndex)
                        saveResumeStep({ type: 'task', taskId: tasks[nextTaskIndex].id })
                        resetOperationStatus()
                      }
                    }}
                    disabled={isOperationPending || activeTaskIndex === tasks.length - 1}
                    className="rounded-lg border border-[var(--chip-line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--link-bg-hover)] disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-[var(--sea-ink-soft)]">No onboarding tasks available for this client.</p>
            )}
          </div>
        ) : (
          /* Checklist Mode */
          <div className="island-shell space-y-4 rounded-2xl p-5 shadow-md sm:p-6">
            <h3 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gold)]">
              All Onboarding Steps Checklist
            </h3>
            
            <div className="divide-y divide-[var(--line)]">
              <div
                onClick={() => {
                  setShowProfileStep(true)
                  setActiveIntakeStepIndex(null)
                  setViewMode('journey')
                  setShowCompleteStage(false)
                  saveResumeStep({ type: 'profile' })
                }}
                className="flex cursor-pointer flex-col gap-2 rounded-lg px-2 py-3.5 transition hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-xs font-bold text-green-700">
                    ✓
                  </span>
                  <div className="text-sm font-bold text-[var(--sea-ink)]">
                    Verify school profile
                  </div>
                </div>

                <span className="text-xs font-semibold text-green-700">
                  Step 1
                </span>
              </div>

              {intakeSteps.map((step, index) => {
                const isComplete = completedIntakeStepIds.includes(step.id) && isIntakeStepComplete(step, intakeResponses)

                return (
                  <div
                    key={step.id}
                    onClick={() => goToIntakeStep(index)}
                    className="flex cursor-pointer flex-col gap-2 rounded-lg px-2 py-3.5 transition hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold ${isComplete ? 'bg-green-100 text-green-700' : 'border border-neutral-300 text-neutral-400'}`}>
                        {isComplete ? '✓' : index + profileStepCount + 1}
                      </span>
                      <div className="min-w-0 text-sm font-bold text-[var(--sea-ink)]">
                        {step.title}
                        <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--sea-ink-soft)]">
                          {step.kind === 'rating' ? 'Readiness ratings' : 'Open response'}
                        </span>
                      </div>
                    </div>

                    <span className={`text-xs font-semibold ${isComplete ? 'text-green-700' : 'text-[var(--sea-ink-soft)]'}`}>
                      Step {index + profileStepCount + 1}
                    </span>
                  </div>
                )
              })}

              {displayedTasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--chip-line)] bg-white p-5 text-sm font-semibold text-[var(--sea-ink-soft)]">
                  No tasks are assigned to you yet. Switch to Full Journey to review the full onboarding process.
                </div>
              ) : displayedTasks.map((task) => {
                const idx = tasks.findIndex((candidate) => candidate.id === task.id)
                const assignment = assignmentsByTaskId.get(task.id)
                const taskActionable = isTaskActionableForCurrentUser(task.id)

                return (
                  <div
                    key={task.id}
                    onClick={() => {
                      setActiveTaskIndex(idx)
                      setActiveIntakeStepIndex(null)
                      setShowProfileStep(false)
                      setViewMode('journey')
                      saveResumeStep({ type: 'task', taskId: task.id })
                    }}
                    className={`flex flex-col gap-3 rounded-lg px-2 py-3.5 transition hover:bg-neutral-50 ${taskActionable ? '' : 'opacity-75'}`}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        {task.completed ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700 font-bold text-xs">
                            ✓
                          </span>
                        ) : taskActionable ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-neutral-400 font-bold text-xs">
                            {idx + asanaStepOffset + 1}
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400">
                            <Lock size={12} aria-hidden="true" />
                          </span>
                        )}
                        <div className="min-w-0 text-sm font-bold text-[var(--sea-ink)]">
                          {task.name}
                          {task.isUrgent && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-red-600">
                              <AlertTriangle size={10} aria-hidden="true" />
                              Urgent
                            </span>
                          )}
                          {!task.completed && task.dueFlag && (
                            <span className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide ${getDueFlagClass(task.dueFlag)}`}>
                              <Clock3 size={10} aria-hidden="true" />
                              {getDueFlagLabel(task.dueFlag, task.daysUntilDue)}
                            </span>
                          )}
                          {assignment && (
                            <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-[var(--sea-ink-soft)]">
                              Assigned to {assignment.assignedToName || assignment.assignedToEmail}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <span className={`text-xs font-semibold ${task.dueDate ? 'text-[var(--sea-ink-soft)]' : 'text-neutral-300 italic'}`}>
                          {task.dueDate ? new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No due date'}
                        </span>
                        {!task.completed && task.dueFlag && (
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-wide ${getDueFlagClass(task.dueFlag)}`}>
                            <Clock3 size={10} aria-hidden="true" />
                            {getDueFlagLabel(task.dueFlag, task.daysUntilDue)}
                          </span>
                        )}
                        {canAssignTasks && schoolContacts.length > 0 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              setOwnerEditorTaskId((taskId) => taskId === task.id ? null : task.id)
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--chip-line)] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                          >
                            <Pencil size={13} aria-hidden="true" />
                            Change Owner
                          </button>
                        )}
                      </div>
                    </div>

                    {canAssignTasks && schoolContacts.length > 0 && ownerEditorTaskId === task.id && (
                      <div
                        className="rounded-lg border border-[var(--chip-line)] bg-white p-3"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                          New task owner
                        </label>
                        <select
                          value={assignment?.assignedToEmail || ''}
                          onChange={(event) => handleAssignTask(task.id, event.target.value)}
                          className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-bold text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                        >
                          <option value="" disabled>
                            Select owner
                          </option>
                          {schoolContacts.map((contact) => (
                            <option key={contact.id} value={contact.email}>
                              {contact.name || contact.email} - {contact.contactRole === 'school_leader' ? 'Leader' : 'Staff'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      {/* VertexAI chatbot panel */}
      <div className={isChatOpen
        ? 'fixed inset-x-2 bottom-[5.75rem] z-50 flex flex-col items-end gap-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[390px]'
        : 'fixed right-0 bottom-28 z-50 hidden md:block'
      }>
        {!isChatOpen && (
          <button
            type="button"
            onClick={() => setIsChatOpen(true)}
            className={`relative inline-flex min-h-32 w-12 items-center justify-center gap-2 rounded-l-xl border border-r-0 py-4 text-sm font-bold shadow-2xl transition-transform duration-200 hover:-translate-x-1 focus-visible:-translate-x-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vertex-blue)] focus-visible:ring-offset-2 ${hasUnreadTeamMessages ? 'border-[var(--vertex-gold)] bg-amber-50 text-amber-900 ring-2 ring-[var(--vertex-gold)] ring-offset-2' : 'border-[var(--vertex-blue)] bg-white text-[var(--vertex-blue)]'}`}
            aria-label="Open help chat"
          >
            <span className="flex rotate-180 items-center gap-2 [writing-mode:vertical-rl]">
              <Sparkles size={16} className="text-[var(--vertex-gold)]" aria-hidden="true" />
              <span>Get Help</span>
              {hasUnreadTeamMessages && (
                <span className="rounded-full bg-[var(--vertex-gold)] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                  New
                </span>
              )}
            </span>
            {hasUnreadTeamMessages && (
              <span className="absolute -left-3 top-2 inline-flex min-w-7 items-center justify-center rounded-full bg-red-600 px-2 py-1 text-[10px] font-black text-white shadow-lg ring-2 ring-white">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--vertex-gold)] opacity-55" aria-hidden="true" />
                <span className="relative">{staffUnreadCount}</span>
              </span>
            )}
          </button>
        )}

        {isChatOpen && (
          <aside className="chat-popout-enter flex h-[min(620px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl sm:h-[min(620px,calc(100vh-7.5rem))]">
            {/* Chat Header */}
            <div className="bg-[var(--vertex-blue)] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
	                <Sparkles size={18} className="text-[var(--vertex-gold)]" aria-hidden="true" />
	                <div className="flex flex-col">
	                  <span className="text-sm font-bold font-display tracking-wide">Vertex Chat</span>
	                  <span className="text-[9px] tracking-wider text-white/70 font-semibold uppercase leading-none">AI helper + team messages</span>
	                </div>
	              </div>
              <button
                type="button"
                onClick={() => setIsChatOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
                aria-label="Close VertexAI chatbot"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

	            <div className="grid grid-cols-2 gap-1 border-b border-[var(--line)] bg-[var(--foam)] p-1 text-xs font-bold">
	              {[
	                ['ai', 'VertexAI', aiUnreadCount],
	                ['staff', 'Vertex Team', staffUnreadCount],
	              ].map(([tab, label, unread]) => (
	                <button
	                  key={tab as string}
	                  type="button"
	                  onClick={() => {
	                    setActiveChatTab(tab as ChatTab)
	                    setChatError('')
	                  }}
	                  className={`rounded-lg px-3 py-2 transition ${activeChatTab === tab ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'}`}
	                >
	                  {label as string}
	                  {Number(unread) > 0 && (
	                    <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--vertex-gold)] px-1.5 py-0.5 text-[9px] font-black text-white">
	                      {Number(unread)}
	                    </span>
	                  )}
	                </button>
	              ))}
	            </div>

	            {/* Chat notice */}
		            <div className="border-b border-[var(--line)] bg-white px-3 py-2">
		              <BrandedAlert variant="warning" title="NOTE">
		                {activeChatTab === 'ai'
		                  ? 'I can explain onboarding steps, but not legal, financial, tax, payroll, compliance, or contract advice.'
		                  : 'Messages here go to the Vertex onboarding team. Do not include bank account, payroll, or other sensitive document details.'}
		              </BrandedAlert>
		            </div>

	            {hasUnreadTeamMessages && activeChatTab !== 'staff' && (
	              <button
	                type="button"
	                onClick={() => {
	                  setActiveChatTab('staff')
	                  setChatError('')
	                }}
	                className="flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-100 px-3 py-3 text-left text-sm font-black text-amber-950 shadow-inner transition hover:bg-amber-200"
	              >
	                <span>
	                  New message from the Vertex Team
	                  <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
	                    {staffUnreadCount}
	                  </span>
	                </span>
	                <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-900">View</span>
	              </button>
	            )}

	            {/* Chat History Container */}
	            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--foam)]">
	              {activeChatLoading ? (
	                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
	                  Loading conversation...
	                </div>
	              ) : activeChatMessages.length === 0 ? (
	                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-xs leading-relaxed text-[var(--sea-ink)] shadow-xxs">
	                  {activeChatTab === 'ai'
	                    ? 'Hi! I am your Vertex onboarding assistant. I can help explain the required SFO onboarding documents, answer FAQs, and guide you on what to do next.'
	                    : 'Send a message to the Vertex onboarding team. Replies will appear here and stay with this school workspace.'}
	                </div>
	              ) : activeChatMessages.map((msg) => {
	                const isMine = msg.senderUserId === session?.user?.id
	                const label = msg.senderType === 'ai' ? 'VertexAI' : msg.senderName || msg.senderEmail || (msg.senderType === 'staff' ? 'Vertex Team' : 'Client')
	                const modelBadge = msg.senderType === 'ai' ? getModelBadge(msg) : null
	                return (
	                  <div
	                    key={msg.id}
	                    className={`flex flex-col max-w-[85%] ${isMine ? 'ml-auto items-end' : 'items-start'}`}
	                  >
	                    <div
	                      className={`p-3 rounded-2xl text-xs leading-relaxed ${isMine ? 'bg-[var(--vertex-blue)] text-white rounded-br-none' : 'bg-white text-[var(--sea-ink)] border border-[var(--line)] rounded-bl-none shadow-xxs'}`}
	                    >
	                      {renderChatMarkdown(msg.body)}
	                    </div>
	                    <span className="text-[9px] text-[var(--sea-ink-soft)] font-semibold mt-1 px-1">
	                      {label} · {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
	                      {modelBadge && (
	                        <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 uppercase tracking-wide ${modelBadge.className}`}>
	                          {modelBadge.label}
	                          {msg.aiModel === '@cf/google/gemma-4-26b-a4b-it' && <AiDisclosure className="h-4 w-4" />}
	                        </span>
	                      )}
	                    </span>
	                  </div>
	                )
	              })}
	              {(aiLoading || teamSending) && (
	                <div className="flex items-center gap-2 bg-white/75 p-3 rounded-2xl border border-[var(--line)] max-w-[50%] animate-pulse">
	                  <div className="flex gap-1">
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce" />
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
	                </div>
	              )}
	              {chatError && (
	                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
	                  {chatError}
	                </div>
	              )}
	              <div ref={chatBottomRef} />
	            </div>

	            {/* Chat input box */}
	            <form onSubmit={handleSendChat} className="p-3 border-t border-[var(--line)] bg-white flex gap-2">
              <input
	                type="text"
	                value={chatInput}
	                onChange={(e) => setChatInput(e.target.value)}
	                placeholder={activeChatTab === 'ai' ? 'Ask VertexAI a question...' : 'Message the Vertex Team...'}
	                className="min-w-0 flex-1 rounded-xl border border-[var(--chip-line)] bg-neutral-50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--vertex-blue)]"
	              />
	              <button
	                type="submit"
	                disabled={aiLoading || teamSending || !chatInput.trim()}
	                className="p-2 bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)] text-white rounded-xl disabled:opacity-45 cursor-pointer transition flex items-center justify-center"
	                aria-label={activeChatTab === 'ai' ? 'Send message to VertexAI' : 'Send message to Vertex Team'}
	              >
                <Send size={16} aria-hidden="true" />
              </button>
            </form>
          </aside>
        )}
      </div>
    </main>
  )
}
