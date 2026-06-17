import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Lock, Pencil, Send, Sparkles, X } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { completeOnboardingTaskManually, getOnboardingTasks } from '#/lib/asana'
import { uploadOnboardingFile } from '#/lib/uploads'
import { AiDisclosure } from '#/components/AiDisclosure'
import { BrandedAlert } from '#/components/BrandedAlert'
import { getServerRequest } from '#/lib/security'

export const Route = createFileRoute('/school-onboarding')({
  component: SchoolOnboardingPage,
})

type Message = {
  sender: 'user' | 'ai'
  text: string
  timestamp: string
  model?: string
  isFallback?: boolean
}

type VertexAIResponse = {
  text: string
  isFallback: boolean
  model: string
  diagnostic: string | null
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

type OnboardingOperationStatus =
  | 'idle'
  | 'preparing-upload'
  | 'storing-file'
  | 'syncing-asana'
  | 'saving-task'
  | 'refreshing'
  | 'success'
  | 'error'

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
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

const profileStepCount = 1
const completedStageStorageKey = 'vertex-bridge:onboarding-complete-stage'
const resumeStepStorageKey = 'vertex-bridge:onboarding-resume-step'

type StoredResumeStep = {
  type: 'profile' | 'task'
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pendingStatusTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])

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

  // AI Helper state
  const [chatInput, setChatInput] = useState('')
  const [chatHistory, setChatHistory] = useState<Message[]>([
    {
      sender: 'ai',
      text: 'Hi! I am your Vertex onboarding assistant. I can help explain the required SFO onboarding documents, answer FAQs, and guide you on what to do next.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ])
  const [aiLoading, setAiLoading] = useState(false)
  const chatBottomRef = useRef<HTMLDivElement>(null)

  const getModelBadge = (msg: Message) => {
    if (msg.model === '@cf/google/gemma-4-26b-a4b-it') {
      return {
        label: 'VertexAI',
        className: 'bg-green-100 text-green-700',
      }
    }

    if (msg.model === 'gemma-error') {
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

  // Scroll to bottom of chat when history updates
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory])

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
    setActiveTaskIndex(0)
    setShowCompleteStage(false)
    setViewMode(selectedProfile?.contactRole === 'school_staff' ? 'all' : 'journey')
    resetOperationStatus()
    setDiscrepancy('')
    setDiscrepancyStatus(null)
    setShowMyTasksOnly(selectedProfile?.contactRole === 'school_staff')
    setOwnerEditorTaskId(null)
  }, [selectedSchoolName, selectedProfile?.contactRole])

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

  const completedCount = profileStepCount + tasks.filter(t => t.completed).length
  const totalCount = profileStepCount + tasks.length
  const journeyStepCount = totalCount
  const currentCompletedStageStorageKey = selectedSchoolName
    ? `${completedStageStorageKey}:${selectedSchoolName}`
    : completedStageStorageKey
  const currentResumeStepStorageKey = selectedSchoolName
    ? `${resumeStepStorageKey}:${selectedSchoolName}`
    : resumeStepStorageKey
  const progressPercent = isLoading || totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  const allStepsComplete = !isLoading && tasks.length > 0 && progressPercent === 100
  const currentStepNumber = showProfileStep ? 1 : activeTask ? activeTaskIndex + profileStepCount + 1 : null
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
    ? currentIncompleteTaskIndex + profileStepCount + 1
    : null
  const nextIncompleteTaskEntry = currentIncompleteTaskIndex >= 0
    ? scopedTaskEntries.find(({ task, index }) => index > currentIncompleteTaskIndex && !task.completed)
    : null
  const canJumpToCurrentIncompleteStep = !isLoading
    && Boolean(currentIncompleteTask)
    && currentIncompleteTaskIndex >= 0
    && (showProfileStep || showCompleteStage || viewMode !== 'journey' || activeTaskIndex !== currentIncompleteTaskIndex)

  const goToCurrentIncompleteStep = () => {
    if (!currentIncompleteTask || currentIncompleteTaskIndex < 0) return

    setActiveTaskIndex(currentIncompleteTaskIndex)
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    saveResumeStep({ type: 'task', taskId: currentIncompleteTask.id })
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

    if (currentIncompleteTask) {
      const nextTask = nextIncompleteTaskEntry?.task
      return {
        label: 'Next step',
        title: nextTask?.name || 'Complete assigned work',
        meta: nextIncompleteTaskEntry
          ? `Step ${nextIncompleteTaskEntry.index + profileStepCount + 1} of ${totalCount}`
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
      setActiveTaskIndex(0)
      setShowCompleteStage(false)
      setViewMode('journey')
      resetOperationStatus()
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
    setShowProfileStep(false)
    setShowCompleteStage(false)
    setViewMode('journey')
    resetOperationStatus()
    saveResumeStep({ type: 'task', taskId: tasks[fallbackTaskIndex].id })
  }, [currentContactRole, currentResumeStepStorageKey, isLoading, selectedSchoolName, tasks])

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
        // Invalidate tasks query to trigger dynamic update
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        setUploadProgress('success')
        
        // Add success notification in chat as well
        setChatHistory(prev => [
          ...prev,
          {
            sender: 'ai',
            text: `Thanks, ${contactName}. Your file "${file.name}" has been successfully uploaded for ${clientName}, and this onboarding step has been marked complete in Asana.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
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
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        setUploadProgress('success')
        setChatHistory(prev => [
          ...prev,
          {
            sender: 'ai',
            text: `Thanks, ${contactName}. "${activeTask.name}" has been marked complete for ${clientName}.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
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
    setActiveTaskIndex(0)
    setViewMode('journey')
    if (tasks[0]) {
      saveResumeStep({ type: 'task', taskId: tasks[0].id })
    }
    resetOperationStatus()
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

  // AI Assistant trigger
  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return

    const userMsg = chatInput.trim()
    setChatInput('')
    
    const userTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    setChatHistory(prev => [...prev, { sender: 'user', text: userMsg, timestamp: userTimestamp }])
    
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
            schoolName: profile.schoolName,
            contactName,
            services: profile.services,
            clientType: profile.clientType,
            state: profile.state,
          },
          history: chatHistory.slice(-6).map(h => ({ sender: h.sender, text: h.text }))
        }),
      })

      const aiResponse = await response.json() as VertexAIResponse

      if (!response.ok) {
        throw new Error(aiResponse.text || `VertexAI API returned HTTP ${response.status}`)
      }

      const aiTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setChatHistory(prev => [
        ...prev,
        {
          sender: 'ai',
          text: aiResponse.text,
          timestamp: aiTimestamp,
          model: aiResponse.model,
          isFallback: aiResponse.isFallback
        }
      ])
    } catch (err: any) {
      console.error('VertexAI chat request failed:', err)
      const aiTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setChatHistory(prev => [...prev, {
        sender: 'ai',
        text: err instanceof Error && err.message
          ? err.message
          : 'VertexAI could not connect just now. If this page was open during an update, refresh once and try again.',
        timestamp: aiTimestamp,
        model: 'vertexai-error',
        isFallback: false
      }])
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
                {isLoading ? 'Loading steps...' : `${completedCount} of ${totalCount} Steps (${progressPercent}%)`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full bg-gradient-to-r from-[var(--vertex-blue)] to-[var(--vertex-gold)] transition-all duration-500"
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

        {showCompleteStage && allStepsComplete ? (
          <div className="island-shell rounded-2xl overflow-hidden shadow-md">
            <div className="bg-[var(--vertex-blue)] px-6 py-6 text-white">
              <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xl font-bold">
                ✓
              </div>
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Onboarding Complete
              </div>
              <h2 className="display-title mt-1.5 text-2xl font-bold">
                Congratulations, {contactName}.
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-5 text-white/85">
                You have completed the onboarding journey for {clientName}. Your submissions have been received and are ready for Vertex review.
              </p>
            </div>

            <div className="grid gap-5 p-5 md:grid-cols-[1.2fr_0.8fr] sm:p-6">
              <div className="space-y-4">
                <BrandedAlert variant="success" title="Your client journey is complete">
                  Your Vertex client representatives will review the completed materials and reach out with next steps.
                </BrandedAlert>

                <div className="rounded-xl border border-[var(--line)] bg-neutral-50 p-4">
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

              <div className="rounded-xl border border-[var(--line)] bg-white p-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                  Completion Summary
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                    <span className="text-xs font-semibold text-[var(--sea-ink-soft)]">Client</span>
                    <span className="text-right text-xs font-bold text-[var(--sea-ink)]">{clientName}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                    <span className="text-xs font-semibold text-[var(--sea-ink-soft)]">Completed steps</span>
                    <span className="text-xs font-bold text-green-700">{completedCount} of {totalCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-[var(--sea-ink-soft)]">Status</span>
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-green-700">
                      Complete
                    </span>
                  </div>
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
                        <span className="px-2.5 py-0.5 text-[9px] font-bold rounded-full bg-red-100 text-red-700 uppercase tracking-wide">
                          🔴 URGENT (Payroll)
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
                        setShowProfileStep(true)
                        saveResumeStep({ type: 'profile' })
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
                            {idx + profileStepCount + 1}
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-200 bg-neutral-50 text-neutral-400">
                            <Lock size={12} aria-hidden="true" />
                          </span>
                        )}
                        <div className="min-w-0 text-sm font-bold text-[var(--sea-ink)]">
                          {task.name}
                          {task.isUrgent && (
                            <span className="ml-2 px-2 py-0.5 text-[8px] rounded-full bg-red-100 text-red-600 uppercase font-extrabold tracking-wide">
                              Urgent
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
      <div className="fixed inset-x-2 bottom-[5.75rem] z-50 flex flex-col items-end gap-3 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[390px]">
        {!isChatOpen && (
          <button
            type="button"
            onClick={() => setIsChatOpen(true)}
            className="hidden items-center justify-center gap-2 rounded-full border border-[var(--vertex-blue)] bg-white px-4 py-3 text-xs font-bold text-[var(--vertex-blue)] shadow-2xl transition hover:bg-[var(--foam)] md:inline-flex"
            aria-label="Open VertexAI onboarding helper"
          >
            <Sparkles size={16} className="text-[var(--vertex-gold)]" aria-hidden="true" />
            <span>VertexAI</span>
          </button>
        )}

        {isChatOpen && (
          <aside className="flex h-[min(620px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl sm:h-[min(620px,calc(100vh-7.5rem))]">
            {/* Chat Header */}
            <div className="bg-[var(--vertex-blue)] text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[var(--vertex-gold)]" aria-hidden="true" />
                <div className="flex flex-col">
                  <span className="text-sm font-bold font-display tracking-wide">VertexAI</span>
                  <span className="text-[9px] tracking-wider text-white/70 font-semibold uppercase leading-none">onboarding helper</span>
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

            {/* AI Guardrail disclaimer */}
            <div className="border-b border-[var(--line)] bg-white px-3 py-2">
              <BrandedAlert variant="warning" title="NOTE">
                I can explain onboarding steps, but not legal, financial, tax, payroll, compliance, or contract advice.
              </BrandedAlert>
            </div>

            {/* Chat History Container */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--foam)]">
              {chatHistory.map((msg, index) => (
                <div
                  key={index}
                  className={`flex flex-col max-w-[85%] ${msg.sender === 'user' ? 'ml-auto items-end' : 'items-start'}`}
                >
                  <div
                    className={`p-3 rounded-2xl text-xs leading-relaxed ${msg.sender === 'user' ? 'bg-[var(--vertex-blue)] text-white rounded-br-none' : 'bg-white text-[var(--sea-ink)] border border-[var(--line)] rounded-bl-none shadow-xxs'}`}
                  >
                    {renderChatMarkdown(msg.text)}
                  </div>
                  <span className="text-[9px] text-[var(--sea-ink-soft)] font-semibold mt-1 px-1">
                    {msg.timestamp}
                    {msg.sender === 'ai' && getModelBadge(msg) && (
                      <span className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 uppercase tracking-wide ${getModelBadge(msg)?.className}`}>
                        {getModelBadge(msg)?.label}
                        {msg.model === '@cf/google/gemma-4-26b-a4b-it' && <AiDisclosure className="h-4 w-4" />}
                      </span>
                    )}
                  </span>
                </div>
              ))}
              {aiLoading && (
                <div className="flex items-center gap-2 bg-white/75 p-3 rounded-2xl border border-[var(--line)] max-w-[50%] animate-pulse">
                  <div className="flex gap-1">
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce" />
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 bg-[var(--vertex-blue)] rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
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
                placeholder="Ask VertexAI a question..."
                className="min-w-0 flex-1 rounded-xl border border-[var(--chip-line)] bg-neutral-50 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--vertex-blue)]"
              />
              <button
                type="submit"
                disabled={aiLoading || !chatInput.trim()}
                className="p-2 bg-[var(--vertex-blue)] hover:bg-[var(--lagoon-deep)] text-white rounded-xl disabled:opacity-45 cursor-pointer transition flex items-center justify-center"
                aria-label="Send message to VertexAI"
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
