import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, gte, like, ne, or } from 'drizzle-orm'
import { count } from 'drizzle-orm/sql/functions/aggregate'
import type { AppSession } from './security'

type AuditSurface = 'admin' | 'vertex' | 'client' | 'system'

type AuditEventInput = {
  session?: AppSession | null
  request?: Request
  surface: AuditSurface
  category: string
  action: string
  message: string
  entityType?: string | null
  entityId?: string | null
  schoolName?: string | null
  clientEmail?: string | null
  searchQuery?: string | null
  aiInferenceCategory?: string | null
  aiModel?: string | null
  aiDiagnostic?: string | null
  aiLatencyMs?: number | null
  metadata?: Record<string, unknown> | null
}

type AuditLogFilters = {
  category?: string
  surface?: string
  actorRole?: string
  schoolName?: string
  query?: string
  metric?: string
  page?: number
  pageSize?: number
}

const adminOnlyCategories = new Set(['oauth', 'admin'])

export function inferAIQueryCategory(query: string) {
  const normalized = query.toLowerCase()

  if (/(upload|file|document|pdf|excel|spreadsheet|wrong file|too large)/.test(normalized)) {
    return 'Document upload'
  }
  if (/(step|task|complete|done|progress|status|next)/.test(normalized)) {
    return 'Onboarding progress'
  }
  if (/(due|deadline|urgent|late|when)/.test(normalized)) {
    return 'Timing and priority'
  }
  if (/(bank|check|routing|account|payroll|tax|legal|contract|compliance|budget)/.test(normalized)) {
    return 'Guardrailed finance'
  }
  if (/(asana|vertex|contact|support|review|who)/.test(normalized)) {
    return 'Vertex workflow'
  }

  return 'General onboarding'
}

function inferAISearchTopic(query: string, fallbackCategory: string) {
  const normalized = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return fallbackCategory

  if (/\b(who|what)\s+(is|are)\s+(vertex|vertex education)\b/.test(normalized) || /\bvertex education\b/.test(normalized)) {
    return 'Who is Vertex Education'
  }
  if (/\b(who|what)\s+(is|are)\s+(vertex bridge|portal|this portal)\b/.test(normalized) || /\bvertex bridge\b/.test(normalized)) {
    return 'What is Vertex Bridge'
  }
  if (/\b(sfo|school finance operations)\b/.test(normalized)) {
    return 'What is SFO'
  }
  if (/\b(file type|file types|accepted|accept|csv|pdf|excel|spreadsheet|word|png|jpg|jpeg)\b/.test(normalized)) {
    return 'Accepted upload file types'
  }
  if (/\b(upload|submit|document|file)\b/.test(normalized) && /\b(wrong|replace|different|correct|fix)\b/.test(normalized)) {
    return 'Correcting an uploaded file'
  }
  if (/\b(upload|submit|document|file)\b/.test(normalized)) {
    return 'How to upload documents'
  }
  if (/\b(next|after|do next|what now)\b/.test(normalized)) {
    return 'Next onboarding step'
  }
  if (/\b(progress|status|complete|completed|done)\b/.test(normalized)) {
    return 'Onboarding progress'
  }
  if (/\b(due|deadline|urgent|late|when)\b/.test(normalized)) {
    return 'Timing and priority'
  }
  if (/\b(bank|voided check|check|routing|account)\b/.test(normalized)) {
    return 'Bank documentation'
  }
  if (/\b(payroll|ytd|year to date)\b/.test(normalized)) {
    return 'Payroll documentation'
  }
  if (/\b(budget|board approved)\b/.test(normalized)) {
    return 'Budget documentation'
  }
  if (/\b(asana)\b/.test(normalized)) {
    return 'Asana workflow'
  }
  if (/\b(contact|support|review|who reviews|help)\b/.test(normalized)) {
    return 'Vertex support and review'
  }

  return fallbackCategory
}

function getHeaderValue(request: Request | undefined, name: string) {
  return request?.headers.get(name) || null
}

function getIpAddress(request: Request | undefined) {
  return getHeaderValue(request, 'cf-connecting-ip') || getHeaderValue(request, 'x-forwarded-for')
}

function serializeMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return null
  return JSON.stringify(metadata)
}

