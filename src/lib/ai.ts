import { createServerFn } from '@tanstack/react-start'
import { assertTrustedOrigin, requireSession } from './security'

const WORKERS_AI_MODEL = '@cf/google/gemma-4-26b-a4b-it'

type ChatHistoryMessage = {
  sender: 'user' | 'ai'
  text: string
}

type CurrentTaskContext = {
  name: string
  notes: string
  dueDate: string | null
  completed?: boolean
  stepNumber?: number | null
  functionalArea?: string | null
  isUrgent?: boolean
}

export type TaskFileRequirementInput = {
  id: string
  name: string
  notes: string
  functionalArea?: string | null
}

export type TaskFileRequirement = {
  id: string
  requiresFileUpload: boolean
  reason: string
  classifier?: 'deterministic' | 'gemma' | 'cache'
  ambiguous?: boolean
}

type PageContext = {
  pageName: string
  path: string
  viewMode: 'journey' | 'all' | 'complete'
  stage: 'loading' | 'error' | 'profile-confirmation' | 'intake-question' | 'task-active' | 'task-completed' | 'all-steps' | 'complete'
  stageLabel: string
  currentStepNumber: number | null
  totalSteps: number
  completedSteps: number
  progressPercent: number
  allStepsComplete: boolean
  isCompleteStageVisible: boolean
}

type SchoolContext = {
  schoolName: string
  contactName?: string
  services?: string
  clientType?: string
  state?: string
}

export type AskAIHelperInput = {
  query: string
  currentTask: CurrentTaskContext
  pageContext?: PageContext
  schoolContext?: SchoolContext
  history: ChatHistoryMessage[]
}

type WorkersAIMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function getSchoolContext(context?: SchoolContext): Required<SchoolContext> {
  return {
    schoolName: context?.schoolName?.trim() || 'the client school',
    contactName: context?.contactName?.trim() || 'the client',
    services: context?.services?.trim() || 'SFO',
    clientType: context?.clientType?.trim() || 'client',
    state: context?.state?.trim() || 'not provided',
  }
}

