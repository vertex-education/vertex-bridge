import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'
import { assertCanAccessSchool, assertTrustedOrigin, getServerRequest, requireSession, requireStaffSession } from './security'
import { clientTypesMatch, getAllowedTaskClientTypes, normalizeClientType } from './client-types'
import { classifyTaskFileRequirements, deterministicTaskFileRequirement, type TaskFileRequirement } from './ai'

export type OnboardingTask = {
  id: string
  name: string
  notes: string
  dueDate: string | null
  completed: boolean
  isUrgent: boolean
  functionalArea: string
  requiresFileUpload: boolean
  fileRequirementReason: string
}

function normalizeText(value: string | null | undefined) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isAppliedToFieldName(value: string | null | undefined) {
  const fieldName = normalizeText(value)
  return fieldName.includes('appliesto')
    || fieldName.includes('appliedto')
}

function getAsanaFieldValues(field: any) {
  const values = [
    field?.enum_value?.name,
    field?.display_value,
    field?.text_value,
    field?.number_value,
  ]

  if (Array.isArray(field?.multi_enum_values)) {
    values.push(...field.multi_enum_values.map((value: any) => value?.name))
  }

  return values
    .filter((value): value is string | number => value !== null && value !== undefined && String(value).trim().length > 0)
    .map(String)
}

type AsanaAppliesToField = {
  gid: string
  optionGidsByClientType: Record<string, Set<string>>
  source: 'project_settings' | 'task_fields'
  name?: string
}

function getAsanaAppliedToValues(task: any, appliesToFieldGid: string) {
  const customFields = Array.isArray(task.custom_fields) ? task.custom_fields : []
  const values: string[] = []

  for (const field of customFields) {
    if (String(field?.gid || '') !== appliesToFieldGid) continue
    values.push(...getAsanaFieldValues(field))
  }

  return values
}

function getAsanaAppliedToSelectedOptionGids(task: any, appliesToFieldGid: string) {
  const customFields = Array.isArray(task.custom_fields) ? task.custom_fields : []
  const optionGids: string[] = []

  for (const field of customFields) {
    if (String(field?.gid || '') !== appliesToFieldGid) continue
    if (field?.enum_value?.gid) optionGids.push(String(field.enum_value.gid))
    if (Array.isArray(field?.multi_enum_values)) {
      optionGids.push(...field.multi_enum_values.map((value: any) => value?.gid).filter(Boolean).map(String))
    }
  }

  return optionGids
}

function hasAsanaAppliedToField(task: any, appliesToFieldGid: string) {
  const customFields = Array.isArray(task.custom_fields) ? task.custom_fields : []
  return customFields.some((field: any) => String(field?.gid || '') === appliesToFieldGid)
}

function taskAppliedToMatchesClientStatus(task: any, clientStatus: string, appliesToField: AsanaAppliesToField) {
  const clientType = normalizeClientType(clientStatus)
  const selectedOptionGids = getAsanaAppliedToSelectedOptionGids(task, appliesToField.gid)
  const expectedOptionGids = clientType ? appliesToField.optionGidsByClientType[clientType] : null

  if (selectedOptionGids.length > 0 && expectedOptionGids) {
    return selectedOptionGids.some((gid) => expectedOptionGids.has(gid))
  }

  const appliedToValues = getAsanaAppliedToValues(task, appliesToField.gid)

  return appliedToValues.some((value) =>
    normalizeClientType(value)
      ? clientTypesMatch(clientStatus, value)
      : clientTypesMatch(clientStatus, deterministicStatusCandidate(value)),
  )
}

function deterministicStatusCandidate(value: string) {
  const normalized = normalizeText(value)
  if (normalized.includes('existing') && normalized.includes('new')) return 'Existing New'
  if (normalized.includes('existing')) return 'Existing'
  if (normalized.includes('new')) return 'New'
  return value
}