export async function recordAuditEvent(input: AuditEventInput) {
  try {
    const { db } = await import('#/db')
    const { auditLog } = await import('#/db/schema')
    const session = input.session
    const request = input.request

    await db.insert(auditLog).values({
      id: crypto.randomUUID(),
      occurredAt: new Date(),
      actorUserId: session?.user.id || null,
      actorEmail: session?.user.email || null,
      actorName: session?.user.name || null,
      actorRole: session?.user ? ((session.user as any).role || null) : null,
      surface: input.surface,
      category: input.category,
      action: input.action,
      message: input.message,
      entityType: input.entityType || null,
      entityId: input.entityId || null,
      schoolName: input.schoolName || null,
      clientEmail: input.clientEmail || null,
      searchQuery: input.searchQuery || null,
      aiInferenceCategory: input.aiInferenceCategory || null,
      aiModel: input.aiModel || null,
      aiDiagnostic: input.aiDiagnostic || null,
      aiLatencyMs: input.aiLatencyMs ?? null,
      metadata: serializeMetadata(input.metadata),
      ipAddress: getIpAddress(request),
      userAgent: getHeaderValue(request, 'user-agent'),
    }).run()
  } catch (err) {
    console.error('Audit logging failed:', err)
  }
}

function isVertexVisible(row: { category: string; surface: string }) {
  return row.surface !== 'admin' && !adminOnlyCategories.has(row.category)
}

function parseMetadata(metadata: string | null) {
  if (!metadata) return null
  try {
    return JSON.parse(metadata)
  } catch {
    return null
  }
}

function getMetricWhereClause(auditLog: typeof import('#/db/schema').auditLog, metric?: string) {
  if (metric === 'ai-usage') {
    return eq(auditLog.category, 'ai')
  }
  if (metric === 'file-opens') {
    return eq(auditLog.action, 'file_opened')
  }
  if (metric === 'pending-review') {
    return or(eq(auditLog.action, 'file_reviewed'), eq(auditLog.category, 'review'))
  }
  if (metric === 'admin-actions') {
    return or(eq(auditLog.surface, 'admin'), eq(auditLog.category, 'oauth'), eq(auditLog.category, 'admin'))
  }

  return undefined
}