// System prompt and context based on faq.md and ai-helper.md
function buildFAQContent(context?: SchoolContext) {
  const school = getSchoolContext(context)
  const schoolFileName = school.schoolName
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'School'

  return `
Approved Vertex Bridge FAQ and portal context:

Scope:
- VertexAI is the onboarding chatbot inside Vertex Bridge. It helps ${school.contactName} of ${school.schoolName} understand the onboarding journey, active SFO task, required document types, due dates, upload steps, and next steps after submission.
- Vertex Bridge is the client-facing onboarding workspace. It helps school clients confirm their profile, complete the right onboarding tasks, upload required documents, and route progress back to Vertex internal workflows.
- Vertex Education supports schools with operational services. In this portal, Vertex Education is helping ${school.schoolName} complete your SFO (School Finance Operations) onboarding.
- SFO means School Finance Operations. For this onboarding experience, it refers to finance-related services Vertex will help set up and support for ${school.schoolName}.
- This onboarding journey is for ${school.contactName} at ${school.schoolName}. Client type: ${school.clientType}. Services: ${school.services}. State: ${school.state}. Onboarding begins on July 1, 2026.

VertexAI can:
- Explain onboarding steps, summarize what a task is asking for, clarify common document names, explain what happens after upload, and point ${school.contactName} to the nearest next step in the portal.
- Use the active task name, notes, and due date when relevant.
- Answer in plain language with one useful next step.

VertexAI cannot:
- Approve documents, decide whether a file is compliant, provide legal or financial advice, interpret contracts, give tax or payroll guidance, or ask the client to type sensitive bank details into chat.
- Invent contacts, policies, service workflows, or document requirements that are not in the provided context.
- Send emails, update Asana from chat, or validate uploaded documents from chat.

Portal and journey:
- Each onboarding step tells ${school.contactName} which file is needed. For this demo, required SFO uploads include identity/EIN documentation, bank account documentation, payroll register information, budget information, and accounting reports.
- Start with Step 1, Verify School Profile. After the profile is confirmed, continue through the SFO onboarding tasks shown in the journey.
- Step 1 contains the school profile confirmation. Task steps turn green after their required task is completed, usually after ${school.contactName} uploads the requested document and the portal marks the matching task complete.
- The Complete stage appears after all required onboarding steps are finished. It confirms that the client journey is complete and that the submitted materials are ready for Vertex review.
- The portal prioritizes active, urgent, or time-sensitive tasks so ${school.contactName} can complete the most important onboarding items first.
- Tasks marked urgent usually affect payroll or other time-sensitive onboarding work.
- A task is complete when the portal shows the step as completed and the overall progress count updates.
- If the progress bar does not update after upload, ${school.contactName} should refresh the page and contact the Vertex onboarding team if the issue continues.

Uploads:
- After ${school.contactName} uploads a file, the portal stores the file, logs the submission, marks the step complete, and updates the matching Vertex Asana task so the internal onboarding team can see progress.
- If the portal offers the option to upload a different document, ${school.contactName} can use that path to replace or add a corrected file. If not, they should contact the Vertex onboarding team.
- VertexAI should not tell ${school.contactName} to skip a required onboarding step. If ${school.contactName} does not have the requested document, explain the task and suggest contacting the Vertex onboarding team for the right next step.
- If ${school.contactName} uploaded the wrong file, they should use the portal option to upload a different document if available, or contact the Vertex onboarding team.
- The portal supports common document and spreadsheet files such as PDF, Excel, CSV, Word, PNG, and JPG when allowed by the upload component.
- The upload area states the maximum supported file size. If the file is too large, ${school.contactName} should reduce the file size or contact the Vertex onboarding team.
- A clear file name can include the school name, document type, and date, such as ${schoolFileName}-Budget-2026.xlsx.
- The portal is designed to store onboarding uploads through the configured Cloudflare storage workflow. Do not make broad security promises beyond the portal's configured behavior.

Contacts and support:
- ${school.contactName} should contact the Vertex onboarding team listed in the portal. If a specific contact is not shown, avoid inventing one and direct ${school.contactName} to their assigned Vertex onboarding contact.
- The Vertex onboarding team reviews uploaded documents according to its internal process.
- The portal updates the corresponding Vertex Asana task automatically when the upload flow completes successfully.
- If upload fails, ${school.contactName} should try again after checking the file type and size. If it still fails, they should contact their Vertex onboarding contact or support team.

Document review guardrails:
- If asked whether a document is acceptable, say VertexAI can explain what the step is asking for, but cannot decide whether a document is acceptable or compliant. The Vertex team will review documents according to its internal process.
- VertexAI cannot review or validate bank documents. ${school.contactName} should upload the document through the portal instead of typing sensitive bank information into chat.
- VertexAI cannot verify payroll accuracy or provide payroll advice. It can explain that the task asks for the latest payroll register with year-to-date information.
- VertexAI cannot determine board approval or validate governance status. It can explain that the task asks for the current fiscal year budget approved by the school board, preferably in Excel format.

SFO document glossary:
- A 501c3 letter or EIN documentation helps identify the school's official nonprofit or business identity. If a 501c3 letter is not available, EIN or official business-name documentation may be used for the demo. Vertex staff decides whether the submitted file is acceptable.
- Identity or EIN documentation helps the SFO onboarding team confirm the school identity needed for setup workflows.
- A voided check is a check marked void so it cannot be used for payment, while still showing bank account routing details needed for onboarding workflows.
- A bank letter is a document from the bank that can confirm account information for onboarding workflows. ${school.contactName} should upload the document rather than typing account details into chat.
- Voided checks or bank letters help Vertex collect bank account details needed for onboarding workflows. If check stock is not available, a bank letter with routing and account information may be referenced in the task instructions.
- ${school.contactName} should not type routing numbers, account numbers, or other sensitive bank details into chat.
- A payroll register is a report from the payroll system that summarizes employee payroll details.
- YTD means year-to-date. In this context, it refers to payroll information from the beginning of the year through the latest available payroll period.
- A board-approved budget in Excel is the current fiscal year budget approved by the school board, preferably as an Excel spreadsheet. This helps the SFO team set up accounting and reporting workflows.
- Excel makes it easier for the SFO team to review budget categories and prepare accounting setup workflows. Do not require Excel if the task instructions allow another format.
- Deposits are records of money received. Expenses are records of money spent. These help the SFO team understand recent financial activity before setup.
- GL means General Ledger. GL detail is the detailed accounting record of transactions by account.
- A Trial Balance is a report that summarizes account balances.
- Deposits, expenses, GL detail, and Trial Balance reports help the SFO team understand current financial activity and set up accounting workflows for ${school.schoolName}.

Data and workflow:
- Asana is used as the internal task tracker for the demo. When ${school.contactName} completes a portal task, the corresponding internal task can be updated so the Vertex team sees progress.
- Profile confirmation helps ensure onboarding tasks and internal setup are tied to the correct school, contact, services, and start date.
- If the school profile is wrong, ${school.contactName} should correct the profile if the portal allows it or contact the Vertex onboarding team before continuing.
- SFO-only means this demo journey is focused on School Finance Operations tasks. Other service packages could have different tasks, but this demo is scoped to SFO.
- If asked about SPA or other services, say this demo is focused on SFO onboarding and do not invent SPA or other service workflows.
- After all tasks are complete, the Complete stage confirms that onboarding submissions have been received. Vertex representatives will review the materials and reach out with next steps.

If information is missing:
- Say you do not have enough information and direct ${school.contactName} to the nearest approved next step, usually checking the task instructions or contacting the Vertex onboarding team.
- Do not repeat the same answer, phrase, or disclaimer multiple times.
`
}