async function hashTaskClassificationInput(task: {
  name: string
  notes: string
  functionalArea: string
}) {
  const input = JSON.stringify({
    name: task.name,
    notes: task.notes,
    functionalArea: task.functionalArea,
  })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function applyTaskFileRequirementsFromCache(db: any, taskFileRequirements: any, tasks: Array<{
  id: string
  name: string
  notes: string
  functionalArea: string
}>) {
  const deterministicById = new Map(tasks.map((task) => [task.id, deterministicTaskFileRequirement(task)]))
  const hashesById = new Map<string, string>()
  await Promise.all(tasks.map(async (task) => {
    hashesById.set(task.id, await hashTaskClassificationInput(task))
  }))

  const clearRequirements: TaskFileRequirement[] = []
  const ambiguousTasks: typeof tasks = []
  for (const task of tasks) {
    const requirement = deterministicById.get(task.id)!
    if (requirement.ambiguous) {
      ambiguousTasks.push(task)
    } else {
      clearRequirements.push(requirement)
    }
  }

  if (ambiguousTasks.length === 0) {
    return clearRequirements
  }

  const cachedRows = await db.select().from(taskFileRequirements).all()
  const cachedByTaskId = new Map(cachedRows.map((row: any) => [row.asanaTaskId, row]))
  const cachedRequirements: TaskFileRequirement[] = []
  const uncachedTasks: typeof tasks = []

  for (const task of ambiguousTasks) {
    const cached = cachedByTaskId.get(task.id)
    if (cached && cached.taskNotesHash === hashesById.get(task.id)) {
      cachedRequirements.push({
        id: task.id,
        requiresFileUpload: Boolean(cached.requiresFileUpload),
        reason: cached.reason,
        classifier: 'cache',
        ambiguous: false,
      })
    } else {
      uncachedTasks.push(task)
    }
  }

  const gemmaRequirements = await classifyTaskFileRequirements(uncachedTasks)
  const cacheableGemmaRequirements = gemmaRequirements.filter((requirement) => requirement.classifier === 'gemma')
  if (cacheableGemmaRequirements.length > 0) {
    const now = new Date()
    await Promise.all(cacheableGemmaRequirements.map((requirement) => {
      const task = uncachedTasks.find((candidate) => candidate.id === requirement.id)
      if (!task) return Promise.resolve()

      return db
        .insert(taskFileRequirements)
        .values({
          asanaTaskId: task.id,
          taskName: task.name,
          taskNotesHash: hashesById.get(task.id) || '',
          requiresFileUpload: requirement.requiresFileUpload,
          reason: requirement.reason,
          classifier: requirement.classifier || 'gemma',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: taskFileRequirements.asanaTaskId,
          set: {
            taskName: task.name,
            taskNotesHash: hashesById.get(task.id) || '',
            requiresFileUpload: requirement.requiresFileUpload,
            reason: requirement.reason,
            classifier: requirement.classifier || 'gemma',
            updatedAt: now,
          },
        })
        .run()
    }))
  }

  return [
    ...clearRequirements,
    ...cachedRequirements,
    ...gemmaRequirements,
  ]
}

async function storeSchoolOnboardingProgress(db: any, schoolOnboardingProgress: any, data: {
  schoolName: string
  completedTaskCount: number
  totalTaskCount: number
  asanaProjectGid: string | null
  source: string
}) {
  const now = new Date()
  await db
    .insert(schoolOnboardingProgress)
    .values({
      schoolName: data.schoolName,
      completedTaskCount: data.completedTaskCount,
      totalTaskCount: data.totalTaskCount,
      asanaProjectGid: data.asanaProjectGid,
      source: data.source,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schoolOnboardingProgress.schoolName,
      set: {
        completedTaskCount: data.completedTaskCount,
        totalTaskCount: data.totalTaskCount,
        asanaProjectGid: data.asanaProjectGid,
        source: data.source,
        syncedAt: now,
        updatedAt: now,
      },
    })
    .run()
}

async function storeSchoolOnboardingTaskStates(db: any, schoolOnboardingTaskStates: any, data: {
  schoolName: string
  source: string
  tasks: Array<{
    id: string
    name: string
    dueDate?: string | null
    completed: boolean
  }>
}) {
  const now = new Date()
  await Promise.all(data.tasks.map((task) =>
    db
      .insert(schoolOnboardingTaskStates)
      .values({
        asanaTaskId: task.id,
        schoolName: data.schoolName,
        taskName: task.name,
        dueDate: task.dueDate || null,
        completed: task.completed,
        source: data.source,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolOnboardingTaskStates.asanaTaskId,
        set: {
          schoolName: data.schoolName,
          taskName: task.name,
          dueDate: task.dueDate || null,
          completed: task.completed,
          source: data.source,
          syncedAt: now,
          updatedAt: now,
        },
      })
      .run(),
  ))
}

async function recomputeSchoolOnboardingProgressFromTaskStates(db: any, schema: {
  schoolOnboardingProgress: any
  schoolOnboardingTaskStates: any
}, data: {
  schoolName: string
  asanaProjectGid: string | null
  source: string
}) {
  const rows = await db
    .select()
    .from(schema.schoolOnboardingTaskStates)
    .where(eq(schema.schoolOnboardingTaskStates.schoolName, data.schoolName))
    .all()
  const existingProgressRows = data.asanaProjectGid
    ? []
    : await db
        .select()
        .from(schema.schoolOnboardingProgress)
        .where(eq(schema.schoolOnboardingProgress.schoolName, data.schoolName))
        .limit(1)
        .all()
  const existingProgress = existingProgressRows[0] || null

  await storeSchoolOnboardingProgress(db, schema.schoolOnboardingProgress, {
    schoolName: data.schoolName,
    completedTaskCount: rows.filter((row: any) => row.completed).length,
    totalTaskCount: rows.length,
    asanaProjectGid: data.asanaProjectGid || existingProgress?.asanaProjectGid || null,
    source: data.source,
  })
}

async function markCachedOnboardingTaskComplete(data: {
  schoolName: string
  taskId: string
  taskName: string
  source: string
}) {
  const { db } = await import('#/db')
  const { schoolOnboardingProgress, schoolOnboardingTaskStates } = await import('#/db/schema')
  const now = new Date()

  await db
    .insert(schoolOnboardingTaskStates)
    .values({
      asanaTaskId: data.taskId,
      schoolName: data.schoolName,
      taskName: data.taskName,
      dueDate: null,
      completed: true,
      source: data.source,
      syncedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schoolOnboardingTaskStates.asanaTaskId,
      set: {
        schoolName: data.schoolName,
        taskName: data.taskName,
        dueDate: null,
        completed: true,
        source: data.source,
        syncedAt: now,
        updatedAt: now,
      },
    })
    .run()

  await recomputeSchoolOnboardingProgressFromTaskStates(db, {
    schoolOnboardingProgress,
    schoolOnboardingTaskStates,
  }, {
    schoolName: data.schoolName,
    asanaProjectGid: null,
    source: data.source,
  })
}

async function getAsanaProjectCustomFieldSettings(token: string, projectGid: string) {
  const data = await asanaRequest(
    token,
    `/projects/${projectGid}/custom_field_settings?opt_fields=${encodeURIComponent([
      'custom_field.gid',
      'custom_field.name',
      'custom_field.enum_options.gid',
      'custom_field.enum_options.name',
      'custom_field.enum_options.enabled',
    ].join(','))}`,
  )

  return Array.isArray(data.data) ? data.data : []
}

async function resolveAsanaAppliesToField(token: string, projectGid: string): Promise<AsanaAppliesToField | null> {
  let settings: any[] = []
  try {
    settings = await getAsanaProjectCustomFieldSettings(token, projectGid)
  } catch {
    return null
  }
  const setting = settings.find((item: any) => isAppliedToFieldName(item?.custom_field?.name))
  const customField = setting?.custom_field

  if (!customField?.gid) return null

  const optionGidsByClientType: Record<string, Set<string>> = {}
  for (const option of customField.enum_options || []) {
    if (option?.enabled === false) continue

    const clientType = normalizeClientType(option?.name)
    if (!clientType || !option?.gid) continue

    optionGidsByClientType[clientType] ??= new Set<string>()
    optionGidsByClientType[clientType].add(String(option.gid))
  }

  return {
    gid: String(customField.gid),
    optionGidsByClientType,
    source: 'project_settings',
    name: customField.name || undefined,
  }
}

function inferAsanaAppliesToFieldFromTasks(tasks: any[]): AsanaAppliesToField | null {
  for (const task of tasks) {
    const customFields = Array.isArray(task?.custom_fields) ? task.custom_fields : []
    const field = customFields.find((customField: any) => isAppliedToFieldName(customField?.name))

    if (!field?.gid) continue

    return {
      gid: String(field.gid),
      optionGidsByClientType: {},
      source: 'task_fields',
      name: field.name || undefined,
    }
  }

  return null
}

async function fetchAsanaProjectTasks(token: string, projectGid: string, optFields: string) {
  const tasks: any[] = []
  let offset = ''

  do {
    const searchParams = new URLSearchParams({
      opt_fields: optFields,
      limit: '100',
    })
    if (offset) searchParams.set('offset', offset)

    const response = await fetch(`https://app.asana.com/api/1.0/projects/${projectGid}/tasks?${searchParams.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      throw new Error(`Asana API error: ${response.statusText}`)
    }

    const page = await response.json() as any
    if (Array.isArray(page.data)) tasks.push(...page.data)
    offset = page.next_page?.offset || ''
  } while (offset)

  return tasks
}

async function fetchAsanaTaskDetails(token: string, tasks: any[], optFields: string) {
  const detailedTasks: any[] = []
  const concurrency = 8

  for (let index = 0; index < tasks.length; index += concurrency) {
    const batch = tasks.slice(index, index + concurrency)
    const details = await Promise.all(batch.map(async (task) => {
      const response = await fetch(`https://app.asana.com/api/1.0/tasks/${task.gid}?opt_fields=${encodeURIComponent(optFields)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        throw new Error(`Asana task detail error: ${response.statusText}`)
      }

      const detail = await response.json() as any
      return detail.data || task
    }))
    detailedTasks.push(...details)
  }

  return detailedTasks
}

