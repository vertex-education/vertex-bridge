import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/start-server-core'
import { useState, useRef, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Send, Sparkles, X } from 'lucide-react'
import { authClient } from '#/lib/auth-client'
import { completeOnboardingTaskManually, getOnboardingTasks } from '#/lib/asana'
import { uploadOnboardingFile } from '#/lib/uploads'
import { AiDisclosure } from '#/components/AiDisclosure'
import { BrandedAlert } from '#/components/BrandedAlert'

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
}

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

    const request = getRequest()
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
    const { clientProfiles, invitations } = await import('#/db/schema')
    const { asc, eq } = await import('drizzle-orm')

    const request = getRequest()
    const session = await auth.api.getSession({
      headers: request.headers,
    })

    if (!session?.user?.email) {
      return []
    }

    const [inviteRows, profileRows] = await Promise.all([
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
    ])

    const profilesBySchool = new Map<string, ContractProfile>()

    for (const profile of profileRows) {
      profilesBySchool.set(profile.schoolName, {
        schoolName: profile.schoolName,
        state: profile.state,
        services: profile.services,
        clientType: profile.clientType,
        contact: session.user.name || profile.primaryContactName,
        csOwner: profile.onboardingCoordinator,
      })
    }

    for (const invite of inviteRows) {
      if (!invite.schoolName || profilesBySchool.has(invite.schoolName)) continue
      profilesBySchool.set(invite.schoolName, {
        schoolName: invite.schoolName,
        state: invite.state || 'Not specified',
        services: invite.services || 'Not specified',
        clientType: invite.clientType || 'Not specified',
        contact: session.user.name || 'Signed-in user',
        csOwner: 'Vertex onboarding team',
      })
    }

    return Array.from(profilesBySchool.values())
  })

