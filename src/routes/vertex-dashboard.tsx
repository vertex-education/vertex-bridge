import { createFileRoute, Link } from '@tanstack/react-router'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createServerFn } from '@tanstack/react-start'
import { AlertTriangle, CheckCircle2, ChevronDown, ClipboardCheck, Clock3, Copy, Download, Send, SlidersHorizontal, Sparkles } from 'lucide-react'
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
const intakeStepCount = 5
const clientSetupStepCount = profileStepCount + intakeStepCount
const fallbackTaskCount = 5
const healthRiskWindowDays = 14
const taskActivityPageSize = 8
const workersAiModel = '@cf/google/gemma-4-26b-a4b-it'
const demoSchoolName = 'Heritage Summit Schools'
const demoSchoolState = 'California'
const demoSchoolClientType = 'New'
const demoSchoolServices = 'SFO (Accounting, AP, Payroll, Grants)'
const demoOnboardingCoordinator = 'Eugene B. (AP/Payroll Lead)'
const emptyDashboardData = { clients: [], invites: [], submissions: [], progress: [], taskStates: [], projects: [], nudgeSettings: [], intakeResponses: [] }

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

type PdfSection = {
  heading: string
  lines: string[]
}

type PdfLogoImage = {
  width: number
  height: number
  hexData: string
}

type ConversationMessage = {
  id: string
  conversationId: string
  schoolName: string
  channel: 'ai' | 'staff'
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
  channel: 'ai' | 'staff'
  messages: ConversationMessage[]
  unreadCount: number
  lastReadAt: string | null
  lastMessageCreatedAt: string | null
}

async function fetchStaffConversation(schoolName: string) {
  const response = await fetch(`/api/conversations?schoolName=${encodeURIComponent(schoolName)}&channel=staff`)
  const data = await response.json() as ConversationView | { error?: string }
  if (!response.ok) {
    throw new Error('error' in data && data.error ? data.error : 'Unable to load messages.')
  }
  return data as ConversationView
}

async function markStaffConversationRead(schoolName: string) {
  await fetch('/api/conversations/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schoolName, channel: 'staff' }),
  })
}

function pdfSafeText(value: string) {
  return value
    .replace(/[•–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function wrapPdfText(value: string, maxLength = 92) {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }
    if (`${current} ${word}`.length > maxLength) {
      lines.push(current)
      current = word
      continue
    }
    current = `${current} ${word}`
  }

  if (current) lines.push(current)
  return lines.length > 0 ? lines : ['Not available']
}

function sanitizeDownloadName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'client-profile'
}

function base64ToHex(base64: string) {
  const binary = atob(base64)
  let hex = ''
  for (let index = 0; index < binary.length; index += 1) {
    hex += binary.charCodeAt(index).toString(16).padStart(2, '0')
  }
  return hex
}

async function loadVertexLogoForPdf(): Promise<PdfLogoImage | null> {
  if (typeof window === 'undefined') return null

  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = 432
      canvas.height = 73
      const context = canvas.getContext('2d')
      if (!context) {
        resolve(null)
        return
      }

      context.fillStyle = '#FFFFFF'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      const base64 = dataUrl.split(',')[1]
      resolve({
        width: canvas.width,
        height: canvas.height,
        hexData: base64ToHex(base64),
      })
    }
    image.onerror = () => resolve(null)
    image.src = '/brand/vertex-horizontal.svg'
  })
}