// Fallback static tasks from context/recommended-sfo-tasks.md
export const FALLBACK_TASKS: OnboardingTask[] = [
  {
    id: 'mock-task-1',
    name: 'Upload 501c3 letter or EIN documentation',
    notes: 'If no 501c3 letter is available, EIN/business-name documentation may be used for the demo.',
    dueDate: '2026-07-01',
    completed: false,
    isUrgent: true,
    functionalArea: 'URGENT (Payroll)',
    requiresFileUpload: true,
    fileRequirementReason: 'The task asks for 501c3 or EIN documentation.',
  },
  {
    id: 'mock-task-2',
    name: 'Upload voided checks for all bank accounts',
    notes: 'If no check stock is available, a bank letter with routing and account numbers may be referenced in task instructions.',
    dueDate: '2026-07-03',
    completed: false,
    isUrgent: true,
    functionalArea: 'URGENT (Payroll)',
    requiresFileUpload: true,
    fileRequirementReason: 'The task asks for bank account documentation.',
  },
  {
    id: 'mock-task-3',
    name: 'Upload latest payroll register with YTD info',
    notes: 'Please upload the payroll register showing year-to-date earnings and taxes for all employees.',
    dueDate: '2026-07-05',
    completed: false,
    isUrgent: true,
    functionalArea: 'URGENT (Payroll)',
    requiresFileUpload: true,
    fileRequirementReason: 'The task asks for a payroll register file.',
  },
  {
    id: 'mock-task-4',
    name: 'Upload board-approved current year budget in Excel',
    notes: 'Please upload the spreadsheet file containing the current fiscal year budget approved by the school board.',
    dueDate: '2026-07-10',
    completed: false,
    isUrgent: false,
    functionalArea: 'Accounting',
    requiresFileUpload: true,
    fileRequirementReason: 'The task asks for an Excel budget file.',
  },
  {
    id: 'mock-task-5',
    name: 'Upload preliminary deposits/expenses, General Ledger detail, and Trial Balance Report',
    notes: 'Upload your preliminary list of all deposits and expenses to date, general ledger details, and Trial Balance Report. This helps our SFO team set up your accounting system.',
    dueDate: '2026-07-15',
    completed: false,
    isUrgent: false,
    functionalArea: 'Accounting',
    requiresFileUpload: true,
    fileRequirementReason: 'The task asks for accounting report files.',
  }
]

