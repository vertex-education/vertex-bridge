import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, RefreshCw, SlidersHorizontal } from 'lucide-react'
import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { authClient } from '#/lib/auth-client'
import { eq, desc, sql } from 'drizzle-orm'
import { reviewSubmission, sendNudgeEmail } from '#/lib/uploads'
import { seedOnboardingProgressCache } from '#/lib/asana'
import { assertTrustedOrigin, getServerRequest, requireStaffSession } from '#/lib/security'
import { BrandedAlert } from '#/components/BrandedAlert'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Select } from '#/components/ui/select'
import { CLIENT_TYPES, formatClientType } from '#/lib/client-types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#/components/ui/table'

const profileStepCount = 1
const fallbackTaskCount = 5
const healthRiskWindowDays = 14
const taskActivityPageSize = 8
const demoSchoolName = 'Heritage Summit Schools'
const demoSchoolState = 'California'
const demoSchoolClientType = 'New'
const demoSchoolServices = 'SFO (Accounting, AP, Payroll, Grants)'
const demoOnboardingCoordinator = 'Eugene B. (AP/Payroll Lead)'
const emptyDashboardData = { clients: [], invites: [], submissions: [], progress: [], taskStates: [], projects: [], nudgeSettings: [] }

function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-neutral-200/80 ${className}`} />
}

function DashboardMobileSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={`mobile-skeleton-${index}`} className="rounded-xl border border-[var(--chip-line)] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-5 w-56 max-w-full" />
              <SkeletonBlock className="h-3 w-64 max-w-full" />
            </div>
            <SkeletonBlock className="h-6 w-20 rounded" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <SkeletonBlock className="col-span-2 h-16" />
            <SkeletonBlock className="h-14" />
            <SkeletonBlock className="h-14" />
            <SkeletonBlock className="col-span-2 h-14" />
          </div>
        </div>
      ))}
    </>
  )
}

function DashboardTableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <Fragment key={`table-skeleton-${index}`}>
          <TableRow className="border-t border-[var(--line)]">
            <TableCell colSpan={5} className="p-4 pb-2">
              <SkeletonBlock className="mb-2 h-5 w-72 max-w-full" />
              <SkeletonBlock className="h-3 w-48 max-w-full" />
            </TableCell>
            <TableCell colSpan={4} className="p-4 pb-2">
              <div className="flex justify-end gap-2">
                <SkeletonBlock className="h-9 w-24" />
                <SkeletonBlock className="h-9 w-32" />
              </div>
            </TableCell>
          </TableRow>
          <TableRow>
            {Array.from({ length: 9 }).map((_, cellIndex) => (
              <TableCell key={cellIndex} className="p-4 pt-2">
                <SkeletonBlock className="mb-2 h-3 w-16" />
                <SkeletonBlock className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        </Fragment>
      ))}
    </>
  )
}

function DashboardMetricCard({
  label,
  value,
  detail,
  icon,
  active,
  variant = 'neutral',
  onClick,
}: {
  label: string
  value: number | string
  detail: string
  icon: ReactNode
  active: boolean
  variant?: 'neutral' | 'warning' | 'success' | 'danger'
  onClick: () => void
}) {
  const colorClass = {
    neutral: 'text-[var(--vertex-blue)]',
    warning: 'text-amber-700',
    success: 'text-emerald-700',
    danger: 'text-red-700',
  }[variant]

  return (
    <button
      type="button"
      onClick={onClick}
      className={`app-card app-card-interactive rounded-xl p-4 text-left ${active ? 'app-card-active' : ''}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--sea-ink-soft)]">{label}</span>
        <span className={colorClass}>{icon}</span>
      </div>
      <div className={`mt-3 font-display text-3xl font-black ${colorClass}`}>{value}</div>
      <p className="mt-1 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">{detail}</p>
    </button>
  )
}