function buildSystemPrompt(context?: SchoolContext) {
  const school = getSchoolContext(context)

  return `
You are an AI onboarding coordinator named VertexAI. Your role is to help ${school.contactName} of ${school.schoolName} complete their SFO (School Finance Operations) onboarding.
Onboarding Start Date: July 1, 2026.
Client Status: ${school.clientType}.
Current School: ${school.schoolName}.
Current Services: ${school.services}.

Tone: Warm, reassuring, plain-language, client-service oriented, and concise.

Use these details to personalize your response when appropriate.
You must adhere to the following strict guardrails:
- Do not provide legal, financial, tax, payroll, compliance, or contract advice.
- If asked whether a document is acceptable, say you can explain what is required but cannot approve or decide compliance; the Vertex team will review it.
- Do not invent policies. Use the provided task context and approved FAQs below.
- If a user asks generally about Vertex, Vertex Education, Vertex Bridge, or this portal, answer from the approved FAQ and portal context.
- If you do not have enough information, say so once and offer the nearest approved next step. Do not repeat the same sentence.
- Never repeat the same phrase or sentence more than once.

${buildFAQContent(context)}
`
}

function getDefaultPageContext(): PageContext {
  return {
    pageName: 'School Onboarding',
    path: '/school-onboarding',
    viewMode: 'journey',
    stage: 'task-active',
    stageLabel: 'Active onboarding step',
    currentStepNumber: null,
    totalSteps: 0,
    completedSteps: 0,
    progressPercent: 0,
    allStepsComplete: false,
    isCompleteStageVisible: false,
  }
}