// Helper function to sort tasks by due date
export function sortTasks(tasks: OnboardingTask[]): OnboardingTask[] {
  return [...tasks].sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate)
    }
    if (a.dueDate) return -1
    if (b.dueDate) return 1
    return 0
  })
}

async function getAsanaPat() {
  const { getAsanaBearerToken } = await import('./asana-oauth.server')
  return await getAsanaBearerToken(await getServerRequest())
}

async function getAsanaProjectConfig() {
  const { getAsanaProjectTemplateSettings } = await import('./asana-oauth.server')
  return await getAsanaProjectTemplateSettings()
}

function getProjectName(schoolName: string) {
  return `${schoolName} - SFO Onboarding`
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function asanaRequest(token: string, path: string, init: RequestInit = {}) {
  const requestHeaders = init.headers as Record<string, string> | undefined
  const response = await fetch(`https://app.asana.com/api/1.0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(requestHeaders || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Asana API error ${response.status}: ${text || response.statusText}`)
  }

  return await response.json() as any
}

async function findProjectByName(token: string, projectName: string, workspaceGid: string) {
  const searchPath = workspaceGid
    ? `/workspaces/${workspaceGid}/projects/search?text=${encodeURIComponent(projectName)}&opt_fields=gid,name`
    : `/projects?limit=100&opt_fields=gid,name`
  const data = await asanaRequest(token, searchPath)
  const projects = data.data || []
  const exactMatch = projects.find((project: any) => project.name === projectName)
  return exactMatch?.gid || ''
}

async function checkAsanaJob(token: string, jobGid: string) {
  const data = await asanaRequest(token, `/jobs/${jobGid}?opt_fields=gid,status,new_project.gid,new_project.name`)
  return data.data || null
}

function isMissingAsanaJobsReadScopeError(err: any) {
  return String(err?.message || err).includes('jobs:read')
}

async function getSchoolOnboardingStartDate(schoolName: string) {
  const { db } = await import('#/db')
  const { clientProfiles } = await import('#/db/schema')
  const rows = await db
    .select({ onboardingStartDate: clientProfiles.onboardingStartDate })
    .from(clientProfiles)
    .where(eq(clientProfiles.schoolName, schoolName))
    .limit(1)
    .all()

  return normalizeAsanaDate(rows[0]?.onboardingStartDate) || new Date().toISOString().slice(0, 10)
}

async function getSchoolClientType(schoolName: string) {
  const { db } = await import('#/db')
  const { clientProfiles } = await import('#/db/schema')
  const rows = await db
    .select({ clientType: clientProfiles.clientType })
    .from(clientProfiles)
    .where(eq(clientProfiles.schoolName, schoolName))
    .limit(1)
    .all()

  return rows[0]?.clientType || null
}