export const getAuditLogData = createServerFn({ method: 'GET' })
  .validator((filters: AuditLogFilters | undefined) => filters || {})
  .handler(async ({ data: filters }) => {
    const { db } = await import('#/db')
    const { auditLog } = await import('#/db/schema')
    const { requireStaffSession, getUserRole } = await import('./security')
    const session = await requireStaffSession()
    const role = getUserRole(session)
    const scope = role === 'admin' ? 'all' : 'vertex'
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const pageSize = Math.min(Math.max(Number(filters.pageSize) || 25, 10), 100)
    const page = Math.max(Number(filters.page) || 1, 1)
    const offset = (page - 1) * pageSize

    const whereClauses = []
    if (filters.category) whereClauses.push(eq(auditLog.category, filters.category))
    if (filters.surface) whereClauses.push(eq(auditLog.surface, filters.surface))
    if (filters.actorRole) whereClauses.push(eq(auditLog.actorRole, filters.actorRole))
    if (filters.schoolName) whereClauses.push(eq(auditLog.schoolName, filters.schoolName))
    if (filters.query?.trim()) {
      const needle = `%${filters.query.trim()}%`
      whereClauses.push(or(
        like(auditLog.message, needle),
        like(auditLog.actorEmail, needle),
        like(auditLog.schoolName, needle),
        like(auditLog.clientEmail, needle),
        like(auditLog.searchQuery, needle),
        like(auditLog.aiInferenceCategory, needle),
      ))
    }
    const metricWhereClause = getMetricWhereClause(auditLog, filters.metric)
    if (metricWhereClause) whereClauses.push(metricWhereClause)
    if (scope === 'vertex') {
      whereClauses.push(ne(auditLog.surface, 'admin'))
      whereClauses.push(ne(auditLog.category, 'oauth'))
      whereClauses.push(ne(auditLog.category, 'admin'))
    }

    const whereClause = whereClauses.length ? and(...whereClauses) : undefined
    const [{ value: totalRows }] = await db
      .select({ value: count() })
      .from(auditLog)
      .where(whereClause)
      .all()

    const baseRows = await db
      .select()
      .from(auditLog)
      .where(whereClause)
      .orderBy(desc(auditLog.occurredAt))
      .limit(pageSize)
      .offset(offset)
      .all()

    const visibleRows = scope === 'vertex' ? baseRows.filter(isVertexVisible) : baseRows
    const rows = visibleRows.map(row => ({
      ...row,
      metadata: parseMetadata(row.metadata),
      occurredAt: row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString(),
    }))

    const recentRows = await db
      .select()
      .from(auditLog)
      .where(gte(auditLog.occurredAt, thirtyDaysAgo))
      .orderBy(desc(auditLog.occurredAt))
      .limit(1000)
      .all()
    const metricRows = scope === 'vertex' ? recentRows.filter(isVertexVisible) : recentRows
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayActionCount = metricRows.filter((row) => {
      const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
      return occurredAt >= todayStart
    }).length
    const aiRows = metricRows.filter(row => row.category === 'ai')
    const searchRows = aiRows.filter(row => row.searchQuery)
    const categoryCounts = new Map<string, number>()
    const exactQueryCounts = new Map<string, {
      query: string
      count: number
      aiInferenceCategory: string
      lastSearchedAt: string
    }>()
    const topicCounts = new Map<string, {
      category: string
      count: number
      exactSearchCount: number
      aiInferenceCategory: string
      lastSearchedAt: string
      exactSearches: Array<{
        query: string
        count: number
        lastSearchedAt: string
      }>
    }>()

    for (const row of searchRows) {
      const category = row.aiInferenceCategory || 'Uncategorized'
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1)

      const query = row.searchQuery || ''
      const key = query.toLowerCase()
      const occurredAt = row.occurredAt instanceof Date ? row.occurredAt.toISOString() : new Date(row.occurredAt).toISOString()
      const existing = exactQueryCounts.get(key)
      if (existing) {
        existing.count += 1
        existing.lastSearchedAt = existing.lastSearchedAt > occurredAt ? existing.lastSearchedAt : occurredAt
      } else {
        exactQueryCounts.set(key, {
          query,
          count: 1,
          aiInferenceCategory: category,
          lastSearchedAt: occurredAt,
        })
      }
    }

    for (const exactSearch of exactQueryCounts.values()) {
      const topic = inferAISearchTopic(exactSearch.query, exactSearch.aiInferenceCategory)
      const existing = topicCounts.get(topic)
      if (existing) {
        existing.count += exactSearch.count
        existing.exactSearchCount += 1
        existing.lastSearchedAt = existing.lastSearchedAt > exactSearch.lastSearchedAt ? existing.lastSearchedAt : exactSearch.lastSearchedAt
        existing.exactSearches.push({
          query: exactSearch.query,
          count: exactSearch.count,
          lastSearchedAt: exactSearch.lastSearchedAt,
        })
      } else {
        topicCounts.set(topic, {
          category: topic,
          count: exactSearch.count,
          exactSearchCount: 1,
          aiInferenceCategory: exactSearch.aiInferenceCategory,
          lastSearchedAt: exactSearch.lastSearchedAt,
          exactSearches: [{
            query: exactSearch.query,
            count: exactSearch.count,
            lastSearchedAt: exactSearch.lastSearchedAt,
          }],
        })
      }
    }

    return {
      scope,
      role,
      metrics: {
        totalEvents: metricRows.length,
        totalActionsToday: todayActionCount,
        aiUsage: aiRows.length,
        documentsReviewed: metricRows.filter(row => row.action === 'file_reviewed' || row.category === 'review').length,
        fileOpens: metricRows.filter(row => row.action === 'file_opened').length,
        adminActions: metricRows.filter(row => row.surface === 'admin' || adminOnlyCategories.has(row.category)).length,
        uniqueSearches: exactQueryCounts.size,
        avgAILatencyMs: aiRows.length
          ? Math.round(aiRows.reduce((sum, row) => sum + (row.aiLatencyMs || 0), 0) / aiRows.length)
          : 0,
      },
      topSearches: Array.from(topicCounts.values())
        .map(item => ({
          ...item,
          exactSearches: item.exactSearches.sort((a, b) => b.count - a.count || b.lastSearchedAt.localeCompare(a.lastSearchedAt)),
        }))
        .sort((a, b) => b.count - a.count || b.lastSearchedAt.localeCompare(a.lastSearchedAt))
        .slice(0, 5),
      aiCategoryCounts: Array.from(categoryCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count),
      schoolOptions: Array.from(new Set(metricRows.map(row => row.schoolName).filter((schoolName): schoolName is string => Boolean(schoolName))))
        .sort((a, b) => a.localeCompare(b)),
      pagination: {
        page,
        pageSize,
        totalRows,
        totalPages: Math.max(Math.ceil(totalRows / pageSize), 1),
        hasPreviousPage: page > 1,
        hasNextPage: page * pageSize < totalRows,
      },
      rows,
    }
  })