function buildMessages(data: AskAIHelperInput): WorkersAIMessage[] {
  const pageContext = data.pageContext || getDefaultPageContext()
  const schoolContext = getSchoolContext(data.schoolContext)
  const recentHistory = data.history
    .filter((message) => message.text.trim())
    .slice(-6)
    .map((message): WorkersAIMessage => ({
      role: message.sender === 'user' ? 'user' : 'assistant',
      content: message.text.trim(),
    }))

  return [
    { role: 'system', content: buildSystemPrompt(data.schoolContext).trim() },
    ...recentHistory,
    {
      role: 'user',
      content: [
        'Active Task Details:',
        `Name: ${data.currentTask.name}`,
        `Instructions: ${data.currentTask.notes || 'No additional instructions provided.'}`,
        `Due Date: ${data.currentTask.dueDate || 'No due date set'}`,
        `Step Number: ${data.currentTask.stepNumber || 'Not applicable'}`,
        `Task Status: ${data.currentTask.completed ? 'Completed' : 'Not completed'}`,
        `Functional Area: ${data.currentTask.functionalArea || 'Not provided'}`,
        `Urgent: ${data.currentTask.isUrgent ? 'Yes' : 'No'}`,
        '',
        'Current School Context:',
        `School: ${schoolContext.schoolName}`,
        `Contact: ${schoolContext.contactName}`,
        `Services: ${schoolContext.services}`,
        `Client Type: ${schoolContext.clientType}`,
        `State: ${schoolContext.state}`,
        '',
        'Current Page Context:',
        `Page: ${pageContext.pageName}`,
        `Path: ${pageContext.path}`,
        `Visible View: ${pageContext.viewMode}`,
        `Current Stage: ${pageContext.stageLabel}`,
        `Stage Code: ${pageContext.stage}`,
        `Current Step Number: ${pageContext.currentStepNumber || 'Not applicable'}`,
        `Completed Steps: ${pageContext.completedSteps} of ${pageContext.totalSteps}`,
        `Progress: ${pageContext.progressPercent}%`,
        `All Steps Complete: ${pageContext.allStepsComplete ? 'Yes' : 'No'}`,
        `Complete Stage Visible: ${pageContext.isCompleteStageVisible ? 'Yes' : 'No'}`,
        pageContext.isCompleteStageVisible
          ? 'Important: The client is currently on the Complete stage. Answer as if onboarding submissions are complete and Vertex review is the next step.'
          : 'Important: The client is still in the onboarding journey. Answer based on the active page stage and task status.',
        '',
        `User Question: ${data.query}`,
      ].join('\n'),
    },
  ]
}

function getStringField(value: Record<string, unknown>, field: string) {
  const text = value[field]
  return typeof text === 'string' ? text.trim() : ''
}

function extractContentParts(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }

  if (!Array.isArray(value)) {
    return ''
  }

  return value
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''

      const contentPart = part as Record<string, unknown>
      for (const field of ['text', 'content', 'output_text']) {
        const text = contentPart[field]
        if (typeof text === 'string') return text
      }

      return ''
    })
    .join('')
    .trim()
}

function removeRepeatedSentences(text: string) {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g)
  if (!sentences) return text.trim()

  const seen = new Set<string>()
  const deduped: string[] = []

  for (const sentence of sentences) {
    const clean = sentence.trim()
    const key = clean.toLowerCase().replace(/\s+/g, ' ')
    if (!key || seen.has(key)) continue
    seen.add(key)
    deduped.push(clean)
  }

  return deduped.join(' ').trim()
}

function normalizeAIText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return removeRepeatedSentences(trimmed)
}

function looksLikePromptEcho(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ')
  const guardrailCount = normalized.match(/guardrails/g)?.length ?? 0

  return (
    normalized.includes('provided faq and portal context') ||
    normalized.includes('answer as vertexai') ||
    normalized.includes('keep the answer within') ||
    normalized.includes('within theguardrails') ||
    guardrailCount > 2
  )
}

function extractWorkersAIText(response: unknown): string {
  if (typeof response === 'string') {
    return normalizeAIText(response)
  }

  if (!response || typeof response !== 'object') {
    return ''
  }

  const value = response as {
    response?: unknown
    result?: unknown
    choices?: Array<{
      message?: { content?: unknown }
      text?: unknown
    }>
    text?: unknown
    generated_text?: unknown
    output_text?: unknown
    answer?: unknown
    completion?: unknown
    content?: unknown
    output?: unknown
    message?: {
      content?: unknown
      reasoning?: unknown
      reasoning_content?: unknown
    }
  }

  for (const field of ['response', 'text', 'generated_text', 'output_text', 'answer', 'completion', 'content']) {
    const text = getStringField(value as Record<string, unknown>, field)
    if (text) {
      return normalizeAIText(text)
    }
  }

  const topLevelContent = extractContentParts(value.content)
  if (topLevelContent) {
    return normalizeAIText(topLevelContent)
  }

  const topLevelOutput = extractContentParts(value.output)
  if (topLevelOutput) {
    return normalizeAIText(topLevelOutput)
  }

  if (value.result) {
    const resultText = extractWorkersAIText(value.result)
    if (resultText) {
      return resultText
    }
  }

  const firstChoice = value.choices?.[0]
  const choiceContent = firstChoice?.message?.content
  const choiceText = extractContentParts(choiceContent)
  if (choiceText) {
    return normalizeAIText(choiceText)
  }

  if (typeof firstChoice?.text === 'string') {
    return normalizeAIText(firstChoice.text)
  }

  return ''
}