function createClientProfilePdfBlob(title: string, sections: PdfSection[], logo: PdfLogoImage | null = null) {
  const pageWidth = 612
  const pageHeight = 792
  const marginX = 54
  const lineHeight = 13
  const maxLinesPerPage = 40
  const pages: Array<Array<{ text: string; size: number; kind: 'title' | 'heading' | 'body' | 'meta' }>> = [[]]

  const addLine = (text: string, size = 10, kind: 'title' | 'heading' | 'body' | 'meta' = 'body') => {
    const page = pages[pages.length - 1]
    if (page.length >= maxLinesPerPage) {
      pages.push([])
    }
    pages[pages.length - 1].push({ text, size, kind })
  }

  addLine(title, 18, 'title')
  addLine(`Generated ${new Date().toLocaleString()}`, 9, 'meta')
  addLine('', 8, 'body')

  for (const section of sections) {
    addLine(section.heading.toUpperCase(), 11, 'heading')
    for (const line of section.lines.length > 0 ? section.lines : ['Not available']) {
      for (const wrappedLine of wrapPdfText(line)) {
        addLine(wrappedLine, 10, 'body')
      }
    }
    addLine('', 8)
  }

  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'

  const kids: string[] = []
  const logoObjectNumber = logo ? 5 : null
  let nextObjectNumber = logo ? 6 : 5
  if (logo && logoObjectNumber) {
    objects[logoObjectNumber] = `<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logo.hexData.length + 1} >>\nstream\n${logo.hexData}>\nendstream`
  }

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = nextObjectNumber
    const contentObjectNumber = pageObjectNumber + 1
    nextObjectNumber += 2
    kids.push(`${pageObjectNumber} 0 R`)

    const headerCommands = [
      '1 1 1 rg 0 0 612 792 re f',
      '0.000 0.220 0.396 rg 0 705 612 2 re f',
      '0.796 0.627 0.322 rg 54 690 504 1 re f',
      ...(logo ? ['q 148 0 0 25 54 728 cm /Logo Do Q'] : [
        '0.000 0.220 0.396 rg BT /F2 20 Tf 54 735 Td (vertex) Tj ET',
        '0.000 0.220 0.396 rg BT /F1 9 Tf 56 721 Td (EDUCATION) Tj ET',
      ]),
      `0.439 0.451 0.447 rg BT /F1 8 Tf 512 735 Td (Page ${index + 1}) Tj ET`,
    ]

    const lineCommands = pageLines.map((line, lineIndex) => {
      const y = 675 - lineIndex * lineHeight
      const color = line.kind === 'title'
        ? '0.000 0.220 0.396 rg'
        : line.kind === 'heading'
          ? '0.796 0.627 0.322 rg'
          : line.kind === 'meta'
            ? '0.439 0.451 0.447 rg'
            : '0.251 0.263 0.259 rg'
      const font = line.kind === 'title' || line.kind === 'heading' ? 'F2' : 'F1'
      return `${color} BT /${font} ${line.size} Tf ${marginX} ${y} Td (${pdfSafeText(line.text)}) Tj ET`
    })

    const stream = [...headerCommands, ...lineCommands].join('\n')
    const resources = logo ? '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Logo 5 0 R >> >>' : '/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >>'

    objects[pageObjectNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] ${resources} /Contents ${contentObjectNumber} 0 R >>`
    objects[contentObjectNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
  })

  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = [0]
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length
    pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`
  }

  const xrefOffset = pdf.length
  pdf += `xref\n0 ${objects.length}\n`
  pdf += '0000000000 65535 f \n'
  for (let index = 1; index < objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  return new Blob([pdf], { type: 'application/pdf' })
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
type SchoolProfileModalTab = 'summary' | 'progress' | 'activity' | 'messages'

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

type DashboardIntakeResponse = {
  schoolName: string
  responseJson: string
  completedStepIdsJson: string
  submittedAt: Date | null
}

type ParsedIntakeResponse = {
  responses: Record<string, string | Record<string, number>>
  completedStepIds: string[]
}

type SchoolProfileInsight = {
  schoolName: string
  summary: string
  qualitySignals: string[]
  painPoints: string[]
  concerns: string[]
  importantDetails: string[]
  model: string
  isFallback: boolean
}

const intakeQuestionLabels: Record<string, string> = {
  'accounting-processes-documented': 'Accounting processes feel undocumented or inconsistent',
  'ap-demand-independent': 'AP demand is hard to manage independently',
  'budget-visibility': 'Budget visibility is unreliable',
  'payroll-predictable': 'Payroll predictability is a concern',
  'grants-compliance-confidence': 'Grants tracking confidence is low',
  'handoff-accounting': 'Accounting handoff needs support',
  'share-financial-access': 'Financial access sharing needs trust-building',
  'communication-rhythm': 'Communication rhythm needs structure',
  'partner-payroll': 'Payroll delegation needs trust-building',
  'delegate-grants': 'Grants delegation needs trust-building',
}

function parseIntakeResponse(row: DashboardIntakeResponse | undefined): ParsedIntakeResponse {
  if (!row) return { responses: {}, completedStepIds: [] }

  try {
    return {
      responses: JSON.parse(row.responseJson || '{}'),
      completedStepIds: JSON.parse(row.completedStepIdsJson || '[]'),
    }
  } catch {
    return { responses: {}, completedStepIds: [] }
  }
}

function getRatingAverage(response: string | Record<string, number> | undefined) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null
  const values = Object.values(response).filter((value): value is number => typeof value === 'number')
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function getLowRatingSignals(response: string | Record<string, number> | undefined) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return []

  return Object.entries(response)
    .filter(([, value]) => typeof value === 'number' && value <= 2)
    .sort(([, a], [, b]) => Number(a) - Number(b))
    .map(([id, value]) => ({
      label: intakeQuestionLabels[id] || id,
      rating: Number(value),
    }))
}