function normalizeAsanaDate(value?: string | null) {
  if (!value) return ''
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed

  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

async function getProjectTemplateDateVariables(token: string, templateGid: string) {
  const data = await asanaRequest(
    token,
    `/project_templates/${templateGid}?opt_fields=requested_dates.gid,requested_dates.name`,
    {
      headers: {
        'Content-Type': 'application/json',
      },
    },
  )

  return (data.data?.requested_dates || [])
    .map((dateVariable: any) => ({
      gid: String(dateVariable.gid || '').trim(),
      name: String(dateVariable.name || '').trim(),
    }))
    .filter((dateVariable: { gid: string }) => dateVariable.gid)
}

async function instantiateProjectFromTemplate(token: string, schoolName: string) {
  const config = await getAsanaProjectConfig()
  if (!config.templateGid) {
    throw new Error('ASANA_PROJECT_TEMPLATE_GID is required to create school onboarding projects.')
  }
  if (!config.workspaceGid && !config.teamGid) {
    throw new Error('ASANA_WORKSPACE_GID or ASANA_TEAM_GID is required to create school onboarding projects.')
  }

  const projectName = getProjectName(schoolName)
  const projectData: Record<string, unknown> = {
    name: projectName,
    public: false,
  }

  if (config.teamGid) {
    projectData.team = config.teamGid
  } else {
    projectData.workspace = config.workspaceGid
  }

  const dateVariables = await getProjectTemplateDateVariables(token, config.templateGid)
  if (dateVariables.length > 0) {
    const onboardingStartDate = await getSchoolOnboardingStartDate(schoolName)
    projectData.requested_dates = dateVariables.map((dateVariable) => ({
      gid: dateVariable.gid,
      value: onboardingStartDate,
    }))
  }

  const response = await asanaRequest(token, `/project_templates/${config.templateGid}/instantiateProject`, {
    method: 'POST',
    body: JSON.stringify({ data: projectData }),
  })

  return {
    projectName,
    templateGid: config.templateGid,
    workspaceGid: config.workspaceGid,
    teamGid: config.teamGid,
    jobGid: response.data?.gid || '',
  }
}

async function ensureAsanaProjectForSchool(token: string, schoolName: string) {
  const { db } = await import('#/db')
  const { schoolAsanaProjects } = await import('#/db/schema')
  const { recordAuditEvent } = await import('./audit')
  const session = await requireSession()
  const now = new Date()
  const projectName = getProjectName(schoolName)

  const rows = await db
    .select()
    .from(schoolAsanaProjects)
    .where(eq(schoolAsanaProjects.schoolName, schoolName))
    .limit(1)
    .all()
  const existing = rows[0] || null

  if (existing?.asanaProjectGid && existing.status === 'ready') {
    return existing.asanaProjectGid
  }

  if (existing?.asanaJobGid && existing.status === 'creating') {
    try {
      const job = await checkAsanaJob(token, existing.asanaJobGid)
      if (job?.status === 'succeeded') {
        const projectGid = job.new_project?.gid || await findProjectByName(token, existing.asanaProjectName, existing.asanaWorkspaceGid || '')
        if (projectGid) {
          await db
            .update(schoolAsanaProjects)
            .set({
              asanaProjectGid: projectGid,
              asanaProjectName: job.new_project?.name || existing.asanaProjectName,
              status: 'ready',
              lastError: null,
              updatedAt: now,
            })
            .where(eq(schoolAsanaProjects.schoolName, schoolName))
            .run()
          return projectGid
        }
      }
      if (job?.status === 'failed') {
        await db
          .update(schoolAsanaProjects)
          .set({ status: 'failed', lastError: 'Asana project template job failed.', updatedAt: now })
          .where(eq(schoolAsanaProjects.schoolName, schoolName))
          .run()
      }
    } catch (err: any) {
      await db
        .update(schoolAsanaProjects)
        .set({ lastError: err?.message || String(err), updatedAt: now })
        .where(eq(schoolAsanaProjects.schoolName, schoolName))
        .run()
    }
    return ''
  }

  try {
    const created = await instantiateProjectFromTemplate(token, schoolName)
    await db
      .insert(schoolAsanaProjects)
      .values({
        id: existing?.id || crypto.randomUUID(),
        schoolName,
        asanaProjectGid: null,
        asanaProjectName: created.projectName,
        asanaProjectTemplateGid: created.templateGid,
        asanaWorkspaceGid: created.workspaceGid || null,
        asanaTeamGid: created.teamGid || null,
        asanaJobGid: created.jobGid || null,
        status: created.jobGid ? 'creating' : 'pending',
        lastError: null,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolAsanaProjects.schoolName,
        set: {
          asanaProjectGid: null,
          asanaProjectName: created.projectName,
          asanaProjectTemplateGid: created.templateGid,
          asanaWorkspaceGid: created.workspaceGid || null,
          asanaTeamGid: created.teamGid || null,
          asanaJobGid: created.jobGid || null,
          status: created.jobGid ? 'creating' : 'pending',
          lastError: null,
          updatedAt: now,
        },
      })
      .run()

    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'system',
      category: 'asana',
      action: 'school_asana_project_creation_started',
      message: `Started Asana onboarding project creation for ${schoolName}.`,
      entityType: 'asana_project',
      schoolName,
      metadata: {
        asanaProjectName: created.projectName,
        asanaProjectTemplateGid: created.templateGid,
        asanaWorkspaceGid: created.workspaceGid || null,
        asanaTeamGid: created.teamGid || null,
        asanaJobGid: created.jobGid || null,
      },
    })

    if (created.jobGid) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await sleep(750)
        let job: any
        try {
          job = await checkAsanaJob(token, created.jobGid)
        } catch (err: any) {
          if (isMissingAsanaJobsReadScopeError(err)) {
            await db
              .update(schoolAsanaProjects)
              .set({
                status: 'creating',
                lastError: 'Asana project creation started, but the connection needs jobs:read to confirm completion. Reconnect Asana, then refresh task retrieval.',
                updatedAt: new Date(),
              })
              .where(eq(schoolAsanaProjects.schoolName, schoolName))
              .run()
            return ''
          }
          throw err
        }
        if (job?.status !== 'succeeded') continue

        const projectGid = job.new_project?.gid || await findProjectByName(token, created.projectName, created.workspaceGid)
        if (!projectGid) continue

        await db
          .update(schoolAsanaProjects)
          .set({
            asanaProjectGid: projectGid,
            asanaProjectName: job.new_project?.name || created.projectName,
            status: 'ready',
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(schoolAsanaProjects.schoolName, schoolName))
          .run()

        return projectGid
      }
    }
  } catch (err: any) {
    const error = err?.message || String(err)
    await db
      .insert(schoolAsanaProjects)
      .values({
        id: existing?.id || crypto.randomUUID(),
        schoolName,
        asanaProjectGid: null,
        asanaProjectName: projectName,
        asanaProjectTemplateGid: null,
        asanaWorkspaceGid: null,
        asanaTeamGid: null,
        asanaJobGid: null,
        status: 'failed',
        lastError: error,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schoolAsanaProjects.schoolName,
        set: {
          status: 'failed',
          lastError: error,
          updatedAt: now,
        },
      })
      .run()
    console.error(`Failed to create Asana project for ${schoolName}:`, err)
  }

  return ''
}