function extractJsonArray(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed
  const match = trimmed.match(/\[[\s\S]*\]/)
  return match?.[0] || ''
}

export function deterministicTaskFileRequirement(task: TaskFileRequirementInput): TaskFileRequirement {
  const content = `${task.name} ${task.notes}`.toLowerCase()
  const explicitUploadSignals = [
    'upload',
    'attach',
    'file upload',
    'uploaded',
  ]
  const fileSignals = [
    'document',
    'file',
    'pdf',
    'excel',
    'spreadsheet',
    'csv',
    'bank letter',
    'voided check',
    'payroll register',
    'budget',
    'trial balance',
    'general ledger',
    'gl detail',
    'report',
    'statement',
    'certificate',
    'letter',
    'form',
    'copy of',
  ]
  const manualSignals = [
    'sign up',
    'signup',
    'register',
    'registration',
    'enroll',
    'create account',
    'set up account',
    'setup account',
    'activate account',
    'log in',
    'login',
    'complete profile',
    'complete setup',
    'fingerprint service',
    'teach fingerprint',
    'confirm',
    'acknowledge',
    'review',
    'schedule',
    'meet',
    'meeting',
    'call',
    'answer',
    'select',
    'choose',
    'verify',
  ]

  const hasExplicitUploadSignal = explicitUploadSignals.some((signal) => content.includes(signal))
  const hasFileSignal = fileSignals.some((signal) => content.includes(signal))
  const hasManualSignal = manualSignals.some((signal) => content.includes(signal))
  const requiresFileUpload = hasExplicitUploadSignal || (hasFileSignal && !hasManualSignal)
  const ambiguous = !hasExplicitUploadSignal && !hasFileSignal && !hasManualSignal

  return {
    id: task.id,
    requiresFileUpload,
    reason: requiresFileUpload
      ? 'The task appears to request a document or file-based submission.'
      : ambiguous
        ? 'The task does not contain a clear file upload signal.'
        : 'The task can be completed manually because it does not clearly request a file upload.',
    classifier: 'deterministic',
    ambiguous,
  }
}

function parseFileRequirementResponse(text: string, tasks: TaskFileRequirementInput[]) {
  const fallbackById = new Map(tasks.map((task) => [task.id, deterministicTaskFileRequirement(task)]))

  try {
    const jsonText = extractJsonArray(text)
    const parsed = jsonText ? JSON.parse(jsonText) : JSON.parse(text.trim())
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.tasks)
        ? parsed.tasks
        : Array.isArray(parsed?.results)
          ? parsed.results
          : []
    if (!Array.isArray(items) || items.length === 0) return Array.from(fallbackById.values())

    return tasks.map((task) => {
      const item = items.find((entry: any) => String(entry?.id || '') === task.id)
      if (typeof item?.requiresFileUpload !== 'boolean') {
        return fallbackById.get(task.id)!
      }

      return {
        id: task.id,
        requiresFileUpload: item.requiresFileUpload,
        reason: typeof item.reason === 'string' && item.reason.trim()
          ? item.reason.trim().slice(0, 180)
          : fallbackById.get(task.id)!.reason,
        classifier: 'gemma',
        ambiguous: false,
      }
    })
  } catch {
    return Array.from(fallbackById.values())
  }
}