function compactInsightText(value: unknown, maxWords = 12) {
  const words = String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}...`
}

function firstCompleteStatement(value: unknown, maxWords = 16) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ')
  if (!normalized) return ''

  const sentenceMatch = normalized.match(/^(.+?[.!?])(\s|$)/)
  const firstSentence = sentenceMatch ? sentenceMatch[1] : normalized
  const boundaryMatch = firstSentence.match(/^(.+?)\s+(while|because|but|so that|in order to|which|with)\s+/i)
  const candidate = trimTerminalPunctuation(boundaryMatch ? boundaryMatch[1] : firstSentence)
  const words = candidate.split(' ').filter(Boolean)

  if (words.length <= maxWords) return candidate
  return trimTerminalPunctuation(words.slice(0, maxWords).join(' '))
}

function completeInsightText(value: unknown, maxWords = 16) {
  const statement = firstCompleteStatement(value, maxWords)
  if (!statement) return ''
  return /[.!?]$/.test(statement) ? statement : `${statement}.`
}

function completeInsightFragment(value: unknown, maxWords = 14) {
  return trimTerminalPunctuation(firstCompleteStatement(value, maxWords))
}

function trimTerminalPunctuation(value: string) {
  return value.trim().replace(/[.!?:;,\s]+$/g, '')
}

function concisePainPoint(value: string) {
  const normalized = trimTerminalPunctuation(value.replace(/\s+/g, ' '))
    .replace(/^we\s+(are|'re)\s+(consistently\s+|currently\s+|still\s+)?(struggling|having trouble|finding it hard)\s+to\s+/i, '')
    .replace(/^we\s+(consistently\s+|currently\s+|still\s+)?(struggle|need help)\s+with\s+/i, '')
    .replace(/^our\s+(biggest|main|current)\s+(pain|challenge|issue)\s+(is|has been)\s+/i, '')
    .split(/\s+(while|because|due to|but)\s+/i)[0]
    .replace(/^maintain\b/i, 'maintaining')
    .replace(/^manage\b/i, 'managing')
    .replace(/^coordinate\b/i, 'coordinating')
    .replace(/^build\b/i, 'building')
    .replace(/^trust\b/i, 'trusting')

  return trimTerminalPunctuation(normalized) || 'not submitted'
}

function buildClientExperienceSummary(schoolName: string, progressPercent: number, currentPain: string) {
  const progress = `${schoolName} is ${Math.round(progressPercent)}% through onboarding`
  if (!currentPain.trim()) return `${progress}; main pain has not been submitted yet.`
  return `${progress}; main pain: ${concisePainPoint(currentPain)}.`
}

function completeInsightSummary(value: unknown, fallback: string) {
  const summary = String(value || '').trim().replace(/\s+/g, ' ')
  if (!summary || summary.includes('...')) return fallback
  return summary
}

function compactInsightItems(value: unknown, fallback: string[], maxItems = 4) {
  if (!Array.isArray(value)) return fallback
  const items = value
    .filter((item) => !String(item || '').includes('...'))
    .map((item) => completeInsightText(item))
    .filter(Boolean)
    .slice(0, maxItems)

  return items.length > 0 ? items : fallback
}

function getTaskDaysUntilDue(dueDate: string | null | undefined) {
  if (!dueDate) return null
  const date = new Date(`${dueDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function isTaskUrgent(taskName: string) {
  return /urgent|payroll|check|501c3|ein|bank/i.test(taskName)
}

function buildFallbackSchoolInsight(input: {
  schoolName: string
  progressPercent: number
  internalAverage: number | null
  externalAverage: number | null
  teamContext: string
  currentPain: string
  successDefinition: string
  lowReadinessSignals: Array<{ label: string; rating: number }>
  outstandingTasks: number
  urgentTaskNames: string[]
  upcomingTaskNames: string[]
}): SchoolProfileInsight {
  return {
    schoolName: input.schoolName,
    summary: buildClientExperienceSummary(input.schoolName, input.progressPercent, input.currentPain),
    qualitySignals: [
      input.teamContext ? `Who they are: ${completeInsightFragment(input.teamContext, 14)}.` : 'Team story not submitted',
      input.successDefinition ? `What better looks like: ${completeInsightFragment(input.successDefinition, 14)}.` : 'Success story not submitted',
    ],
    painPoints: [
      input.currentPain ? concisePainPoint(input.currentPain) : 'No stated pain point yet',
      ...input.lowReadinessSignals.slice(0, 3).map((signal) => `${signal.label} (${signal.rating}/5)`),
    ],
    concerns: [
      input.lowReadinessSignals[0] ? `Improve: ${completeInsightFragment(input.lowReadinessSignals[0].label, 8)}` : '',
      input.internalAverage !== null && input.internalAverage < 3 ? 'Stabilize internal SFO routines' : '',
      input.externalAverage !== null && input.externalAverage < 3 ? 'Build confidence in Vertex handoff' : '',
      input.outstandingTasks > 0 ? `Remove friction from ${input.outstandingTasks} open steps` : '',
    ].filter(Boolean),
    importantDetails: [
      input.currentPain ? 'Start next call with their stated pain' : 'Ask what feels hardest today',
      input.successDefinition ? 'Tie next steps to their success definition' : 'Ask what would make partnership worthwhile',
      ...input.urgentTaskNames.slice(0, 1).map((taskName) => `Unblock urgent task: ${completeInsightFragment(taskName, 7)}`),
      ...input.upcomingTaskNames.slice(0, 1).map((taskName) => `Confirm due-soon task: ${completeInsightFragment(taskName, 7)}`),
    ].filter(Boolean).slice(0, 4),
    model: 'deterministic-summary',
    isFallback: true,
  }
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
    const { clientProfiles, invitations, schoolNudgeSettings, submissions, schoolAsanaProjects, schoolOnboardingProgress, schoolOnboardingTaskStates, schoolOnboardingIntakeResponses } = await import('#/db/schema')
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
    const intakeResponses = await db.select().from(schoolOnboardingIntakeResponses).all()

    return {
      clients,
      invites,
      submissions: allSubmissions,
      progress,
      taskStates,
      projects,
      nudgeSettings,
      intakeResponses,
    }
  })