export async function provisionAsanaProjectForSchool(schoolName: string) {
  const cleanSchoolName = schoolName.trim()
  if (!cleanSchoolName) {
    throw new Error('School name is required to provision an Asana project.')
  }

  const { db } = await import('#/db')
  const { schoolAsanaProjects } = await import('#/db/schema')
  const asanaPat = await getAsanaPat()

  if (!asanaPat) {
    throw new Error('Connect Asana before provisioning school onboarding projects.')
  }

  const projectGid = await ensureAsanaProjectForSchool(asanaPat, cleanSchoolName)
  const rows = await db
    .select()
    .from(schoolAsanaProjects)
    .where(eq(schoolAsanaProjects.schoolName, cleanSchoolName))
    .limit(1)
    .all()
  const mapping = rows[0] || null

  return {
    projectGid: projectGid || mapping?.asanaProjectGid || null,
    projectName: mapping?.asanaProjectName || getProjectName(cleanSchoolName),
    status: mapping?.status || (projectGid ? 'ready' : 'pending'),
    jobGid: mapping?.asanaJobGid || null,
    lastError: mapping?.lastError || null,
  }
}

// Fetch tasks from Asana or fallback
export const getOnboardingTasks = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { submissions, taskFileRequirements, schoolOnboardingProgress, schoolOnboardingTaskStates } = await import('#/db/schema')
    const session = await requireSession()

    await assertCanAccessSchool(session, schoolName)
    
    const asanaPat = await getAsanaPat()
    
    // Query D1 submissions to check which tasks are completed in the portal
    const dbSubmissions = await db.select().from(submissions).where(eq(submissions.schoolName, schoolName)).all()
    const completedTaskIds = new Set(dbSubmissions.map(s => s.asanaTaskId))

    if (!asanaPat) {
      // Return static tasks with completed status from DB
      const tasks = FALLBACK_TASKS.map(task => ({
        ...task,
        completed: completedTaskIds.has(task.id)
      }))
      await storeSchoolOnboardingTaskStates(db, schoolOnboardingTaskStates, {
        schoolName,
        source: 'fallback',
        tasks,
      })
      await storeSchoolOnboardingProgress(db, schoolOnboardingProgress, {
        schoolName,
        completedTaskCount: tasks.filter(task => task.completed).length,
        totalTaskCount: tasks.length,
        asanaProjectGid: null,
        source: 'fallback',
      })
      return sortTasks(tasks)
    }

    try {
      const projectGid = await ensureAsanaProjectForSchool(asanaPat, schoolName)

      if (!projectGid) {
        // Fall back if project doesn't exist
        const tasks = FALLBACK_TASKS.map(task => ({
          ...task,
          completed: completedTaskIds.has(task.id)
        }))
        await storeSchoolOnboardingTaskStates(db, schoolOnboardingTaskStates, {
          schoolName,
          source: 'fallback',
          tasks,
        })
        await storeSchoolOnboardingProgress(db, schoolOnboardingProgress, {
          schoolName,
          completedTaskCount: tasks.filter(task => task.completed).length,
          totalTaskCount: tasks.length,
          asanaProjectGid: null,
          source: 'fallback',
        })
        return sortTasks(tasks)
      }

      const schoolClientStatus = await getSchoolClientType(schoolName)
      const allowedTaskClientTypes = getAllowedTaskClientTypes(schoolClientStatus)

      // First pass: fetch only lightweight fields needed to filter by Applies to.
      const appliesToOptFields = [
        'gid',
        'name',
        'due_on',
        'completed',
        'custom_fields.gid',
        'custom_fields.name',
        'custom_fields.type',
        'custom_fields.display_value',
        'custom_fields.text_value',
        'custom_fields.enum_value',
        'custom_fields.enum_value.gid',
        'custom_fields.enum_value.name',
        'custom_fields.multi_enum_values',
        'custom_fields.multi_enum_values.gid',
        'custom_fields.multi_enum_values.name',
      ].join(',')
      const detailOptFields = 'gid,name,notes,due_on,completed'
      const basicOptFields = 'gid,name,due_on,completed'

      let asanaTaskSummaries: any[] = []
      let canFilterByClientType = true
      try {
        asanaTaskSummaries = await fetchAsanaProjectTasks(asanaPat, projectGid, appliesToOptFields)
      } catch {
        const basicTasks = await fetchAsanaProjectTasks(asanaPat, projectGid, basicOptFields)
        try {
          asanaTaskSummaries = await fetchAsanaTaskDetails(asanaPat, basicTasks, appliesToOptFields)
        } catch {
          asanaTaskSummaries = basicTasks
          canFilterByClientType = false
        }
      }

      if (asanaTaskSummaries.length === 0) {
        asanaTaskSummaries = await fetchAsanaProjectTasks(asanaPat, projectGid, basicOptFields)
        canFilterByClientType = false
      }
      const appliesToField = allowedTaskClientTypes
        ? await resolveAsanaAppliesToField(asanaPat, projectGid) || inferAsanaAppliesToFieldFromTasks(asanaTaskSummaries)
        : null

      if (allowedTaskClientTypes && !appliesToField) {
        return []
      }
      if (allowedTaskClientTypes && appliesToField && canFilterByClientType && !asanaTaskSummaries.some((task) => hasAsanaAppliedToField(task, appliesToField.gid))) {
        try {
          asanaTaskSummaries = await fetchAsanaTaskDetails(asanaPat, asanaTaskSummaries, appliesToOptFields)
        } catch {
          canFilterByClientType = false
        }
      }
      const filteredTaskSummaries = allowedTaskClientTypes
        ? canFilterByClientType
          ? asanaTaskSummaries.filter((task: any) => {
            return appliesToField ? taskAppliedToMatchesClientStatus(task, schoolClientStatus || '', appliesToField) : false
          })
          : asanaTaskSummaries
        : asanaTaskSummaries
      const filteredTasks = filteredTaskSummaries.length > 0
        ? await fetchAsanaTaskDetails(asanaPat, filteredTaskSummaries, detailOptFields)
        : []
      const baseTasks = filteredTasks.map((t: any) => {
        const nameLower = t.name.toLowerCase()
        const isUrgent = nameLower.includes('check') || nameLower.includes('501c3') || nameLower.includes('payroll')
        return {
          id: t.gid,
          name: t.name,
          notes: t.notes || '',
          dueDate: t.due_on || null,
          completed: t.completed || completedTaskIds.has(t.gid),
          isUrgent,
          functionalArea: isUrgent ? 'URGENT (Payroll)' : 'Accounting'
        }
      })
      const fileRequirements = await applyTaskFileRequirementsFromCache(db, taskFileRequirements, baseTasks.map((task) => ({
        id: task.id,
        name: task.name,
        notes: task.notes,
        functionalArea: task.functionalArea,
      })))
      const fileRequirementsById = new Map(fileRequirements.map((requirement) => [requirement.id, requirement]))
      const rawTasks: OnboardingTask[] = baseTasks.map((task) => {
        const requirement = fileRequirementsById.get(task.id)
        return {
          ...task,
          requiresFileUpload: requirement?.requiresFileUpload ?? true,
          fileRequirementReason: requirement?.reason || 'The task was classified from its name and instructions.',
        }
      })
      await storeSchoolOnboardingTaskStates(db, schoolOnboardingTaskStates, {
        schoolName,
        source: 'asana',
        tasks: rawTasks,
      })
      await storeSchoolOnboardingProgress(db, schoolOnboardingProgress, {
        schoolName,
        completedTaskCount: rawTasks.filter(task => task.completed).length,
        totalTaskCount: rawTasks.length,
        asanaProjectGid: projectGid,
        source: 'asana',
      })

      return sortTasks(rawTasks)
    } catch (err) {
      console.error('Failed to fetch from Asana, using mock fallbacks:', err)
      const tasks = FALLBACK_TASKS.map(task => ({
        ...task,
        completed: completedTaskIds.has(task.id)
      }))
      await storeSchoolOnboardingTaskStates(db, schoolOnboardingTaskStates, {
        schoolName,
        source: 'fallback',
        tasks,
      })
      await storeSchoolOnboardingProgress(db, schoolOnboardingProgress, {
        schoolName,
        completedTaskCount: tasks.filter(task => task.completed).length,
        totalTaskCount: tasks.length,
        asanaProjectGid: null,
        source: 'fallback',
      })
      return sortTasks(tasks)
    }
  })