async function classifyTaskFileRequirementBatch(
  ai: { run: (model: string, input: unknown) => Promise<unknown> },
  tasks: TaskFileRequirementInput[],
) {
  try {
    const response = await ai.run(WORKERS_AI_MODEL, {
      messages: [
        {
          role: 'system',
          content: [
            'You classify Vertex Bridge onboarding tasks.',
            'Return only a JSON array. No markdown. No commentary.',
            'For each task, decide if the client must upload a file/document/spreadsheet/image to complete it.',
            'Return requiresFileUpload false for confirmation, acknowledgment, review, scheduling, setup, sign-up, registration, account creation, fingerprint service signup, meeting, or informational tasks that can be manually completed without a file.',
            'Example: "Sign up for TEACH fingerprint service" is false unless the instructions explicitly ask the client to upload proof, a receipt, a form, or another file.',
            'Return true only if the task asks to upload, attach, or provide a document/report/form/budget/bank/payroll/accounting file or image.',
            'Do not approve documents or provide advice.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify(tasks.map((task) => ({
            id: task.id,
            name: task.name,
            notes: task.notes || '',
            functionalArea: task.functionalArea || '',
          }))),
        },
      ],
      max_completion_tokens: Math.min(1600, Math.max(512, tasks.length * 80)),
      response_format: { type: 'text' },
      temperature: 0,
      chat_template_kwargs: {
        enable_thinking: false,
        clear_thinking: true,
      },
    })
    const text = extractWorkersAIText(response)
    return parseFileRequirementResponse(text, tasks)
  } catch {
    return tasks.map(deterministicTaskFileRequirement)
  }
}

export async function classifyTaskFileRequirements(tasks: TaskFileRequirementInput[]): Promise<TaskFileRequirement[]> {
  if (tasks.length === 0) return []

  const { getCloudflareEnv } = await import('./cloudflare-env.server')
  const env = getCloudflareEnv()
  const ai = (env as any).AI

  if (!ai || typeof ai.run !== 'function') {
    return tasks.map(deterministicTaskFileRequirement)
  }

  const results: TaskFileRequirement[] = []
  const batchSize = 25
  for (let index = 0; index < tasks.length; index += batchSize) {
    const batch = tasks.slice(index, index + batchSize)
    results.push(...await classifyTaskFileRequirementBatch(ai, batch))
  }

  return results
}

async function runGemma4(ai: { run: (model: string, input: unknown) => Promise<unknown> }, data: {
  query: string
  currentTask: CurrentTaskContext
  pageContext?: PageContext
  schoolContext?: SchoolContext
  history: ChatHistoryMessage[]
}) {
  const commonOptions = {
    max_completion_tokens: 260,
    response_format: { type: 'text' },
    temperature: 0.3,
    chat_template_kwargs: {
      enable_thinking: false,
      clear_thinking: true,
    },
  }

  const messageResponse = await ai.run(WORKERS_AI_MODEL, {
    messages: buildMessages(data),
    ...commonOptions,
  })
  const messageText = extractWorkersAIText(messageResponse)
  if (messageText && !looksLikePromptEcho(messageText)) {
    return messageText
  }

  if (messageText) {
    throw new Error('VertexAI returned prompt instructions instead of an answer.')
  }

  throw new Error('VertexAI returned an empty response.')
}

export async function getAIHelperResponse(data: AskAIHelperInput) {
  const query = data.query.trim()
  const { getCloudflareEnv } = await import('./cloudflare-env.server')
  const env = getCloudflareEnv()
  const ai = (env as any).AI

  if (!query) {
    return {
      text: 'Please send a question about your onboarding step and I will help explain what to do next.',
      isFallback: false,
      model: 'input-required',
      diagnostic: 'empty-query'
    }
  }

  if (!ai || typeof ai.run !== 'function') {
    return {
      text: 'VertexAI is not available on this server right now.',
      isFallback: false,
      model: 'gemma-error',
      diagnostic: 'missing-env-ai-binding'
    }
  }

  try {
    const text = await runGemma4(ai, {
      query,
      currentTask: data.currentTask,
      pageContext: data.pageContext,
      schoolContext: data.schoolContext,
      history: data.history,
    })

    return {
      text,
      isFallback: false,
      model: WORKERS_AI_MODEL,
      diagnostic: null
    }
  } catch (err) {
    console.error('Workers AI call failed:', err)
    const diagnostic = err instanceof Error ? err.message : String(err)
    return {
      text: 'VertexAI could not get a usable response just now. Please try again in a moment.',
      isFallback: false,
      model: 'gemma-error',
      diagnostic
    }
  }
}

export const askAIHelper = createServerFn({ method: 'POST' })
  .validator((data: AskAIHelperInput) => data)
  .handler(async ({ data }) => {
    await assertTrustedOrigin()
    await requireSession()
    const response = await getAIHelperResponse(data)
    return {
      ...response,
      diagnostic: null,
    }
  })