const profileStepCount = 1
const completedStageStorageKey = 'vertex-bridge:onboarding-complete-stage'

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
    csOwner: 'Vertex onboarding team'
  })
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
  const [uploadProgress, setUploadProgress] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

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
  }, [selectedProfile])

  useEffect(() => {
    if (!selectedSchoolName) return

    window.localStorage.setItem('vertex-bridge:selected-school', selectedSchoolName)
    setShowProfileStep(true)
    setActiveTaskIndex(0)
    setShowCompleteStage(false)
    setViewMode('journey')
    setUploadProgress('idle')
    setUploadError('')
    setDiscrepancy('')
    setDiscrepancyStatus(null)
  }, [selectedSchoolName])

  // Get active task
  const activeTask = tasks[activeTaskIndex] || null
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
  const progressPercent = isLoading || totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100)
  const allStepsComplete = !isLoading && tasks.length > 0 && progressPercent === 100
  const currentStepNumber = showProfileStep ? 1 : activeTask ? activeTaskIndex + profileStepCount + 1 : null

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
    if (isLoading) return
    if (!allStepsComplete) {
      setShowCompleteStage(false)
      window.localStorage.removeItem(currentCompletedStageStorageKey)
      return
    }
    setShowCompleteStage(true)
    window.localStorage.setItem(currentCompletedStageStorageKey, 'true')
  }, [allStepsComplete, currentCompletedStageStorageKey, isLoading])

  // File drag & drop handlers
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      await uploadFile(e.dataTransfer.files[0])
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      await uploadFile(e.target.files[0])
    }
  }

  const uploadFile = async (file: File) => {
    if (!activeTask) return
    if (!activeTask.requiresFileUpload) {
      setUploadProgress('error')
      setUploadError('This onboarding step does not require a file upload. Use the complete button instead.')
      return
    }
    setUploadProgress('loading')
    setUploadError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('asanaTaskId', activeTask.id)
    formData.append('asanaTaskName', activeTask.name)
    formData.append('schoolName', clientName)

    try {
      const result = await uploadOnboardingFile({ data: formData })
      if (result.success) {
        setUploadProgress('success')
        // Invalidate tasks query to trigger dynamic update
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        
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
        setUploadProgress('error')
        setUploadError(result.asanaError || 'Could not complete Asana update.')
      }
    } catch (err: any) {
      setUploadProgress('error')
      setUploadError(err.message || 'File upload failed.')
    }
  }

  const completeManualTask = async () => {
    if (!activeTask) return
    setUploadProgress('loading')
    setUploadError('')

    try {
      const result = await completeOnboardingTaskManually({
        data: {
          taskId: activeTask.id,
          taskName: activeTask.name,
          schoolName: clientName,
        },
      })

      if (result.success) {
        setUploadProgress('success')
        await queryClient.invalidateQueries({ queryKey: ['onboarding-tasks'] })
        setChatHistory(prev => [
          ...prev,
          {
            sender: 'ai',
            text: `Thanks, ${contactName}. "${activeTask.name}" has been marked complete for ${clientName}.`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ])
      } else {
        setUploadProgress('error')
        setUploadError(result.asanaError || 'Could not complete this onboarding step.')
      }
    } catch (err: any) {
      setUploadProgress('error')
      setUploadError(err.message || 'Could not complete this onboarding step.')
    }
  }

  const handleProfileConfirm = () => {
    setShowProfileStep(false)
    setActiveTaskIndex(0)
    setViewMode('journey')
    setUploadProgress('idle')
  }

  const handleDiscrepancy = () => {
    setShowDiscrepancyForm(true)
    setDiscrepancyStatus(null)
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
      <section className="w-full space-y-6">
        <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="page-kicker">
              Onboarding Journey
            </div>
            <h1 className="page-title">
              {clientName} Onboarding
            </h1>
          </div>

          {/* Toggle Modes */}
          {!allStepsComplete && (
            <div className="grid grid-cols-2 rounded-xl border border-neutral-300 bg-neutral-200/60 p-1 sm:inline-flex">
              <button
                onClick={() => setViewMode('journey')}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition sm:px-4 sm:py-1.5 ${viewMode === 'journey' ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-neutral-600 hover:text-black'}`}
              >
                Journey Wizard
              </button>
              <button
                onClick={() => setViewMode('all')}
                className={`rounded-lg px-3 py-2 text-xs font-bold transition sm:px-4 sm:py-1.5 ${viewMode === 'all' ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-neutral-600 hover:text-black'}`}
              >
                All Steps ({journeyStepCount})
              </button>
            </div>
          )}
        </div>

        <div className="island-shell rounded-xl border border-[var(--line)] bg-white p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
                Active School
              </div>
              <div className="mt-1 text-sm font-semibold text-[var(--sea-ink-soft)]">
                {schoolProfilesLoading
                  ? 'Loading school access...'
                  : schoolProfiles.length > 1
                    ? 'Switch between schools to view each onboarding workspace.'
                    : 'This onboarding workspace is scoped to your assigned school.'}
              </div>
            </div>

            {schoolProfiles.length > 1 ? (
              <div className="w-full sm:max-w-sm">
                <label className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--sea-ink)]">
                  School
                </label>
                <select
                  value={selectedSchoolName}
                  onChange={(event) => setSelectedSchoolName(event.target.value)}
                  className="w-full rounded-xl border border-[var(--chip-line)] bg-white px-4 py-2 text-sm font-bold text-[var(--sea-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
                >
                  {schoolProfiles.map((school) => (
                    <option key={school.schoolName} value={school.schoolName}>
                      {school.schoolName}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] px-4 py-3 text-sm font-bold text-[var(--sea-ink)]">
                {selectedProfile?.schoolName || 'No school assigned'}
              </div>
            )}
          </div>
        </div>

        {!schoolProfilesLoading && schoolProfiles.length === 0 && (
          <BrandedAlert variant="warning" title="No school access found">
            Your account is not linked to a school onboarding workspace yet. Use your latest invite link or contact Vertex support.
          </BrandedAlert>
        )}

        <div className="island-shell rounded-xl border border-[var(--line)] bg-white p-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Client onboarding steps">
            <button
              type="button"
              onClick={() => {
                setShowProfileStep(true)
                setShowCompleteStage(false)
                setViewMode('journey')
                setUploadProgress('idle')
              }}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
                showProfileStep && viewMode === 'journey' && !showCompleteStage
                  ? 'border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white'
                  : 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
              }`}
              aria-label="Go to step 1, Verify School Profile"
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                showProfileStep && viewMode === 'journey' && !showCompleteStage
                  ? 'bg-white/20 text-white'
                  : 'bg-green-100 text-green-700'
              }`}>
                ✓
              </span>
              <span>Step 1</span>
            </button>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, idx) => (
                <div key={`step-skeleton-${idx}`} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-[var(--chip-line)] bg-white px-3">
                  <SkeletonBlock className="h-5 w-5 rounded-full" />
                  <SkeletonBlock className="h-3 w-12" />
                </div>
              ))
            ) : tasks.map((task, idx) => {
              const stepNumber = idx + profileStepCount + 1
              const isActive = idx === activeTaskIndex && viewMode === 'journey' && !showProfileStep && !showCompleteStage

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => {
                    setActiveTaskIndex(idx)
                    setShowProfileStep(false)
                    setShowCompleteStage(false)
                    setViewMode('journey')
                    setUploadProgress('idle')
                  }}
                  className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
                    isActive
                      ? 'border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white'
                      : task.completed
                        ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                        : 'border-[var(--chip-line)] bg-white text-[var(--sea-ink-soft)] hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]'
                  }`}
                  aria-label={`Go to step ${stepNumber}, ${task.name}`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                    task.completed
                      ? 'bg-green-100 text-green-700'
                      : isActive
                        ? 'bg-white/20 text-white'
                        : 'bg-neutral-100 text-[var(--sea-ink-soft)]'
                  }`}>
                    {task.completed ? '✓' : stepNumber}
                  </span>
                  <span>Step {stepNumber}</span>
                </button>
              )
            })}

            <button
              type="button"
              onClick={() => {
                if (!allStepsComplete) return
                setShowCompleteStage(true)
                window.localStorage.setItem(currentCompletedStageStorageKey, 'true')
              }}
              disabled={!allStepsComplete}
              className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-xs font-bold transition ${
                showCompleteStage && allStepsComplete
                  ? 'border-[var(--vertex-blue)] bg-[var(--vertex-blue)] text-white'
                  : allStepsComplete
                    ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                    : 'border-[var(--chip-line)] bg-white text-[var(--sea-ink-soft)] opacity-60'
              }`}
              aria-label="Go to completion stage"
            >
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                allStepsComplete
                  ? showCompleteStage
                    ? 'bg-white/20 text-white'
                    : 'bg-green-100 text-green-700'
                  : 'bg-neutral-100 text-[var(--sea-ink-soft)]'
              }`}>
                {allStepsComplete ? '✓' : totalCount}
              </span>
              <span>Complete</span>
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="island-shell flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-col gap-1 text-xs font-bold text-[var(--sea-ink)] sm:flex-row sm:justify-between">
              <span>Overall Completion</span>
              <span>
                {isLoading ? 'Loading steps...' : `${completedCount} of ${totalCount} Steps (${progressPercent}%)`}
              </span>
            </div>
            <div className="w-full bg-neutral-200 h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-[var(--vertex-blue)] to-[var(--vertex-gold)] h-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
          {allStepsComplete && (
            <span className="rounded-lg border border-green-200 bg-green-100 p-2 text-center text-xs font-bold text-green-700 sm:animate-bounce">
              🎉 All Steps Complete!
            </span>
          )}
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
                          className="inline-flex items-center gap-2 rounded-lg bg-[var(--vertex-blue)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--link-hover)]"
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
                            setUploadProgress('idle')
                            // Temporarily mark as uncompleted locally so they can upload again
                          }}
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
                        onClick={() => fileInputRef.current?.click()}
                        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-5 text-center transition sm:p-8 ${dragActive ? 'border-[var(--vertex-gold)] bg-[var(--hero-b)]' : 'border-[var(--chip-line)] hover:border-[var(--vertex-blue)] hover:bg-[var(--foam)]'}`}
                      >
                        <input
                          type="file"
                          ref={fileInputRef}
                          onChange={handleFileChange}
                          className="hidden"
                          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.xls,.csv,.doc,.docx"
                        />
                        
                        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--vertex-gray)] mb-3">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>

                        <p className="text-sm font-semibold text-[var(--sea-ink)]">
                          Drag and drop file here, or <span className="text-[var(--vertex-blue)] underline">browse files</span>
                        </p>
                        <p className="text-xxs text-[var(--sea-ink-soft)] mt-1.5">
                          Supports PDF, Excel, CSV, Word, or PNG/JPG images (Max 15MB)
                        </p>
                      </div>

                      {/* Upload Status Details */}
                      {uploadProgress === 'loading' && (
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-3">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-[var(--vertex-blue)] border-r-transparent" />
                          <span className="text-xs font-semibold text-blue-700">Uploading file to Cloudflare R2 and completing Asana task...</span>
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
                          disabled={uploadProgress === 'loading'}
                          className="mt-4 inline-flex items-center gap-3 rounded-full border border-[var(--vertex-blue)] bg-white px-3 py-2 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)] disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span className="flex h-6 w-11 items-center rounded-full bg-neutral-200 p-1 transition">
                            <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
                          </span>
                          <span>{uploadProgress === 'loading' ? 'Completing step...' : 'Complete'}</span>
                        </button>
                      </div>

                      {uploadProgress === 'loading' && (
                        <div className="flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-[var(--vertex-blue)] border-r-transparent" />
                          <span className="text-xs font-semibold text-blue-700">Completing this onboarding step...</span>
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
                        setUploadProgress('idle')
                      } else {
                        setActiveTaskIndex(prev => prev - 1)
                        setUploadProgress('idle')
                      }
                    }}
                    className="rounded-lg border border-[var(--chip-line)] px-4 py-2 text-xs font-bold transition hover:bg-[var(--link-bg-hover)] disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => {
                      if (activeTaskIndex < tasks.length - 1) {
                        setActiveTaskIndex(prev => prev + 1)
                        setUploadProgress('idle')
                      }
                    }}
                    disabled={activeTaskIndex === tasks.length - 1}
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

              {tasks.map((task, idx) => (
                <div
                  key={task.id}
                  onClick={() => {
                    setActiveTaskIndex(idx)
                    setShowProfileStep(false)
                    setViewMode('journey')
                  }}
                  className="flex flex-col gap-2 rounded-lg px-2 py-3.5 transition hover:bg-neutral-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {task.completed ? (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-green-700 font-bold text-xs">
                        ✓
                      </span>
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neutral-300 text-neutral-400 font-bold text-xs">
                        {idx + profileStepCount + 1}
                      </span>
                    )}
                    <div className="min-w-0 text-sm font-bold text-[var(--sea-ink)]">
                      {task.name}
                      {task.isUrgent && (
                        <span className="ml-2 px-2 py-0.5 text-[8px] rounded-full bg-red-100 text-red-600 uppercase font-extrabold tracking-wide">
                          Urgent
                        </span>
                      )}
                    </div>
                  </div>

                  <span className={`text-xs font-semibold ${task.dueDate ? 'text-[var(--sea-ink-soft)]' : 'text-neutral-300 italic'}`}>
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No due date'}
                  </span>
                </div>
              ))}
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