export const seedOnboardingProgressCache = createServerFn({ method: 'POST' })
  .handler(async () => {
    await assertTrustedOrigin()
    const session = await requireStaffSession()
    const { db } = await import('#/db')
    const { clientProfiles, invitations, schoolAsanaProjects } = await import('#/db/schema')

    const [clientRows, inviteRows, projectRows] = await Promise.all([
      db.select({ schoolName: clientProfiles.schoolName }).from(clientProfiles).all(),
      db.select({ schoolName: invitations.schoolName }).from(invitations).all(),
      db.select({ schoolName: schoolAsanaProjects.schoolName }).from(schoolAsanaProjects).all(),
    ])

    const schoolNames = Array.from(new Set([
      ...clientRows.map((row: any) => row.schoolName),
      ...inviteRows.map((row: any) => row.schoolName),
      ...projectRows.map((row: any) => row.schoolName),
    ].filter((name): name is string => typeof name === 'string' && name.trim().length > 0)))
      .sort((a, b) => a.localeCompare(b))

    const synced: Array<{ schoolName: string; completedTaskCount: number; totalTaskCount: number }> = []
    const failed: Array<{ schoolName: string; error: string }> = []

    for (const schoolName of schoolNames) {
      try {
        const tasks = await getOnboardingTasks({ data: schoolName })
        synced.push({
          schoolName,
          completedTaskCount: tasks.filter((task) => task.completed).length,
          totalTaskCount: tasks.length,
        })
      } catch (err: any) {
        failed.push({
          schoolName,
          error: err?.message || String(err),
        })
      }
    }

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'vertex',
      category: 'asana',
      action: 'onboarding_progress_cache_seeded',
      message: `${session.user.email} seeded onboarding progress cache for ${synced.length} schools.`,
      entityType: 'onboarding_progress_cache',
      metadata: {
        syncedCount: synced.length,
        failedCount: failed.length,
        failed,
      },
    })

    return {
      success: failed.length === 0,
      syncedCount: synced.length,
      failedCount: failed.length,
      synced,
      failed,
    }
  })