function HealthRiskBadge({ row }: { row: Pick<DashboardRow, 'healthRiskLevel' | 'healthRiskLabel'> }) {
  if (row.healthRiskLevel !== 'Critical' && row.healthRiskLevel !== 'At Risk') return null

  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
      row.healthRiskLevel === 'Critical'
        ? 'bg-red-100 text-red-700'
        : 'bg-amber-100 text-amber-700'
    }`}>
      <AlertTriangle size={11} aria-hidden="true" />
      <span>{row.healthRiskLabel}</span>
    </span>
  )
}

type DashboardRow = {
  id: string
  schoolName: string
  email: string | null
  primaryContactName: string
  state: string
  clientType: string
  onboardingCoordinator: string
  completedSteps: number
  totalSteps: number
  progressPercent: number
  outstandingSteps: number
  isComplete: boolean
  lastActivity: string
  pendingReviewCount: number
  delayedSubmissionCount: number
  hasAlert: boolean
  alertLabel: string
  services: string
  statusFilter: 'Complete' | 'Delayed' | 'Pending Review' | 'In Progress'
  onboardingStartDate: string
  daysUntilStart: number | null
  healthRiskLevel: 'Critical' | 'At Risk' | 'On Track' | 'Complete'
  healthRiskLabel: string
}

type DashboardDrilldown = 'pending-review' | 'in-progress' | 'complete' | 'health-risk'

type DashboardTaskState = {
  asanaTaskId: string
  schoolName: string
  taskName: string
  dueDate: string | null
  completed: boolean
  source: string
  syncedAt: Date
}

type DashboardNudgeSetting = {
  schoolName: string
  scheduledNudgesEnabled: boolean
}

const seededClientProfiles = [
  {
    id: 'hubspot-demo-heritage-summit',
    schoolName: demoSchoolName,
    state: demoSchoolState,
    services: demoSchoolServices,
    clientType: demoSchoolClientType,
    primaryContactName: 'Jack Bauer',
    primaryContactEmail: 'jack.bauer@heritagesummit.example',
    onboardingCoordinator: demoOnboardingCoordinator,
    onboardingStartDate: '2026-07-01',
    hubspotCompanyId: 'hs-company-1001',
    hubspotDealId: 'hs-deal-5001',
    lifecycleStage: 'Onboarding',
  },
  {
    id: 'hubspot-demo-canyon-ridge',
    schoolName: 'Canyon Ridge Preparatory',
    state: 'Nevada',
    services: 'SFO (Accounting, AP, Payroll)',
    clientType: 'New',
    primaryContactName: 'Maya Patel',
    primaryContactEmail: 'maya.patel@canyonridge.example',
    onboardingCoordinator: 'Eugene B. (AP/Payroll Lead)',
    onboardingStartDate: '2026-07-08',
    hubspotCompanyId: 'hs-company-1002',
    hubspotDealId: 'hs-deal-5002',
    lifecycleStage: 'Onboarding',
  },
  {
    id: 'hubspot-demo-riverbend',
    schoolName: 'Riverbend STEM Academy',
    state: 'Texas',
    services: 'SFO (Accounting, Payroll)',
    clientType: 'Existing',
    primaryContactName: 'Noah Kim',
    primaryContactEmail: 'noah.kim@riverbendstem.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-07-15',
    hubspotCompanyId: 'hs-company-1003',
    hubspotDealId: 'hs-deal-5003',
    lifecycleStage: 'Implementation',
  },
  {
    id: 'hubspot-demo-summit-valley',
    schoolName: 'Summit Valley Charter',
    state: 'Colorado',
    services: 'SFO (AP, Payroll, Grants)',
    clientType: 'Existing New',
    primaryContactName: 'Elena Garcia',
    primaryContactEmail: 'elena.garcia@summitvalley.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-07-22',
    hubspotCompanyId: 'hs-company-1004',
    hubspotDealId: 'hs-deal-5004',
    lifecycleStage: 'Contract Signed',
  },
  {
    id: 'hubspot-demo-desert-mesa',
    schoolName: 'Desert Mesa Learning Center',
    state: 'New Mexico',
    services: 'SFO (Accounting, AP)',
    clientType: 'Existing',
    primaryContactName: 'Owen Brooks',
    primaryContactEmail: 'owen.brooks@desertmesa.example',
    onboardingCoordinator: 'Marisol R. (Accounting Lead)',
    onboardingStartDate: '2026-08-01',
    hubspotCompanyId: 'hs-company-1005',
    hubspotDealId: 'hs-deal-5005',
    lifecycleStage: 'Onboarding',
  },
  {
    id: 'hubspot-demo-lakeside',
    schoolName: 'Lakeside Classical School',
    state: 'Tennessee',
    services: 'SFO (Accounting, AP, Payroll, Grants)',
    clientType: 'New',
    primaryContactName: 'Priya Shah',
    primaryContactEmail: 'priya.shah@lakesideclassical.example',
    onboardingCoordinator: 'Tara L. (Grants Lead)',
    onboardingStartDate: '2026-08-05',
    hubspotCompanyId: 'hs-company-1006',
    hubspotDealId: 'hs-deal-5006',
    lifecycleStage: 'Onboarding',
  },
]

// Server function to retrieve all dashboard data
export const getDashboardData = createServerFn({ method: 'GET' })
  .handler(async () => {
    const { db } = await import('#/db')
    const { clientProfiles, invitations, schoolNudgeSettings, submissions, schoolAsanaProjects, schoolOnboardingProgress, schoolOnboardingTaskStates } = await import('#/db/schema')
    const now = new Date()

    const session = await requireStaffSession()

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

    for (const profile of seededClientProfiles) {
      await db.insert(clientProfiles).values({
        ...profile,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({
        target: clientProfiles.schoolName,
      })
    }

    // 1. Fetch invitations to list client details
    const inviteRows = await db.select().from(invitations).all()
    const invites = inviteRows.map(({ token: _token, ...invite }) => invite)
    
    // 2. Fetch HubSpot-style client profile records
    const clients = await db.select().from(clientProfiles).all()

    // 3. Fetch submissions
    const allSubmissions = await db.select().from(submissions).orderBy(desc(submissions.uploadedAt)).all()
    const progress = await db.select().from(schoolOnboardingProgress).all()
    const taskStates = await db.select().from(schoolOnboardingTaskStates).orderBy(desc(schoolOnboardingTaskStates.syncedAt)).all()
    const projects = await db.select().from(schoolAsanaProjects).all()
    const nudgeSettings = await db.select().from(schoolNudgeSettings).all()

    return {
      clients,
      invites,
      submissions: allSubmissions,
      progress,
      taskStates,
      projects,
      nudgeSettings,
    }
  })

export const updateSchoolScheduledNudges = createServerFn({ method: 'POST' })
  .validator((data: {
    schoolName: string
    enabled: boolean
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { schoolNudgeSettings } = await import('#/db/schema')

    await assertTrustedOrigin()
    const session = await requireStaffSession()
    const now = new Date()

    await db
      .insert(schoolNudgeSettings)
      .values({
        schoolName: data.schoolName,
        scheduledNudgesEnabled: data.enabled,
        updatedByUserId: session.user.id,
        updatedByEmail: session.user.email,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolNudgeSettings.schoolName,
        set: {
          scheduledNudgesEnabled: data.enabled,
          updatedByUserId: session.user.id,
          updatedByEmail: session.user.email,
          updatedAt: now,
        },
      })
      .run()

    const { recordAuditEvent } = await import('#/lib/audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'vertex',
      category: 'notification',
      action: data.enabled ? 'scheduled_nudges_enabled' : 'scheduled_nudges_disabled',
      message: `${session.user.email} ${data.enabled ? 'enabled' : 'disabled'} scheduled nudges for ${data.schoolName}.`,
      entityType: 'school_nudge_settings',
      schoolName: data.schoolName,
      metadata: {
        scheduledNudgesEnabled: data.enabled,
      },
    })

    return { success: true }
  })

// Server function to update client profile
export const updateClientProfile = createServerFn({ method: 'POST' })
  .validator((data: {
    email: string
    state: string
    services: string
    schoolName: string
    clientType: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { clientProfiles, invitations } = await import('#/db/schema')

    await assertTrustedOrigin()
    const session = await requireStaffSession()

    await db.update(invitations)
      .set({
        state: data.state,
        services: data.services,
        schoolName: data.schoolName,
        clientType: data.clientType,
      })
      .where(eq(invitations.email, data.email))
      .run()
    await db.update(clientProfiles)
      .set({
        state: data.state,
        services: data.services,
        schoolName: data.schoolName,
        clientType: data.clientType,
        updatedAt: new Date(),
      })
      .where(eq(clientProfiles.primaryContactEmail, data.email))
      .run()

    const { recordAuditEvent } = await import('#/lib/audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'vertex',
      category: 'profile',
      action: 'client_profile_updated',
      message: `${session.user.email} updated the client profile for ${data.schoolName}.`,
      entityType: 'client_profile',
      schoolName: data.schoolName,
      clientEmail: data.email,
      metadata: {
        state: data.state,
        services: data.services,
        clientType: data.clientType,
      },
    })
    return { success: true }
  })

export const Route = createFileRoute('/vertex-dashboard')({
  component: VertexDashboardPage,
})

function VertexDashboardPage() {
  const queryClient = useQueryClient()
  const { data: session, isPending: authPending } = authClient.useSession()
  
  const [selectedSchool, setSelectedSchool] = useState<string | null>(null)
  const [isEditingProfile, setIsEditingProfile] = useState<string | null>(null) // Holds email of profile being edited
  const [editState, setEditState] = useState('')
  const [editServices, setEditServices] = useState('')
  const [editSchoolName, setEditSchoolName] = useState('')
  const [editClientType, setEditClientType] = useState('New')
  const [dashboardAlert, setDashboardAlert] = useState<{
    type: 'success' | 'error' | 'warning'
    title: string
    message: string
  } | null>(null)
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [activeDrilldown, setActiveDrilldown] = useState<DashboardDrilldown | null>(null)
  const [successfulNudgeKeys, setSuccessfulNudgeKeys] = useState<Set<string>>(() => new Set())
  const [taskActivityPage, setTaskActivityPage] = useState(1)
  const userRole = session?.user ? (session.user as any).role : null
  const isAuthorized = userRole === 'vertex_user' || userRole === 'admin'

  // Query dashboard data
  const { data: dashData = emptyDashboardData, isLoading: dashboardLoading } = useQuery({
    queryKey: ['dashboard-data'],
    queryFn: () => getDashboardData(),
    enabled: isAuthorized,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const isDashboardLoading = dashboardLoading

  const formatActivityDate = useCallback((date: Date) =>
    new Date(date).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), [])
  const formatTaskDueDate = useCallback((dateValue: string | null | undefined) => {
    if (!dateValue) return 'No due date'
    const date = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(date.getTime())) return 'No due date'
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
  }, [])

  const getSchoolId = useCallback((schoolName: string) =>
    schoolName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''), [])

  const getDaysUntilStart = useCallback((dateValue: string | null | undefined) => {
    if (!dateValue) return null
    const startDate = new Date(`${dateValue}T00:00:00`)
    if (Number.isNaN(startDate.getTime())) return null

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  }, [])

  const formatHealthRiskLabel = useCallback((daysUntilStart: number | null, isComplete: boolean) => {
    if (isComplete) return 'Complete'
    if (daysUntilStart === null) return 'No start date'
    if (daysUntilStart < 0) return `${Math.abs(daysUntilStart)}d overdue`
    if (daysUntilStart === 0) return 'Due today'
    return `${daysUntilStart}d to start`
  }, [])

  const getClientTypeBadgeClass = useCallback((clientType: string) => {
    if (clientType === 'Existing') return 'bg-emerald-100 text-emerald-700'
    if (clientType === 'Existing New') return 'bg-amber-100 text-amber-700'
    return 'bg-blue-100 text-blue-700'
  }, [])

  const schoolNames = useMemo(() => Array.from(new Set([
    ...dashData.submissions.map(submission => submission.schoolName),
    ...dashData.progress
      .filter(progress => progress.source !== 'fallback')
      .map(progress => progress.schoolName),
    ...dashData.taskStates
      .filter(task => task.source !== 'fallback')
      .map(task => task.schoolName),
    ...dashData.projects
      .filter(project => Boolean(project.asanaProjectGid))
      .map(project => project.schoolName),
  ])).sort((a, b) => a.localeCompare(b)), [dashData.submissions, dashData.progress, dashData.taskStates, dashData.projects])

  const progressBySchool = useMemo(
    () => new Map(dashData.progress.map(progress => [progress.schoolName, progress])),
    [dashData.progress],
  )
  const nudgeSettingsBySchool = useMemo(() => {
    const settingsBySchool = new Map<string, DashboardNudgeSetting>()
    for (const setting of dashData.nudgeSettings) {
      settingsBySchool.set(setting.schoolName, setting)
    }
    return settingsBySchool
  }, [dashData.nudgeSettings])
  const taskStatesBySchool = useMemo(() => {
    const tasksBySchool = new Map<string, DashboardTaskState[]>()
    for (const task of dashData.taskStates) {
      const tasks = tasksBySchool.get(task.schoolName) ?? []
      tasks.push(task)
      tasksBySchool.set(task.schoolName, tasks)
    }
    return tasksBySchool
  }, [dashData.taskStates])

  const dashboardRows: DashboardRow[] = useMemo(() => schoolNames.map((schoolName) => {
    const isHeritage = schoolName === demoSchoolName
    const client = dashData.clients.find(item => item.schoolName === schoolName)
    const invite = dashData.invites.find(item => item.schoolName === schoolName)
      ?? dashData.invites.find(item => client?.primaryContactEmail && item.email === client.primaryContactEmail)
    const schoolSubmissions = dashData.submissions.filter(submission => submission.schoolName === schoolName)
    const latestSub = schoolSubmissions[0]
    const pendingReviewCount = schoolSubmissions.filter(submission => submission.status === 'Pending').length
    const delayedSubmissionCount = schoolSubmissions.filter(submission => {
      if (submission.status !== 'Pending') return false
      const hrs = (Date.now() - new Date(submission.uploadedAt).getTime()) / (1000 * 60 * 60)
      return hrs > 48
    }).length
    const submittedTaskCount = new Set(schoolSubmissions.map(submission => submission.asanaTaskId)).size
    const progressSnapshot = progressBySchool.get(schoolName)
    const rowTotalSteps = progressSnapshot
      ? progressSnapshot.totalTaskCount + profileStepCount
      : client
        ? fallbackTaskCount + profileStepCount
        : submittedTaskCount
    const rowCompletedSteps = progressSnapshot
      ? progressSnapshot.completedTaskCount + profileStepCount
      : client
        ? Math.min(submittedTaskCount + profileStepCount, rowTotalSteps)
        : submittedTaskCount
    const outstandingSteps = Math.max(rowTotalSteps - rowCompletedSteps, 0)
    const progressPercent = rowTotalSteps > 0 ? Math.min((rowCompletedSteps / rowTotalSteps) * 100, 100) : 0
    const isComplete = rowTotalSteps > 0 && rowCompletedSteps >= rowTotalSteps
    const onboardingStartDate = client?.onboardingStartDate || (isHeritage ? '2026-07-01' : '')
    const daysUntilStart = getDaysUntilStart(onboardingStartDate)
    const healthRiskLevel = isComplete
      ? 'Complete'
      : daysUntilStart !== null && daysUntilStart <= 7
        ? 'Critical'
        : daysUntilStart !== null && daysUntilStart <= healthRiskWindowDays
          ? 'At Risk'
          : 'On Track'
    const statusFilter = isComplete
      ? 'Complete'
      : delayedSubmissionCount > 0
        ? 'Delayed'
        : pendingReviewCount > 0
          ? 'Pending Review'
          : 'In Progress'

    return {
      id: getSchoolId(schoolName),
      schoolName,
      email: client?.primaryContactEmail ?? invite?.email ?? null,
      primaryContactName: client?.primaryContactName ?? 'Client contact',
      state: client?.state || invite?.state || (isHeritage ? demoSchoolState : '-'),
      clientType: formatClientType(client?.clientType || invite?.clientType) || (isHeritage ? demoSchoolClientType : invite?.accepted ? 'Active' : 'New'),
      onboardingCoordinator: client?.onboardingCoordinator || (isHeritage ? demoOnboardingCoordinator : 'Vertex onboarding team'),
      completedSteps: rowCompletedSteps,
      totalSteps: rowTotalSteps,
      progressPercent,
      outstandingSteps,
      isComplete,
      lastActivity: latestSub ? formatActivityDate(latestSub.uploadedAt) : 'No activity yet',
      pendingReviewCount,
      delayedSubmissionCount,
      services: client?.services || invite?.services || (isHeritage ? demoSchoolServices : 'SFO'),
      statusFilter,
      onboardingStartDate,
      daysUntilStart,
      healthRiskLevel,
      healthRiskLabel: formatHealthRiskLabel(daysUntilStart, isComplete),
      hasAlert: delayedSubmissionCount > 0 || healthRiskLevel === 'Critical' || healthRiskLevel === 'At Risk',
      alertLabel: delayedSubmissionCount > 0
        ? `Delayed (${delayedSubmissionCount})`
        : healthRiskLevel === 'Critical' || healthRiskLevel === 'At Risk'
          ? `${healthRiskLevel}: ${formatHealthRiskLabel(daysUntilStart, isComplete)}`
          : pendingReviewCount > 0
            ? `${pendingReviewCount} Pending Review`
            : 'None',
    }
  }), [
    schoolNames,
    dashData.clients,
    dashData.invites,
    dashData.submissions,
    progressBySchool,
    formatActivityDate,
    getSchoolId,
    formatClientType,
    getDaysUntilStart,
    formatHealthRiskLabel,
  ])

  const clientOptions = useMemo(
    () => dashboardRows.map(row => row.schoolName).sort((a, b) => a.localeCompare(b)),
    [dashboardRows],
  )
  const stateOptions = useMemo(
    () => Array.from(new Set(dashboardRows.map(row => row.state))).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [dashboardRows],
  )
  const clientTypeOptions = useMemo(
    () => Array.from(new Set(dashboardRows.map(row => row.clientType))).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [dashboardRows],
  )
  const ownerOptions = useMemo(
    () => Array.from(new Set(dashboardRows.map(row => row.onboardingCoordinator))).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    [dashboardRows],
  )
  const uploadCountBySchool = useMemo(() => {
    const counts = new Map<string, number>()
    for (const submission of dashData.submissions) {
      counts.set(submission.schoolName, (counts.get(submission.schoolName) ?? 0) + 1)
    }
    return counts
  }, [dashData.submissions])
  const pendingReviewItemCount = useMemo(
    () => dashData.submissions.filter(submission => submission.status === 'Pending').length,
    [dashData.submissions],
  )
  const pendingReviewClientCount = useMemo(
    () => dashboardRows.filter(row => row.pendingReviewCount > 0).length,
    [dashboardRows],
  )
  const inProgressClientCount = useMemo(
    () => dashboardRows.filter(row => !row.isComplete).length,
    [dashboardRows],
  )
  const completedClientCount = useMemo(
    () => dashboardRows.filter(row => row.isComplete).length,
    [dashboardRows],
  )
  const healthRiskRows = useMemo(
    () => dashboardRows.filter(row => row.healthRiskLevel === 'Critical' || row.healthRiskLevel === 'At Risk' || row.delayedSubmissionCount > 0),
    [dashboardRows],
  )
  const filteredDashboardRows = useMemo(() => {
    if (activeDrilldown === 'pending-review') return dashboardRows.filter(row => row.pendingReviewCount > 0)
    if (activeDrilldown === 'in-progress') return dashboardRows.filter(row => !row.isComplete)
    if (activeDrilldown === 'complete') return dashboardRows.filter(row => row.isComplete)
    if (activeDrilldown === 'health-risk') return healthRiskRows
    return dashboardRows
  }, [activeDrilldown, dashboardRows, healthRiskRows])

  const dashboardColumns = useMemo<ColumnDef<DashboardRow>[]>(() => [
    {
      accessorKey: 'schoolName',
      header: 'Client',
      filterFn: 'equalsString',
    },
    {
      accessorKey: 'state',
      header: 'State',
      filterFn: 'equalsString',
    },
    {
      accessorKey: 'clientType',
      header: 'Client Type',
      filterFn: 'equalsString',
    },
    {
      accessorKey: 'onboardingCoordinator',
      header: 'Vertex Owner',
      filterFn: 'equalsString',
    },
    {
      accessorKey: 'statusFilter',
      header: 'Status',
      filterFn: 'equalsString',
    },
  ], [])

  const table = useReactTable({
    data: filteredDashboardRows,
    columns: dashboardColumns,
    state: {
      columnFilters,
      globalFilter,
    },
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const search = String(filterValue).trim().toLowerCase()
      if (!search) return true

      const value = [
        row.original.schoolName,
        row.original.primaryContactName,
        row.original.state,
        row.original.clientType,
        row.original.onboardingCoordinator,
        row.original.services,
        row.original.statusFilter,
        row.original.healthRiskLevel,
        row.original.healthRiskLabel,
      ].join(' ').toLowerCase()

      return value.includes(search)
    },
  })

  const tableRows = table.getRowModel().rows
  const selectedDashboardRow = dashboardRows.find(row => row.id === selectedSchool)
  const selectedSchoolSubmissions = useMemo(
    () => selectedDashboardRow
      ? dashData.submissions.filter(submission => submission.schoolName === selectedDashboardRow.schoolName)
      : [],
    [dashData.submissions, selectedDashboardRow],
  )
  const selectedSchoolTasks = useMemo(() => {
    if (!selectedDashboardRow) return []

    const submittedTaskIds = new Set(selectedSchoolSubmissions.map(submission => submission.asanaTaskId))
    const cachedTasks = taskStatesBySchool.get(selectedDashboardRow.schoolName) ?? []
    const tasksById = new Map<string, {
      id: string
      name: string
      dueDate: string | null
      completed: boolean
      source: string
      syncedAt: Date | null
      hasSubmission: boolean
      clientStepNumber: number
    }>()

    for (const task of cachedTasks) {
      tasksById.set(task.asanaTaskId, {
        id: task.asanaTaskId,
        name: task.taskName,
        dueDate: task.dueDate || null,
        completed: task.completed || submittedTaskIds.has(task.asanaTaskId),
        source: task.source,
        syncedAt: task.syncedAt,
        hasSubmission: submittedTaskIds.has(task.asanaTaskId),
        clientStepNumber: 0,
      })
    }

    for (const submission of selectedSchoolSubmissions) {
      const existing = tasksById.get(submission.asanaTaskId)
      if (existing) {
        existing.completed = true
        existing.hasSubmission = true
        continue
      }

      tasksById.set(submission.asanaTaskId, {
        id: submission.asanaTaskId,
        name: submission.asanaTaskName,
        dueDate: null,
        completed: true,
        source: 'submission',
        syncedAt: submission.uploadedAt,
        hasSubmission: true,
        clientStepNumber: 0,
      })
    }

    const clientOrderedTasks = Array.from(tasksById.values()).sort((a, b) => {
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate)
      if (a.dueDate) return -1
      if (b.dueDate) return 1
      return a.name.localeCompare(b.name)
    })

    clientOrderedTasks.forEach((task, index) => {
      task.clientStepNumber = index + profileStepCount + 1
    })

    return clientOrderedTasks.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return a.clientStepNumber - b.clientStepNumber
    })
  }, [selectedDashboardRow, selectedSchoolSubmissions, taskStatesBySchool])
  const taskActivityTotalPages = Math.max(Math.ceil(selectedSchoolTasks.length / taskActivityPageSize), 1)
  const visibleSelectedSchoolTasks = useMemo(() => {
    const start = (taskActivityPage - 1) * taskActivityPageSize
    return selectedSchoolTasks.slice(start, start + taskActivityPageSize)
  }, [selectedSchoolTasks, taskActivityPage])
  const hasActiveFilters = Boolean(globalFilter) || columnFilters.length > 0 || Boolean(activeDrilldown)
  const activeFilterCount = (globalFilter.trim() ? 1 : 0) + columnFilters.length + (activeDrilldown ? 1 : 0)

  const setDashboardDrilldown = (drilldown: DashboardDrilldown) => {
    setActiveDrilldown(current => current === drilldown ? null : drilldown)
    setGlobalFilter('')
    table.resetColumnFilters()
  }

  useEffect(() => {
    if (!selectedDashboardRow) return

    const originalOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedSchool(null)
    }

    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = originalOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [selectedDashboardRow])

  useEffect(() => {
    setTaskActivityPage(1)
  }, [selectedSchool])

  useEffect(() => {
    setTaskActivityPage((page) => Math.min(page, taskActivityTotalPages))
  }, [taskActivityTotalPages])

  const setColumnFilter = (columnId: string, value: string) => {
    table.getColumn(columnId)?.setFilterValue(value || undefined)
  }

  const getNudgeKey = (schoolName: string, taskName: string) => `${schoolName}::${taskName}`

  // Mutation to mark a submission as reviewed
  const reviewMutation = useMutation({
    mutationFn: (subId: string) => reviewSubmission({ data: subId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
    }
  })

  // Mutation to send nudge email
  const nudgeMutation = useMutation({
    mutationFn: (data: { schoolName: string; taskName: string; submissionId?: string }) => 
      sendNudgeEmail({ data }),
    onSuccess: (res, variables) => {
      if (res.emailSent) {
        setSuccessfulNudgeKeys((current) => {
          const next = new Set(current)
          next.add(getNudgeKey(variables.schoolName, variables.taskName))
          return next
        })
        setDashboardAlert({
          type: 'success',
          title: 'Nudge sent',
          message: 'The client nudge email was sent successfully.',
        })
      } else {
        setDashboardAlert({
          type: 'warning',
          title: 'Nudge recorded',
          message: `Email delivery was not available: ${res.emailError}`,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
    },
    onError: (err: any) => {
      setDashboardAlert({
        type: 'warning',
        title: 'Nudge failed',
        message: err?.message || 'Unable to send this nudge.',
      })
    },
  })

  const scheduledNudgesMutation = useMutation({
    mutationFn: (data: { schoolName: string; enabled: boolean }) =>
      updateSchoolScheduledNudges({ data }),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
      setDashboardAlert({
        type: 'success',
        title: variables.enabled ? 'Scheduled nudges enabled' : 'Scheduled nudges disabled',
        message: `7-day due-date nudges are now ${variables.enabled ? 'enabled' : 'disabled'} for ${variables.schoolName}.`,
      })
    },
    onError: (err: any) => {
      setDashboardAlert({
        type: 'error',
        title: 'Scheduled nudge setting failed',
        message: err?.message || 'Unable to update scheduled nudge settings.',
      })
    },
  })

  // Mutation to edit client profile
  const profileMutation = useMutation({
    mutationFn: (data: { email: string; state: string; services: string; schoolName: string; clientType: string }) => 
      updateClientProfile({ data }),
    onSuccess: () => {
      setIsEditingProfile(null)
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
      setDashboardAlert({
        type: 'success',
        title: 'Profile updated',
        message: 'The client contract profile was updated successfully.',
      })
    }
  })

  const seedProgressMutation = useMutation({
    mutationFn: () => seedOnboardingProgressCache(),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-data'] })
      setDashboardAlert({
        type: result.failedCount > 0 ? 'warning' : 'success',
        title: result.failedCount > 0 ? 'Progress sync partially completed' : 'Progress sync completed',
        message: result.failedCount > 0
          ? `Synced ${result.syncedCount} schools. ${result.failedCount} schools could not be synced from Asana.`
          : `Synced current Asana progress for ${result.syncedCount} schools.`,
      })
    },
    onError: (err: any) => {
      setDashboardAlert({
        type: 'error',
        title: 'Progress sync failed',
        message: err?.message || 'Unable to seed current Asana progress into D1.',
      })
    },
  })

  if (authPending) {
    return (
      <main className="page-wrap page-center-state">
        <div>
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[var(--vertex-blue)] border-r-transparent align-[-0.125em]" />
          <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">Authorizing dashboard access...</p>
        </div>
      </main>
    )
  }

  if (!isAuthorized) {
    return (
      <main className="page-wrap page-shell">
        <div className="page-stack page-stack-standard">
          <BrandedAlert variant="warning" title="Staff access required">
            <span>
              The onboarding dashboard is available to Vertex staff and admins.{' '}
              {session?.user ? (
                <Link to="/school-onboarding" className="font-bold underline text-[var(--vertex-blue)]">
                  Go to your onboarding workspace
                </Link>
              ) : (
                <Link to="/login" className="font-bold underline text-[var(--vertex-blue)]">
                  Sign in
                </Link>
              )}
            </span>
          </BrandedAlert>
        </div>
      </main>
    )
  }

  return (
    <main className="page-wrap page-shell">
      {dashboardAlert && (
        <BrandedAlert
          variant={dashboardAlert.type}
          title={dashboardAlert.title}
          className="mb-6"
        >
          {dashboardAlert.message}
        </BrandedAlert>
      )}

      <div className="page-heading">
        <div>
          <div className="page-kicker">
            Vertex Internal Operations
          </div>
          <h1 className="page-title">
            Onboarding Dashboard
          </h1>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-[var(--vertex-gold)]">
            Asana Progress Cache
          </div>
          <p className="mt-1 text-sm font-medium text-[var(--sea-ink-soft)]">
            Seed current Asana task completion counts into D1 for fast dashboard progress metrics.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => seedProgressMutation.mutate()}
          disabled={seedProgressMutation.isPending}
          className="inline-flex shrink-0 items-center gap-2"
        >
          <RefreshCw size={16} className={seedProgressMutation.isPending ? 'animate-spin' : ''} aria-hidden="true" />
          {seedProgressMutation.isPending ? 'Syncing Asana...' : 'Sync Asana Progress'}
        </Button>
      </div>

      <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DashboardMetricCard
          label="Pending Review"
          value={pendingReviewItemCount}
          detail={`${pendingReviewClientCount} ${pendingReviewClientCount === 1 ? 'client has' : 'clients have'} uploaded items awaiting review`}
          icon={<ClipboardCheck size={20} />}
          active={activeDrilldown === 'pending-review'}
          variant="warning"
          onClick={() => setDashboardDrilldown('pending-review')}
        />
        <DashboardMetricCard
          label="Clients In Progress"
          value={inProgressClientCount}
          detail="Onboarding not yet fully complete"
          icon={<Clock3 size={20} />}
          active={activeDrilldown === 'in-progress'}
          onClick={() => setDashboardDrilldown('in-progress')}
        />
        <DashboardMetricCard
          label="Clients Completed"
          value={completedClientCount}
          detail="All tracked onboarding steps complete"
          icon={<CheckCircle2 size={20} />}
          active={activeDrilldown === 'complete'}
          variant="success"
          onClick={() => setDashboardDrilldown('complete')}
        />
        <DashboardMetricCard
          label="Health Risk"
          value={healthRiskRows.length}
          detail={`Incomplete clients within ${healthRiskWindowDays} days of start or delayed review`}
          icon={<AlertTriangle size={20} />}
          active={activeDrilldown === 'health-risk'}
          variant="danger"
          onClick={() => setDashboardDrilldown('health-risk')}
        />
      </section>

      <div className="app-card mb-4 rounded-xl p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left md:hidden"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="dashboard-filters"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal size={18} className="text-[var(--vertex-blue)]" aria-hidden="true" />
            <span className="font-display text-sm font-black uppercase tracking-[0.08em] text-[var(--vertex-blue)]">
              Filters
            </span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-[color-mix(in_oklab,var(--vertex-blue)_10%,white)] px-2 py-0.5 text-xs font-extrabold text-[var(--vertex-blue)]">
                {activeFilterCount}
              </span>
            )}
          </span>
          <ChevronDown
            size={18}
            className={`shrink-0 text-[var(--sea-ink-soft)] transition-transform ${filtersOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        <div
          id="dashboard-filters"
          className={`${filtersOpen ? 'mt-4 grid' : 'hidden'} gap-3 md:mt-0 md:grid md:grid-cols-[1.4fr_repeat(5,minmax(130px,1fr))_auto] md:items-end`}
        >
          <div>
            <Label htmlFor="dashboard-client-search" className="mb-1">Search</Label>
            <Input
              id="dashboard-client-search"
              value={globalFilter}
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder="Client, contact, owner, service..."
            />
          </div>

          <div>
            <Label htmlFor="dashboard-client-filter" className="mb-1">Client</Label>
            <Select
              id="dashboard-client-filter"
              value={(table.getColumn('schoolName')?.getFilterValue() as string | undefined) ?? ''}
              onChange={(event) => setColumnFilter('schoolName', event.target.value)}
            >
              <option value="">All clients</option>
              {clientOptions.map(client => (
                <option key={client} value={client}>{client}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="dashboard-state-filter" className="mb-1">State</Label>
            <Select
              id="dashboard-state-filter"
              value={(table.getColumn('state')?.getFilterValue() as string | undefined) ?? ''}
              onChange={(event) => setColumnFilter('state', event.target.value)}
            >
              <option value="">All states</option>
              {stateOptions.map(state => (
                <option key={state} value={state}>{state}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="dashboard-type-filter" className="mb-1">Type</Label>
            <Select
              id="dashboard-type-filter"
              value={(table.getColumn('clientType')?.getFilterValue() as string | undefined) ?? ''}
              onChange={(event) => setColumnFilter('clientType', event.target.value)}
            >
              <option value="">All types</option>
              {clientTypeOptions.map(clientType => (
                <option key={clientType} value={clientType}>{clientType}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="dashboard-status-filter" className="mb-1">Status</Label>
            <Select
              id="dashboard-status-filter"
              value={(table.getColumn('statusFilter')?.getFilterValue() as string | undefined) ?? ''}
              onChange={(event) => setColumnFilter('statusFilter', event.target.value)}
            >
              <option value="">All statuses</option>
              {['Complete', 'In Progress', 'Pending Review', 'Delayed'].map(status => (
                <option key={status} value={status}>{status}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="dashboard-owner-filter" className="mb-1">Owner</Label>
            <Select
              id="dashboard-owner-filter"
              value={(table.getColumn('onboardingCoordinator')?.getFilterValue() as string | undefined) ?? ''}
              onChange={(event) => setColumnFilter('onboardingCoordinator', event.target.value)}
            >
              <option value="">All owners</option>
              {ownerOptions.map(owner => (
                <option key={owner} value={owner}>{owner}</option>
              ))}
            </Select>
          </div>

          <Button
            variant="outline"
            disabled={!hasActiveFilters}
            onClick={() => {
              setGlobalFilter('')
              setActiveDrilldown(null)
              table.resetColumnFilters()
            }}
          >
            Reset
          </Button>
        </div>
        <div className="mt-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
          {isDashboardLoading
            ? 'Loading client records...'
            : `Showing ${tableRows.length} of ${filteredDashboardRows.length} clients${activeDrilldown ? ` in ${activeDrilldown.replace('-', ' ')}` : ''}`}
        </div>
      </div>

      {/* Overview */}
      <div className="app-card overflow-hidden rounded-2xl">
        <div className="space-y-3 p-4 lg:hidden">
          {isDashboardLoading ? (
            <DashboardMobileSkeleton />
          ) : tableRows.length === 0 ? (
            <p className="rounded-xl border border-[var(--chip-line)] bg-white p-4 text-center text-xs font-semibold text-neutral-500">
              No client records found yet.
            </p>
          ) : tableRows.map((tableRow) => {
            const row = tableRow.original
            const hasUploads = (uploadCountBySchool.get(row.schoolName) ?? 0) > 0
            const hasTaskStates = (taskStatesBySchool.get(row.schoolName)?.length ?? 0) > 0
            const hasTaskActivity = hasUploads || hasTaskStates
            const scheduledNudgesEnabled = nudgeSettingsBySchool.get(row.schoolName)?.scheduledNudgesEnabled ?? true
            return (
            <div key={row.id} className="rounded-xl border border-[var(--chip-line)] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-base font-bold text-[var(--vertex-blue)]">
                      {row.schoolName}
                    </h2>
                    <HealthRiskBadge row={row} />
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-[var(--sea-ink-soft)]">
                    <span>{row.state}</span>
                    <span>-</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${getClientTypeBadgeClass(row.clientType)}`}>
                      {row.clientType}
                    </span>
                    <span>-</span>
                    <span>{row.onboardingCoordinator}</span>
                  </div>
                </div>
                <span className={`shrink-0 rounded px-2 py-1 text-[9px] font-extrabold uppercase tracking-wide ${row.hasAlert ? 'bg-red-100 text-red-700' : row.pendingReviewCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-[var(--foam)] text-neutral-500'}`}>
                  {row.alertLabel === 'None' ? 'No alerts' : row.alertLabel}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div className="col-span-2 rounded-lg bg-[var(--foam)] p-3">
                  <span className="block font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                    Progress
                  </span>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[var(--sea-ink)]">{row.completedSteps}/{row.totalSteps}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
                        <div
                          className="h-full bg-[var(--vertex-blue)]"
                          style={{ width: `${row.progressPercent}%` }}
                        />
                      </div>
                    </div>
                    {row.isComplete && (
                      <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-green-700">
                        Complete
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-lg bg-[var(--foam)] p-3">
                  <span className="block font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                    Outstanding
                  </span>
                  <span className="mt-2 block font-bold text-[var(--sea-ink)]">
                    {row.outstandingSteps} Steps
                  </span>
                </div>
                <div className="rounded-lg bg-[var(--foam)] p-3">
                  <span className="block font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                    Health
                  </span>
                  <span className={`mt-2 block font-bold ${row.healthRiskLevel === 'Critical' ? 'text-red-700' : row.healthRiskLevel === 'At Risk' ? 'text-amber-700' : row.healthRiskLevel === 'Complete' ? 'text-emerald-700' : 'text-[var(--sea-ink)]'}`}>
                    {row.healthRiskLabel}
                  </span>
                </div>
                <div className="col-span-2 rounded-lg bg-[var(--foam)] p-3">
                  <span className="block font-bold uppercase tracking-wider text-[var(--vertex-gray)]">
                    Last activity
                  </span>
                  <span className="mt-1 block font-semibold text-[var(--sea-ink)]">{row.lastActivity}</span>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-[var(--chip-line)] bg-white px-3 py-2 text-xs font-bold text-[var(--sea-ink)] sm:col-span-2">
                  <span>7-day nudges</span>
                  <input
                    type="checkbox"
                    checked={scheduledNudgesEnabled}
                    disabled={scheduledNudgesMutation.isPending}
                    onChange={(event) => scheduledNudgesMutation.mutate({
                      schoolName: row.schoolName,
                      enabled: event.currentTarget.checked,
                    })}
                    className="h-4 w-4 accent-[var(--vertex-blue)]"
                  />
                </label>
                {row.email && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (isEditingProfile === row.email) {
                        setIsEditingProfile(null)
                      } else {
                        setIsEditingProfile(row.email)
                        setEditSchoolName(row.schoolName)
                        setEditState(row.state === '-' ? '' : row.state)
                        setEditServices(row.services)
                        setEditClientType(row.clientType)
                      }
                    }}
                  >
                    Edit Profile
                  </Button>
                )}
                <Button
                  disabled={!hasTaskActivity}
                  title={hasTaskActivity ? `View task activity for ${row.schoolName}` : 'No task activity available for this client yet'}
                  onClick={() => setSelectedSchool(row.id)}
                >
                  View Task Activity
                </Button>
              </div>

              {row.email && isEditingProfile === row.email && (
                <div className="mt-4 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-4">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gold)]">
                    Correct Client Profile Data
                  </h4>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <Label className="mb-1">
                        School Name
                      </Label>
                      <Input
                        value={editSchoolName}
                        onChange={(e) => setEditSchoolName(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="mb-1">
                        State
                      </Label>
                      <Input
                        value={editState}
                        onChange={(e) => setEditState(e.target.value)}
                      />
                    </div>
                    <div>
                      <Label className="mb-1">
                        Client Type
                      </Label>
                      <Select
                        value={editClientType}
                        onChange={(event) => setEditClientType(event.target.value)}
                      >
                        {CLIENT_TYPES.map((clientType) => (
                          <option key={clientType} value={clientType}>{clientType}</option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Button
                      onClick={() => {
                        profileMutation.mutate({
                          email: row.email ?? '',
                          schoolName: editSchoolName,
                          state: editState,
                          services: editServices,
                          clientType: editClientType,
                        })
                      }}
                    >
                      Save Corrections
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsEditingProfile(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
            )
          })}
        </div>

        <div className="hidden lg:block">
          <Table className="w-full table-fixed text-left border-collapse text-xs">
            <TableHeader>
              {table.getHeaderGroups().map(headerGroup => (
                <TableRow key={headerGroup.id} className="bg-[var(--foam)] border-b border-[var(--line)] text-[var(--vertex-gray)] uppercase tracking-wider font-bold">
                  <TableHead className="whitespace-nowrap p-4" colSpan={5}>
                    {flexRender(headerGroup.headers[0].column.columnDef.header, headerGroup.headers[0].getContext())}
                  </TableHead>
                  <TableHead className="whitespace-nowrap p-4 text-right" colSpan={4}>
                    Actions
                  </TableHead>
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="text-[var(--sea-ink)] font-semibold">
              {isDashboardLoading ? (
                <DashboardTableSkeleton />
              ) : tableRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="p-8 text-center text-xs font-semibold text-neutral-500">
                    No client records found yet.
                  </TableCell>
                </TableRow>
              ) : tableRows.map((tableRow) => {
                const row = tableRow.original
                const hasUploads = (uploadCountBySchool.get(row.schoolName) ?? 0) > 0
                const hasTaskStates = (taskStatesBySchool.get(row.schoolName)?.length ?? 0) > 0
                const hasTaskActivity = hasUploads || hasTaskStates
                const scheduledNudgesEnabled = nudgeSettingsBySchool.get(row.schoolName)?.scheduledNudgesEnabled ?? true
                return (
                <Fragment key={row.id}>
                  <TableRow className="border-t border-[var(--line)] transition hover:bg-neutral-50/50">
                    <TableCell colSpan={5} className="p-4 pb-2">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-[var(--vertex-blue)]">
                            {row.schoolName}
                          </span>
                          <HealthRiskBadge row={row} />
                        </div>
                        <div className="mt-1 text-[11px] font-semibold text-[var(--sea-ink-soft)]">
                          Primary contact: {row.primaryContactName}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell colSpan={4} className="p-4 pb-2">
                      <div className="flex flex-wrap justify-end gap-2">
                      <label className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--chip-line)] bg-white px-3 text-xs font-bold text-[var(--sea-ink)]">
                        <span>7-day nudges</span>
                        <input
                          type="checkbox"
                          checked={scheduledNudgesEnabled}
                          disabled={scheduledNudgesMutation.isPending}
                          onChange={(event) => scheduledNudgesMutation.mutate({
                            schoolName: row.schoolName,
                            enabled: event.currentTarget.checked,
                          })}
                          className="h-4 w-4 accent-[var(--vertex-blue)]"
                        />
                      </label>
                      {row.email && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (isEditingProfile === row.email) {
                              setIsEditingProfile(null)
                            } else {
                              setIsEditingProfile(row.email)
                              setEditSchoolName(row.schoolName)
                              setEditState(row.state === '-' ? '' : row.state)
                              setEditServices(row.services)
                              setEditClientType(row.clientType)
                            }
                          }}
                        >
                          Edit Profile
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={!hasTaskActivity}
                        title={hasTaskActivity ? `View task activity for ${row.schoolName}` : 'No task activity available for this client yet'}
                        onClick={() => setSelectedSchool(row.id)}
                      >
                        View Task Activity
                      </Button>
                      </div>
                    </TableCell>
                  </TableRow>

                  <TableRow className="transition hover:bg-neutral-50/50">
                    <TableCell className="p-4 pt-2 align-top">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">State</span>
                      {row.state}
                    </TableCell>
                    <TableCell className="p-4 pt-2 align-top">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Client Type</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] ${getClientTypeBadgeClass(row.clientType)}`}>{row.clientType}</span>
                    </TableCell>
                    <TableCell colSpan={2} className="p-4 pt-2 align-top">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Vertex Owner</span>
                      {row.onboardingCoordinator}
                    </TableCell>
                    <TableCell className="p-4 pt-2 align-top">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Progress</span>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="w-8">{row.completedSteps}/{row.totalSteps}</span>
                          <div className="w-16 bg-neutral-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-[var(--vertex-blue)] h-full"
                              style={{ width: `${row.progressPercent}%` }}
                            />
                          </div>
                        </div>
                        {row.isComplete && (
                          <span className="inline-block rounded bg-green-100 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-green-700">
                            Complete
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="p-4 pt-2 align-top text-neutral-500">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Outstanding</span>
                      {row.outstandingSteps} Steps
                    </TableCell>
                    <TableCell className="p-4 pt-2 align-top text-neutral-500">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Last Activity</span>
                      {row.lastActivity}
                    </TableCell>
                    <TableCell colSpan={2} className="p-4 pt-2 align-top text-center">
                      <span className="mb-1 block text-[9px] font-extrabold uppercase tracking-wider text-[var(--vertex-gray)]">Alerts</span>
                      {row.hasAlert ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-red-100 text-red-700 font-extrabold uppercase text-[9px] tracking-wide animate-pulse">
                          {row.alertLabel}
                        </span>
                      ) : row.pendingReviewCount > 0 ? (
                        <span className="inline-block px-2 py-0.5 rounded bg-amber-100 text-amber-700 font-extrabold uppercase text-[9px] tracking-wide">
                          {row.alertLabel}
                        </span>
                      ) : (
                        <span className="text-neutral-400 font-medium">None</span>
                      )}
                    </TableCell>
                  </TableRow>

                  {row.email && isEditingProfile === row.email && (
                    <TableRow>
                      <TableCell colSpan={9} className="p-4 bg-[var(--foam)] border-b border-[var(--line)]">
                        <div className="max-w-md space-y-4">
                          <h4 className="font-bold text-xs uppercase tracking-wider text-[var(--vertex-gold)]">
                            Correct Client Profile Data
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label className="mb-1">
                                School Name
                              </Label>
                              <Input
                                value={editSchoolName}
                                onChange={(e) => setEditSchoolName(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="mb-1">
                                State
                              </Label>
                              <Input
                                value={editState}
                                onChange={(e) => setEditState(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label className="mb-1">
                                Client Type
                              </Label>
                              <Select
                                value={editClientType}
                                onChange={(event) => setEditClientType(event.target.value)}
                              >
                                {CLIENT_TYPES.map((clientType) => (
                                  <option key={clientType} value={clientType}>{clientType}</option>
                                ))}
                              </Select>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              onClick={() => {
                                profileMutation.mutate({
                                  email: row.email ?? '',
                                  schoolName: editSchoolName,
                                  state: editState,
                                  services: editServices,
                                  clientType: editClientType,
                                })
                              }}
                            >
                              Save Profile Corrections
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => setIsEditingProfile(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
                )
              })}
            </TableBody>
          </Table>
      </div>
      </div>

      {/* Task activity modal */}
      {selectedDashboardRow && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="task-activity-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSchool(null)
          }}
        >
          <section className="w-full max-w-6xl rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-[var(--line)] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                  Task Activity
                </p>
                <h2 id="task-activity-modal-title" className="mt-1 text-xl font-bold text-[var(--vertex-blue)]">
                  {selectedDashboardRow.schoolName}
                </h2>
                <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Uploaded documents, review status, and onboarding tasks
                </p>
              </div>
              <Button variant="outline" onClick={() => setSelectedSchool(null)}>
                Close
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-5 p-4 sm:p-6 lg:grid-cols-2 lg:gap-8">
          {/* Submissions List */}
          <div className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:p-5">
            <h3 className="font-bold text-sm uppercase tracking-wider text-[var(--vertex-gold)]">
              Submitted Documents
            </h3>

            {selectedSchoolSubmissions.length === 0 ? (
              <p className="text-center text-xs text-neutral-500 py-8 italic">
                No files uploaded by this client yet.
              </p>
            ) : (
              <div className="divide-y divide-[var(--line)]">
                {selectedSchoolSubmissions.map((sub) => (
                  <div key={sub.id} className="py-4 space-y-2 text-xs">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <span className="block break-words font-bold text-sm text-[var(--vertex-blue)]">{sub.asanaTaskName}</span>
                        <span className="block text-neutral-500 mt-0.5">
                          File: <span className="font-mono text-neutral-700">{sub.fileName}</span> ({(sub.fileSize / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      <span className={`shrink-0 whitespace-nowrap px-2.5 py-1 rounded-full font-bold uppercase text-[9px] tracking-wide ${sub.status === 'Reviewed' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'}`}>
                        {sub.status}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 border-t border-neutral-100 pt-2 text-[10px] text-neutral-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                      <span>Submitted by {sub.uploadedByName} on {new Date(sub.uploadedAt).toLocaleString()}</span>
                      
                      <div className="grid gap-2 sm:flex sm:items-center">
                        {/* Download link (Read-only check) */}
                        <a
                          href={`/api/view-document?submissionId=${encodeURIComponent(sub.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-[var(--chip-line)] bg-white px-2 py-1 text-center font-semibold text-neutral-700 no-underline hover:bg-neutral-50"
                        >
                          View Doc
                        </a>

                        {isAuthorized && sub.status === 'Pending' && (
                          <Button
                            size="sm"
                            onClick={() => reviewMutation.mutate(sub.id)}
                            disabled={reviewMutation.isPending}
                          >
                            Mark Reviewed
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Checklist Sync Status */}
          <div className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:p-5">
            <h3 className="font-bold text-sm uppercase tracking-wider text-[var(--vertex-gold)]">
              Onboarding Step Status
            </h3>
            <p className="text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">
              Client Step 1 is profile confirmation. Asana tasks below keep the client-facing step numbers and completed tasks move to the bottom.
            </p>

            {selectedSchoolTasks.length > 0 ? (
              <div className="divide-y divide-[var(--line)]">
                {visibleSelectedSchoolTasks.map((task) => {
                  const isUrgent = /check|501c3|payroll/i.test(task.name)
                  const nudgeSuccessful = successfulNudgeKeys.has(getNudgeKey(selectedDashboardRow.schoolName, task.name))
                  return (
                  <div key={task.id} className="flex flex-col gap-3 py-3 text-xs sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {task.completed ? (
                        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-green-100 text-green-700 font-bold">
                          ✓
                        </span>
                      ) : (
                        <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-neutral-300 text-neutral-400 font-bold">
                          {task.clientStepNumber}
                        </span>
                      )}
                      <div className="min-w-0">
                        <span className="block break-words font-bold text-[var(--sea-ink)]">{task.name}</span>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="inline-block px-2 py-0.5 text-[8px] bg-[var(--foam)] text-[var(--vertex-gray)] rounded font-bold uppercase">
                            Step {task.clientStepNumber}
                          </span>
                          <span className={`inline-block px-2 py-0.5 text-[8px] rounded font-bold uppercase ${
                            task.dueDate
                              ? 'bg-blue-50 text-[var(--vertex-blue)]'
                              : 'bg-neutral-100 text-neutral-400'
                          }`}>
                            Due {formatTaskDueDate(task.dueDate)}
                          </span>
                          {isUrgent && (
                            <span className="inline-block px-2 py-0.5 text-[8px] bg-red-100 text-red-600 rounded font-bold uppercase">
                              Payroll (Urgent)
                            </span>
                          )}
                          <span className="inline-block px-2 py-0.5 text-[8px] bg-[var(--foam)] text-[var(--vertex-gray)] rounded font-bold uppercase">
                            {task.hasSubmission ? 'Client upload' : task.source}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:flex-none sm:justify-end">
                      <span className={`whitespace-nowrap font-semibold ${task.completed ? 'text-green-700' : 'text-amber-700'}`}>
                        {task.completed ? 'Completed' : 'Outstanding'}
                      </span>

                      {/* Nudge Client button if incomplete */}
                      {!task.completed && isAuthorized && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={nudgeSuccessful || nudgeMutation.isPending}
                          onClick={() => {
                            nudgeMutation.mutate({
                              schoolName: selectedDashboardRow.schoolName,
                              taskName: task.name
                            })
                          }}
                        >
                          {nudgeSuccessful ? 'Successful' : nudgeMutation.isPending ? 'Sending...' : 'Send Nudge'}
                        </Button>
                      )}
                    </div>
                  </div>
                  )
                })}
                {taskActivityTotalPages > 1 && (
                  <div className="flex flex-col gap-3 pt-4 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <span className="font-semibold text-[var(--sea-ink-soft)]">
                      Showing {(taskActivityPage - 1) * taskActivityPageSize + 1}-{Math.min(taskActivityPage * taskActivityPageSize, selectedSchoolTasks.length)} of {selectedSchoolTasks.length} tasks
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={taskActivityPage === 1}
                        onClick={() => setTaskActivityPage((page) => Math.max(page - 1, 1))}
                      >
                        Previous
                      </Button>
                      <span className="font-bold text-[var(--sea-ink)]">
                        {taskActivityPage}/{taskActivityTotalPages}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={taskActivityPage === taskActivityTotalPages}
                        onClick={() => setTaskActivityPage((page) => Math.min(page + 1, taskActivityTotalPages))}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-xs text-neutral-500 py-8 italic">
                Task status has not been synced from Asana for this client yet. Use Sync Asana Progress, then reopen this panel.
              </p>
            )}
          </div>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