export const getSchoolProfileInsight = createServerFn({ method: 'GET' })
  .validator((schoolName: string) => schoolName)
  .handler(async ({ data: schoolName }) => {
    const { db } = await import('#/db')
    const { getCloudflareEnv } = await import('#/lib/cloudflare-env.server')
    const { clientProfiles, schoolOnboardingIntakeResponses, schoolOnboardingProgress, schoolOnboardingTaskStates } = await import('#/db/schema')

    await requireStaffSession()

    const [clientRows, intakeRows, progressRows, taskRows] = await Promise.all([
      db.select().from(clientProfiles).where(eq(clientProfiles.schoolName, schoolName)).all(),
      db.select().from(schoolOnboardingIntakeResponses).where(eq(schoolOnboardingIntakeResponses.schoolName, schoolName)).all(),
      db.select().from(schoolOnboardingProgress).where(eq(schoolOnboardingProgress.schoolName, schoolName)).all(),
      db.select().from(schoolOnboardingTaskStates).where(eq(schoolOnboardingTaskStates.schoolName, schoolName)).all(),
    ])

    const client = clientRows[0]
    const parsedIntake = parseIntakeResponse(intakeRows[0] as DashboardIntakeResponse | undefined)
    const progress = progressRows[0]
    const internalAverage = getRatingAverage(parsedIntake.responses['sfo-internal-readiness'])
    const externalAverage = getRatingAverage(parsedIntake.responses['sfo-external-readiness'])
    const lowReadinessSignals = [
      ...getLowRatingSignals(parsedIntake.responses['sfo-internal-readiness']),
      ...getLowRatingSignals(parsedIntake.responses['sfo-external-readiness']),
    ]
    const teamContext = typeof parsedIntake.responses['team-context'] === 'string' ? parsedIntake.responses['team-context'] as string : ''
    const currentPain = typeof parsedIntake.responses['current-pain'] === 'string' ? parsedIntake.responses['current-pain'] as string : ''
    const successDefinition = typeof parsedIntake.responses['success-definition'] === 'string' ? parsedIntake.responses['success-definition'] as string : ''
    const incompleteTasks = taskRows.filter((task) => !task.completed)
    const urgentTaskNames = incompleteTasks.filter((task) => isTaskUrgent(task.taskName)).map((task) => task.taskName)
    const upcomingTaskNames = incompleteTasks
      .filter((task) => {
        const daysUntilDue = getTaskDaysUntilDue(task.dueDate)
        return daysUntilDue !== null && daysUntilDue <= 14
      })
      .sort((a, b) => {
        const aDays = getTaskDaysUntilDue(a.dueDate) ?? Number.MAX_SAFE_INTEGER
        const bDays = getTaskDaysUntilDue(b.dueDate) ?? Number.MAX_SAFE_INTEGER
        return aDays - bDays
      })
      .map((task) => task.taskName)
    const completedIntakeCount = parsedIntake.completedStepIds.length
    const totalSteps = (progress?.totalTaskCount ?? taskRows.length) + clientSetupStepCount
    const completedSteps = (progress?.completedTaskCount ?? taskRows.filter((task) => task.completed).length) + profileStepCount + completedIntakeCount
    const progressPercent = totalSteps > 0 ? Math.min((completedSteps / totalSteps) * 100, 100) : 0
    const fallback = buildFallbackSchoolInsight({
      schoolName,
      progressPercent,
      internalAverage,
      externalAverage,
      teamContext,
      currentPain,
      successDefinition,
      lowReadinessSignals,
      outstandingTasks: Math.max(totalSteps - completedSteps, 0),
      urgentTaskNames,
      upcomingTaskNames,
    })

    const env = getCloudflareEnv()
    const ai = (env as any).AI
    if (!ai || typeof ai.run !== 'function') {
      return fallback
    }

    try {
      const response = await ai.run(workersAiModel, {
        messages: [
          {
            role: 'system',
            content: [
              'You write story-driven internal notes for Vertex client managers from school onboarding intake data.',
              'Return only valid JSON with keys: summary, qualitySignals, painPoints, concerns, importantDetails.',
              'Use these meanings exactly: summary=user-centered story, qualitySignals=who the client is and what better looks like, painPoints=user struggles, concerns=service improvement opportunities, importantDetails=manager next moves or questions.',
              'summary must be one complete sentence, maximum 24 words: "<School> is <percent>% through onboarding; main pain: <concise pain point>."',
              'Do not use ellipses, unfinished clauses, or the phrase "is signaling".',
              'Each array must contain 2-4 complete short bullets, maximum 14 words each.',
              'Every bullet must end as a complete thought, without truncation.',
              'Use direct, human language a client manager can act on.',
              'Turn open-ended responses into needs, fears, and desired outcomes.',
              'Turn low ratings into improvement opportunities, not generic risk labels.',
              'Do not restate every input field.',
              'Do not write long explanations.',
              'Do not provide legal, financial, payroll, tax, compliance, or contract advice.',
              'Do not invent facts not present in the input.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              schoolName,
              state: client?.state || null,
              services: client?.services || null,
              clientType: client?.clientType || null,
              onboardingCoordinator: client?.onboardingCoordinator || null,
              progress: {
                completedSteps,
                totalSteps,
                progressPercent: Math.round(progressPercent),
                outstandingTasks: incompleteTasks.length,
              },
              readiness: {
                internalAverage,
                externalAverage,
                lowReadinessSignals: lowReadinessSignals.slice(0, 8),
                completedStepIds: parsedIntake.completedStepIds,
              },
              openResponses: {
                teamContext,
                currentPain,
                successDefinition,
              },
              concerns: {
                urgentTaskNames: urgentTaskNames.slice(0, 6),
                upcomingTaskNames: upcomingTaskNames.slice(0, 6),
              },
            }),
          },
        ],
        max_completion_tokens: 700,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        chat_template_kwargs: {
          enable_thinking: false,
          clear_thinking: true,
        },
      })
      const rawText = typeof response === 'string'
        ? response
        : typeof (response as any)?.response === 'string'
          ? (response as any).response
          : typeof (response as any)?.result?.response === 'string'
            ? (response as any).result.response
            : ''
      const parsed = JSON.parse(rawText)
      return {
        schoolName,
        summary: completeInsightSummary(parsed.summary, fallback.summary),
        qualitySignals: compactInsightItems(parsed.qualitySignals, fallback.qualitySignals),
        painPoints: compactInsightItems(parsed.painPoints, fallback.painPoints),
        concerns: compactInsightItems(parsed.concerns, fallback.concerns),
        importantDetails: compactInsightItems(parsed.importantDetails, fallback.importantDetails),
        model: workersAiModel,
        isFallback: false,
      } satisfies SchoolProfileInsight
    } catch (err) {
      console.error('School profile insight generation failed:', err)
      return fallback
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
  const [schoolProfileTab, setSchoolProfileTab] = useState<SchoolProfileModalTab>('summary')
  const [successfulNudgeKeys, setSuccessfulNudgeKeys] = useState<Set<string>>(() => new Set())
  const [taskActivityPage, setTaskActivityPage] = useState(1)
  const [staffMessageInput, setStaffMessageInput] = useState('')
  const [staffMessageSending, setStaffMessageSending] = useState(false)
  const [staffMessageError, setStaffMessageError] = useState('')
  const [copyToast, setCopyToast] = useState('')
  const staffMessageReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
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

  const copyValue = useCallback(async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopyToast(`${label} copied`)
      window.setTimeout(() => setCopyToast(''), 2200)
    } catch {
      setDashboardAlert({
        type: 'error',
        title: 'Copy failed',
        message: 'Clipboard access is not available in this browser session.',
      })
    }
  }, [])

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
    ...dashData.clients.map(client => client.schoolName),
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
  ])).sort((a, b) => a.localeCompare(b)), [dashData.clients, dashData.submissions, dashData.progress, dashData.taskStates, dashData.projects])

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
  const intakeBySchool = useMemo(() => {
    const responsesBySchool = new Map<string, DashboardIntakeResponse>()
    for (const response of dashData.intakeResponses) {
      responsesBySchool.set(response.schoolName, response as DashboardIntakeResponse)
    }
    return responsesBySchool
  }, [dashData.intakeResponses])
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
    const parsedIntake = parseIntakeResponse(intakeBySchool.get(schoolName))
    const completedIntakeCount = Math.min(parsedIntake.completedStepIds.length, intakeStepCount)
    const rowTotalSteps = progressSnapshot
      ? progressSnapshot.totalTaskCount + clientSetupStepCount
      : client
        ? fallbackTaskCount + clientSetupStepCount
        : submittedTaskCount
    const rowCompletedSteps = progressSnapshot
      ? progressSnapshot.completedTaskCount + profileStepCount + completedIntakeCount
      : client
        ? Math.min(submittedTaskCount + profileStepCount + completedIntakeCount, rowTotalSteps)
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
    intakeBySchool,
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
  const pendingReviewItemCount = useMemo(
    () => dashData.submissions.filter(submission => submission.status === 'Pending').length,
    [dashData.submissions],
  )
  const valueMetric = useMemo(() => {
    const documentsCollected = dashData.submissions.length
    const tasksAutoSynced = dashData.taskStates.filter(task => task.completed).length
    return {
      documentsCollected,
      tasksAutoSynced,
      estimatedEmailsAvoided: tasksAutoSynced * 2,
    }
  }, [dashData.submissions, dashData.taskStates])
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
  const { data: selectedStaffConversation, isLoading: selectedStaffConversationLoading } = useQuery({
    queryKey: ['school-conversation', selectedDashboardRow?.schoolName, 'staff'],
    queryFn: () => fetchStaffConversation(selectedDashboardRow?.schoolName || ''),
    enabled: Boolean(selectedDashboardRow?.schoolName),
  })
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
      task.clientStepNumber = index + clientSetupStepCount + 1
    })

    return clientOrderedTasks.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return a.clientStepNumber - b.clientStepNumber
    })
  }, [selectedDashboardRow, selectedSchoolSubmissions, taskStatesBySchool])
  const selectedIntake = useMemo(
    () => selectedDashboardRow ? parseIntakeResponse(intakeBySchool.get(selectedDashboardRow.schoolName)) : { responses: {}, completedStepIds: [] },
    [intakeBySchool, selectedDashboardRow],
  )
  const selectedInternalAverage = getRatingAverage(selectedIntake.responses['sfo-internal-readiness'])
  const selectedExternalAverage = getRatingAverage(selectedIntake.responses['sfo-external-readiness'])
  const selectedIncompleteTasks = useMemo(() => selectedSchoolTasks.filter((task) => !task.completed), [selectedSchoolTasks])
  const selectedUrgentTasks = useMemo(() => selectedIncompleteTasks.filter((task) => isTaskUrgent(task.name)), [selectedIncompleteTasks])
  const selectedUpcomingTasks = useMemo(() => selectedIncompleteTasks
    .filter((task) => {
      const daysUntilDue = getTaskDaysUntilDue(task.dueDate)
      return daysUntilDue !== null && daysUntilDue <= 14
    })
    .sort((a, b) => (getTaskDaysUntilDue(a.dueDate) ?? Number.MAX_SAFE_INTEGER) - (getTaskDaysUntilDue(b.dueDate) ?? Number.MAX_SAFE_INTEGER)),
    [selectedIncompleteTasks],
  )
  const { data: selectedSchoolInsight, isLoading: selectedSchoolInsightLoading } = useQuery({
    queryKey: ['school-profile-insight', selectedDashboardRow?.schoolName],
    queryFn: () => getSchoolProfileInsight({ data: selectedDashboardRow?.schoolName || '' }),
    enabled: Boolean(selectedDashboardRow?.schoolName),
    staleTime: 60_000,
  })
  const downloadSelectedSchoolProfile = useCallback(async () => {
    if (!selectedDashboardRow) return

    const insightSections = [
      {
        heading: 'Client Experience Story',
        lines: [selectedSchoolInsight?.summary || 'Client experience story is not available yet.'],
      },
      {
        heading: 'User Story',
        lines: selectedSchoolInsight?.qualitySignals || ['No user story signals available yet.'],
      },
      {
        heading: 'Client Struggles',
        lines: selectedSchoolInsight?.painPoints || ['No client struggle signals available yet.'],
      },
      {
        heading: 'Service Improvements',
        lines: selectedSchoolInsight?.concerns || ['No service improvement signals available yet.'],
      },
      {
        heading: 'Manager Next Moves',
        lines: selectedSchoolInsight?.importantDetails || ['No manager next moves available yet.'],
      },
    ]

    const sections: PdfSection[] = [
      {
        heading: 'Profile',
        lines: [
          `School: ${selectedDashboardRow.schoolName}`,
          `Primary contact: ${selectedDashboardRow.primaryContactName || 'Not available'}`,
          `Contact email: ${selectedDashboardRow.email || 'Not available'}`,
          `State: ${selectedDashboardRow.state}`,
          `Client type: ${formatClientType(selectedDashboardRow.clientType)}`,
          `Services: ${selectedDashboardRow.services}`,
          `Onboarding coordinator: ${selectedDashboardRow.onboardingCoordinator}`,
          `Health: ${selectedDashboardRow.healthRiskLevel} - ${selectedDashboardRow.healthRiskLabel}`,
        ],
      },
      ...insightSections,
      {
        heading: 'Readiness Snapshot',
        lines: [
          `Internal readiness: ${selectedInternalAverage === null ? 'Not submitted' : `${selectedInternalAverage.toFixed(1)}/5`}`,
          `External readiness: ${selectedExternalAverage === null ? 'Not submitted' : `${selectedExternalAverage.toFixed(1)}/5`}`,
        ],
      },
      {
        heading: 'Progress',
        lines: [
          `${Math.round(selectedDashboardRow.progressPercent)}% complete`,
          `${selectedDashboardRow.completedSteps} of ${selectedDashboardRow.totalSteps} steps complete`,
          `${selectedDashboardRow.outstandingSteps} steps outstanding`,
          `${selectedDashboardRow.pendingReviewCount} submissions pending review`,
          `${selectedDashboardRow.delayedSubmissionCount} delayed submissions`,
        ],
      },
      {
        heading: 'Support Areas',
        lines: [
          ...selectedUrgentTasks.slice(0, 5).map((task) => `Urgent: ${task.name}`),
          ...selectedUpcomingTasks.slice(0, 5).map((task) => `Due ${formatTaskDueDate(task.dueDate)}: ${task.name}`),
          ...(selectedUrgentTasks.length === 0 && selectedUpcomingTasks.length === 0 ? ['No urgent or due-soon tasks flagged.'] : []),
        ],
      },
      {
        heading: 'Open Tasks',
        lines: selectedIncompleteTasks.length > 0
          ? selectedIncompleteTasks.slice(0, 10).map((task) => `${task.clientStepNumber}. ${task.name} (${formatTaskDueDate(task.dueDate)})`)
          : ['No open tasks listed.'],
      },
      {
        heading: 'Recent Submissions',
        lines: selectedSchoolSubmissions.length > 0
          ? selectedSchoolSubmissions.slice(0, 8).map((submission) => `${submission.asanaTaskName}: ${submission.fileName} (${submission.status})`)
          : ['No submitted documents yet.'],
      },
    ]

    const logo = await loadVertexLogoForPdf()
    const blob = createClientProfilePdfBlob(`${selectedDashboardRow.schoolName} Client Profile`, sections, logo)
    downloadBlob(blob, `${sanitizeDownloadName(selectedDashboardRow.schoolName)}-client-profile.pdf`)
  }, [
    formatTaskDueDate,
    selectedDashboardRow,
    selectedExternalAverage,
    selectedIncompleteTasks,
    selectedInternalAverage,
    selectedSchoolInsight,
    selectedSchoolSubmissions,
    selectedUpcomingTasks,
    selectedUrgentTasks,
  ])
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
    setSchoolProfileTab('summary')
    setStaffMessageInput('')
    setStaffMessageError('')
  }, [selectedSchool])

  useEffect(() => {
    if (!selectedDashboardRow || schoolProfileTab !== 'messages') return
    void markStaffConversationRead(selectedDashboardRow.schoolName)
      .then(() => queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedDashboardRow.schoolName, 'staff'] }))
      .catch(() => {})
  }, [queryClient, schoolProfileTab, selectedDashboardRow, selectedStaffConversation?.lastMessageCreatedAt, selectedStaffConversation?.messages.length])

  useEffect(() => {
    if (!selectedDashboardRow) return

    let socket: WebSocket | null = null
    let closedByEffect = false
    let reconnectAttempt = 0
    const schoolName = selectedDashboardRow.schoolName

    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/api/conversations/ws?schoolName=${encodeURIComponent(schoolName)}`)

      socket.onopen = () => {
        reconnectAttempt = 0
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.schoolName === schoolName && payload?.channel === 'staff') {
            queryClient.invalidateQueries({ queryKey: ['school-conversation', schoolName, 'staff'] })
          }
        } catch {
          // Ignore non-JSON keepalive frames.
        }
      }

      socket.onclose = () => {
        if (closedByEffect) return
        reconnectAttempt += 1
        staffMessageReconnectTimerRef.current = setTimeout(connect, Math.min(1000 * reconnectAttempt, 5000))
      }
    }

    connect()

    return () => {
      closedByEffect = true
      if (staffMessageReconnectTimerRef.current) {
        clearTimeout(staffMessageReconnectTimerRef.current)
        staffMessageReconnectTimerRef.current = null
      }
      socket?.close()
    }
  }, [queryClient, selectedDashboardRow])

  useEffect(() => {
    setTaskActivityPage((page) => Math.min(page, taskActivityTotalPages))
  }, [taskActivityTotalPages])

  const handleSendStaffMessage = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedDashboardRow || !staffMessageInput.trim()) return

    const body = staffMessageInput.trim()
    setStaffMessageInput('')
    setStaffMessageError('')
    setStaffMessageSending(true)

    try {
      const response = await fetch('/api/conversations/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schoolName: selectedDashboardRow.schoolName,
          body,
        }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Unable to send message.')
      await queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedDashboardRow.schoolName, 'staff'] })
    } catch (err: any) {
      setStaffMessageInput(body)
      setStaffMessageError(err?.message || 'Unable to send message.')
    } finally {
      setStaffMessageSending(false)
    }
  }

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
      {copyToast && (
        <div className="fixed right-4 top-4 z-[70] rounded-xl border border-[var(--chip-line)] bg-white px-4 py-3 text-sm font-bold text-[var(--sea-ink)] shadow-xl">
          {copyToast}
        </div>
      )}
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

      <section className="mb-4 rounded-xl border border-[var(--vertex-blue)] bg-[var(--vertex-blue)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--vertex-gold)] text-[var(--vertex-blue)]">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--vertex-gold)]">Time Saved</div>
              <p className="text-lg font-black leading-7 text-white">
                {valueMetric.documentsCollected} documents collected - {valueMetric.tasksAutoSynced} tasks auto-synced to Asana - 0 manual handoffs
              </p>
            </div>
          </div>
          <div className="rounded-lg bg-[var(--vertex-gold)] px-3 py-2 text-sm font-extrabold text-[var(--vertex-blue)] sm:text-right">
            Est. {valueMetric.estimatedEmailsAvoided} emails avoided
          </div>
        </div>
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
            const scheduledNudgesEnabled = nudgeSettingsBySchool.get(row.schoolName)?.scheduledNudgesEnabled ?? true
            return (
            <div key={row.id} className="rounded-xl border border-[var(--chip-line)] bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedSchool(row.id)}
                      className="m-0 text-left text-base font-bold text-[var(--vertex-blue)] underline-offset-4 hover:underline"
                    >
                      {row.schoolName}
                    </button>
                    <button
                      type="button"
                      onClick={() => copyValue(row.id, 'School identifier')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--chip-line)] bg-white text-[var(--sea-ink-soft)] transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                      title={`Copy school identifier ${row.id}`}
                      aria-label={`Copy school identifier for ${row.schoolName}`}
                    >
                      <Copy size={13} aria-hidden="true" />
                    </button>
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
                  title={`View school profile for ${row.schoolName}`}
                  onClick={() => setSelectedSchool(row.id)}
                >
                  View School Profile
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
                const scheduledNudgesEnabled = nudgeSettingsBySchool.get(row.schoolName)?.scheduledNudgesEnabled ?? true
                return (
                <Fragment key={row.id}>
                  <TableRow className="border-t border-[var(--line)] transition hover:bg-neutral-50/50">
                    <TableCell colSpan={5} className="p-4 pb-2">
                      <div className="max-w-2xl">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedSchool(row.id)}
                            className="text-left text-base font-bold text-[var(--vertex-blue)] underline-offset-4 hover:underline"
                          >
                            {row.schoolName}
                          </button>
                          <button
                            type="button"
                            onClick={() => copyValue(row.id, 'School identifier')}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--chip-line)] bg-white text-[var(--sea-ink-soft)] transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                            title={`Copy school identifier ${row.id}`}
                            aria-label={`Copy school identifier for ${row.schoolName}`}
                          >
                            <Copy size={13} aria-hidden="true" />
                          </button>
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
                        title={`View school profile for ${row.schoolName}`}
                        onClick={() => setSelectedSchool(row.id)}
                      >
                        School Profile
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

      {/* School profile modal */}
      {selectedDashboardRow && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/45 px-3 py-6 backdrop-blur-sm sm:px-6 sm:py-10"
          role="dialog"
          aria-modal="true"
          aria-labelledby="school-profile-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedSchool(null)
          }}
        >
          <section className="w-full max-w-6xl rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex flex-col gap-4 border-b border-[var(--line)] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                  School Profile
                </p>
                <h2 id="school-profile-modal-title" className="mt-1 text-xl font-bold text-[var(--vertex-blue)]">
                  {selectedDashboardRow.schoolName}
                </h2>
                <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  LLM-synthesized readiness profile, onboarding progress, and operational concerns
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={downloadSelectedSchoolProfile}
                  disabled={selectedSchoolInsightLoading}
                  title={selectedSchoolInsightLoading ? 'Profile story is still loading' : 'Download this client profile as a PDF'}
                  className="gap-2"
                >
                  <Download size={15} aria-hidden="true" />
                  Download PDF
                </Button>
                <Button variant="outline" onClick={() => setSelectedSchool(null)}>
                  Close
                </Button>
              </div>
            </div>

            <div className="space-y-5 p-4 sm:p-6">
              <div
                className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--line)] bg-[var(--foam)] p-1 text-xs font-bold sm:inline-grid sm:grid-cols-4"
                role="tablist"
                aria-label="School profile details"
              >
                {[
                  ['summary', 'Summary'],
                  ['progress', 'Progress'],
                  ['activity', 'Activity'],
                  ['messages', 'Messages'],
                ].map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setSchoolProfileTab(tab as SchoolProfileModalTab)}
                    className={`rounded-lg px-3 py-2 transition ${schoolProfileTab === tab ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]'}`}
                    role="tab"
                    aria-selected={schoolProfileTab === tab}
                  >
                    {label}
                    {tab === 'messages' && (selectedStaffConversation?.unreadCount ?? 0) > 0 && (
                      <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--vertex-gold)] px-1.5 py-0.5 text-[9px] font-black text-white">
                        {selectedStaffConversation?.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {schoolProfileTab === 'summary' && (
                <section className="rounded-xl border border-[var(--line)] bg-[var(--foam)] p-4 sm:p-5">
                  <div className="mb-3 flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                    <Sparkles size={15} aria-hidden="true" />
                    Client experience story
                  </div>
                  {selectedSchoolInsightLoading ? (
                    <div className="space-y-3">
                      <SkeletonBlock className="h-4 w-full" />
                      <SkeletonBlock className="h-4 w-11/12" />
                      <SkeletonBlock className="h-4 w-3/4" />
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-semibold leading-6 text-[var(--sea-ink)]">
                        {selectedSchoolInsight?.summary || 'Profile summary is not available yet. Complete the intake questions to generate a stronger school profile.'}
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {[
                          ['User story', selectedSchoolInsight?.qualitySignals || []],
                          ['Client struggles', selectedSchoolInsight?.painPoints || []],
                          ['Service improvements', selectedSchoolInsight?.concerns || []],
                          ['Manager next moves', selectedSchoolInsight?.importantDetails || []],
                        ].map(([label, items]) => (
                          <div key={label as string} className="rounded-lg border border-[var(--chip-line)] bg-white p-3">
                            <h3 className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--vertex-gray)]">
                              {label as string}
                            </h3>
                            {(items as string[]).length > 0 ? (
                              <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">
                                {(items as string[]).map((item) => (
                                  <li key={item}>{item}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-2 text-xs font-semibold text-[var(--sea-ink-soft)]">No signal available yet.</p>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-[var(--chip-line)] bg-white p-3">
                          <h3 className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--vertex-gray)]">
                            Internal readiness
                          </h3>
                          <p className="mt-2 text-xl font-black text-[var(--vertex-blue)]">
                            {selectedInternalAverage === null ? 'Not submitted' : `${selectedInternalAverage.toFixed(1)}/5`}
                          </p>
                        </div>
                        <div className="rounded-lg border border-[var(--chip-line)] bg-white p-3">
                          <h3 className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--vertex-gray)]">
                            External readiness
                          </h3>
                          <p className="mt-2 text-xl font-black text-[var(--vertex-blue)]">
                            {selectedExternalAverage === null ? 'Not submitted' : `${selectedExternalAverage.toFixed(1)}/5`}
                          </p>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              )}

              {schoolProfileTab === 'progress' && (
                <section className="space-y-4 rounded-xl border border-[var(--line)] bg-white p-4 sm:p-5">
                  <div>
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                      Journey Progress
                    </h3>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <div className="font-display text-4xl font-black text-[var(--vertex-blue)]">
                          {Math.round(selectedDashboardRow.progressPercent)}%
                        </div>
                        <p className="text-xs font-semibold text-[var(--sea-ink-soft)]">
                          {selectedDashboardRow.completedSteps} of {selectedDashboardRow.totalSteps} steps complete
                        </p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${selectedDashboardRow.healthRiskLevel === 'Critical' ? 'bg-red-100 text-red-700' : selectedDashboardRow.healthRiskLevel === 'At Risk' ? 'bg-amber-100 text-amber-700' : selectedDashboardRow.healthRiskLevel === 'Complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--foam)] text-[var(--sea-ink-soft)]'}`}>
                        {selectedDashboardRow.healthRiskLevel}
                      </span>
                    </div>
                    <div className="mt-4 h-3 overflow-hidden rounded-full bg-neutral-200">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--vertex-blue)] to-[var(--vertex-gold)]"
                        style={{ width: `${selectedDashboardRow.progressPercent}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg bg-[var(--foam)] p-2">
                        <span className="block font-black text-[var(--vertex-blue)]">{profileStepCount}</span>
                        <span className="font-semibold text-[var(--sea-ink-soft)]">Profile</span>
                      </div>
                      <div className="rounded-lg bg-[var(--foam)] p-2">
                        <span className="block font-black text-[var(--vertex-blue)]">{Math.min(selectedIntake.completedStepIds.length, intakeStepCount)}/{intakeStepCount}</span>
                        <span className="font-semibold text-[var(--sea-ink-soft)]">Intake</span>
                      </div>
                      <div className="rounded-lg bg-[var(--foam)] p-2">
                        <span className="block font-black text-[var(--vertex-blue)]">{selectedSchoolTasks.filter((task) => task.completed).length}/{selectedSchoolTasks.length}</span>
                        <span className="font-semibold text-[var(--sea-ink-soft)]">Tasks</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[var(--line)] pt-4">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                      Key Areas Needing Support
                    </h3>
                    <div className="mt-3 space-y-2 text-xs font-semibold text-[var(--sea-ink-soft)]">
                      {selectedUrgentTasks.length === 0 && selectedUpcomingTasks.length === 0 && selectedDashboardRow.healthRiskLevel !== 'Critical' && selectedDashboardRow.healthRiskLevel !== 'At Risk' ? (
                        <p>No urgent tasks or upcoming deadlines are currently flagged.</p>
                      ) : (
                        <>
                          {(selectedDashboardRow.healthRiskLevel === 'Critical' || selectedDashboardRow.healthRiskLevel === 'At Risk') && (
                            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                              {selectedDashboardRow.healthRiskLabel}
                            </p>
                          )}
                          {selectedUrgentTasks.slice(0, 3).map((task) => (
                            <p key={`urgent-${task.id}`} className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-700">
                              Urgent: {task.name}
                            </p>
                          ))}
                          {selectedUpcomingTasks.slice(0, 3).map((task) => (
                            <p key={`upcoming-${task.id}`} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                              Due {formatTaskDueDate(task.dueDate)}: {task.name}
                            </p>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {schoolProfileTab === 'messages' && (
                <section className="flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-white">
                  <div className="border-b border-[var(--line)] bg-[var(--foam)] p-4">
                    <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">
                      Vertex Team Messages
                    </h3>
                    <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                      Direct conversation with {selectedDashboardRow.schoolName}. Messages persist with this school workspace.
                    </p>
                  </div>

                  <div className="flex-1 space-y-4 overflow-y-auto bg-[var(--foam)] p-4">
                    {selectedStaffConversationLoading ? (
                      <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
                        Loading messages...
                      </div>
                    ) : (selectedStaffConversation?.messages.length ?? 0) === 0 ? (
                      <div className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm font-semibold leading-6 text-[var(--sea-ink)]">
                        No messages yet. Send the first note to this school’s onboarding contacts.
                      </div>
                    ) : (
                      selectedStaffConversation?.messages.map((message) => {
                        const isMine = message.senderUserId === session?.user?.id
                        const label = message.senderName || message.senderEmail || (message.senderType === 'staff' ? 'Vertex Team' : 'Client')
                        return (
                          <div
                            key={message.id}
                            className={`flex max-w-[85%] flex-col ${isMine ? 'ml-auto items-end' : 'items-start'}`}
                          >
                            <div className={`rounded-2xl p-3 text-xs leading-relaxed ${isMine ? 'rounded-br-none bg-[var(--vertex-blue)] text-white' : 'rounded-bl-none border border-[var(--line)] bg-white text-[var(--sea-ink)] shadow-xxs'}`}>
                              {message.body}
                            </div>
                            <span className="mt-1 px-1 text-[9px] font-semibold text-[var(--sea-ink-soft)]">
                              {label} · {new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        )
                      })
                    )}
                    {staffMessageError && (
                      <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
                        {staffMessageError}
                      </div>
                    )}
                  </div>

                  <form onSubmit={handleSendStaffMessage} className="flex gap-2 border-t border-[var(--line)] bg-white p-3">
                    <input
                      type="text"
                      value={staffMessageInput}
                      onChange={(event) => setStaffMessageInput(event.target.value)}
                      placeholder="Reply to this school..."
                      className="min-w-0 flex-1 rounded-xl border border-[var(--chip-line)] bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--vertex-blue)]"
                    />
                    <Button type="submit" disabled={staffMessageSending || !staffMessageInput.trim()} className="gap-2">
                      <Send size={15} aria-hidden="true" />
                      {staffMessageSending ? 'Sending' : 'Send'}
                    </Button>
                  </form>
                </section>
              )}

              {schoolProfileTab === 'activity' && (
              <section className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:gap-8">
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
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-neutral-500">
                          <span>
                            File: <span className="font-mono text-neutral-700">{sub.fileName}</span> ({(sub.fileSize / 1024).toFixed(1)} KB)
                          </span>
                          <button
                            type="button"
                            onClick={() => copyValue(sub.fileName, 'Document file name')}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--chip-line)] bg-white text-neutral-500 transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                            title={`Copy file name ${sub.fileName}`}
                            aria-label={`Copy file name ${sub.fileName}`}
                          >
                            <Copy size={12} aria-hidden="true" />
                          </button>
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
                Task status has not been synced from Asana for this client yet.
              </p>
            )}
          </div>
              </section>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