async function markAsanaTaskComplete(data: {
  taskId: string
  commentText: string
}) {
    const { getAsanaBearerToken } = await import('./asana-oauth.server')
    const asanaPat = await getAsanaBearerToken(await getServerRequest())

    if (!asanaPat || data.taskId.startsWith('mock-')) {
      return { success: true, mock: true }
    }

    try {
      // 1. Mark task complete
      const compResp = await fetch(`https://app.asana.com/api/1.0/tasks/${data.taskId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${asanaPat}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: { completed: true }
        })
      })

      if (!compResp.ok) {
        throw new Error(`Asana complete error: ${compResp.statusText}`)
      }

      // 2. Add completion story/comment
      const storyResp = await fetch(`https://app.asana.com/api/1.0/tasks/${data.taskId}/stories`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${asanaPat}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          data: { text: data.commentText }
        })
      })

      if (!storyResp.ok) {
        console.error(`Failed to add completion comment to Asana task ${data.taskId}:`, storyResp.statusText)
      }

      return { success: true, mock: false }
    } catch (err: any) {
      console.error('Failed to complete Asana task:', err)
      return {
        success: false,
        error: err?.message || String(err)
      }
    }
  }

export async function completeAsanaTask({ data }: {
  data: {
    taskId: string
    schoolName: string
    contactName: string
    taskName: string
    fileName: string
  }
}) {
    const timestamp = new Date().toLocaleString()
    const commentText = `Completed by ${data.contactName} via client portal on ${timestamp}.\nUploaded file: ${data.fileName}`
    const result = await markAsanaTaskComplete({
      taskId: data.taskId,
      commentText,
    })
    if (result.success) {
      await markCachedOnboardingTaskComplete({
        schoolName: data.schoolName,
        taskId: data.taskId,
        taskName: data.taskName,
        source: result.mock ? 'manual-cache' : 'asana-completion',
      })
    }
    return result
  }

export const completeOnboardingTaskManually = createServerFn({ method: 'POST' })
  .validator((data: {
    taskId: string
    taskName: string
    schoolName: string
  }) => data)
  .handler(async ({ data }) => {
    await assertTrustedOrigin()
    const session = await requireSession()
    await assertCanAccessSchool(session, data.schoolName)

    if (!/^(\d{8,}|mock-task-[1-5])$/.test(data.taskId)) {
      throw new Error('Invalid onboarding task identifier.')
    }

    const contactName = session.user.name || session.user.email || 'Client portal user'
    const timestamp = new Date().toLocaleString()
    const commentText = `Completed by ${contactName} via client portal on ${timestamp}.\nNo file upload was required for this onboarding step.`
    const result = await markAsanaTaskComplete({
      taskId: data.taskId,
      commentText,
    })
    if (result.success) {
      await markCachedOnboardingTaskComplete({
        schoolName: data.schoolName,
        taskId: data.taskId,
        taskName: data.taskName,
        source: result.mock ? 'manual-cache' : 'asana-completion',
      })
    }

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: await getServerRequest(),
      surface: 'client',
      category: 'asana',
      action: result.success ? 'step_completed_manually' : 'step_manual_completion_failed',
      message: result.success
        ? `Onboarding step manually completed for ${data.schoolName}: ${data.taskName}.`
        : `Manual onboarding step completion failed for ${data.schoolName}: ${data.taskName}.`,
      entityType: 'asana_task',
      entityId: data.taskId,
      schoolName: data.schoolName,
      metadata: {
        asanaTaskName: data.taskName,
        asanaUpdated: result.success,
        asanaError: result.error || null,
      },
    })

    return {
      success: result.success,
      asanaUpdated: result.success,
      asanaError: result.error || null,
    }
  })
