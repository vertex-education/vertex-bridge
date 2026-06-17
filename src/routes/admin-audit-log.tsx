import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Activity, Bot, ChevronLeft, ChevronRight, Download, ShieldCheck, X } from 'lucide-react'
import { getAuditLogData } from '#/lib/audit'
import { getServerRequest } from '#/lib/security'
import { AiDisclosure } from '#/components/AiDisclosure'

const auditCategoryOptions = ['account', 'ai', 'asana', 'file', 'hubspot', 'invite', 'notification', 'oauth', 'profile', 'review', 'upload']
const auditSurfaceOptions = ['admin', 'client', 'system', 'vertex']

type AuditSearch = {
  category: string
  surface: string
  actorRole: string
  schoolName: string
  query: string
  metric: string
  page: number
  pageSize: number
}

function parseAuditSearch(search: Record<string, unknown>): AuditSearch {
  return {
    category: typeof search.category === 'string' ? search.category : '',
    surface: typeof search.surface === 'string' ? search.surface : '',
    actorRole: typeof search.actorRole === 'string' ? search.actorRole : '',
    schoolName: typeof search.schoolName === 'string' ? search.schoolName : '',
    query: typeof search.query === 'string' ? search.query : '',
    metric: typeof search.metric === 'string' ? search.metric : '',
    page: Math.max(Number(search.page) || 1, 1),
    pageSize: [25, 50, 100].includes(Number(search.pageSize)) ? Number(search.pageSize) : 25,
  }
}

const getAuditAccess = createServerFn({ method: 'GET' }).handler(async () => {
  const { auth } = await import('#/lib/auth')
  const request = await getServerRequest()
  const session = await auth.api.getSession({
    headers: request.headers,
  })
  const role = session?.user ? (session.user as any).role : null

  return {
    isSignedIn: Boolean(session?.user),
    isStaff: role === 'admin' || role === 'vertex_user',
    isAdmin: role === 'admin',
    role,
  }
})

export const Route = createFileRoute('/admin-audit-log')({
  validateSearch: parseAuditSearch,
  beforeLoad: async ({ location }) => {
    const access = await getAuditAccess()

    if (!access.isSignedIn) {
      throw redirect({
        to: '/login',
        search: {
          redirect: location.href,
        },
      })
    }

    if (!access.isStaff) {
      throw redirect({
        to: '/school-onboarding',
      })
    }
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getAuditLogData({ data: deps }),
  component: AuditLogPage,
})

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLabel(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ') : 'n/a'
}

function formatRole(value: string | null | undefined) {
  if (value === 'vertex_user') return 'Vertex Staff'
  if (value === 'school_leader' || value === 'school_user') return 'School Leader'
  if (value === 'school_staff') return 'School Staff'
  if (value === 'admin') return 'Admin'
  return 'System'
}

function formatSurface(value: string | null | undefined) {
  if (value === 'client') return 'Client Portal'
  if (value === 'vertex') return 'Vertex Workspace'
  if (value === 'admin') return 'Admin Console'
  if (value === 'system') return 'System'
  return 'n/a'
}

function MetricCard({
  label,
  value,
  detail,
  active,
  onClick,
  icon,
  aiAssisted = false,
}: {
  label: string
  value: number | string
  detail: string
  active: boolean
  onClick: () => void
  icon: ReactNode
  aiAssisted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`app-card app-card-interactive rounded-xl p-4 text-left ${active ? 'app-card-active' : ''}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[var(--sea-ink-soft)]">
          {label}
          {aiAssisted && <AiDisclosure className="h-4 w-4" />}
        </span>
        <span className="text-[var(--vertex-blue)]">{icon}</span>
      </div>
      <div className="font-display text-3xl font-black text-[var(--vertex-blue)]">{value}</div>
      <p className="mt-1 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">{detail}</p>
    </button>
  )
}

function AuditLogPage() {
  const router = useRouter()
  const navigate = useNavigate({ from: '/admin-audit-log' })
  const search = Route.useSearch()
  const data = Route.useLoaderData()
  const [selectedSearchCategory, setSelectedSearchCategory] = useState('')
  const [selectedAuditEvent, setSelectedAuditEvent] = useState<any | null>(null)

  const setAuditSearch = (updates: Partial<AuditSearch>) => {
    navigate({
      search: {
        ...search,
        ...updates,
      },
    })
  }

  const setFilter = (updates: Partial<AuditSearch>) => setAuditSearch({ ...updates, page: 1 })

  const rows = data.rows || []
  const isAdmin = data.role === 'admin'
  const pagination = data.pagination
  const totalRows = pagination?.totalRows ?? 0
  const totalPages = pagination?.totalPages ?? 1
  const firstRow = totalRows === 0 ? 0 : ((pagination?.page ?? search.page) - 1) * (pagination?.pageSize ?? search.pageSize) + 1
  const lastRow = totalRows === 0 ? 0 : Math.min(firstRow + rows.length - 1, totalRows)
  const selectedTopSearch = (data.topSearches || []).find(item => item.category === selectedSearchCategory) || null
  const categoryOptions = useMemo(
    () => auditCategoryOptions.filter(option => isAdmin || (option !== 'oauth' && option !== 'admin')),
    [isAdmin],
  )
  const surfaceOptions = useMemo(
    () => auditSurfaceOptions.filter(option => isAdmin || option !== 'admin'),
    [isAdmin],
  )
  const changeMetric = (nextMetric: string) => {
    setFilter({ metric: nextMetric })
  }

  return (
    <main className="page-wrap page-shell">
      <div className="page-stack page-stack-wide page-section-gap">
        <div className="page-heading">
          <div className="page-kicker">Administration</div>
          <h1 className="page-title">Audit Log</h1>
          <p className="max-w-3xl text-sm leading-6 text-[var(--sea-ink-soft)]">
            Review admin activity, Vertex workflow actions, file access, Asana validation, and VertexAI chat/search usage.
          </p>
        </div>

        <section className={`grid gap-3 md:grid-cols-2 ${isAdmin ? 'xl:grid-cols-6' : 'xl:grid-cols-5'}`}>
          <MetricCard
            label="Actions Today"
            value={data.metrics.totalActionsToday ?? 0}
            detail="Audit entries logged since midnight"
            active={!search.metric}
            onClick={() => changeMetric('')}
            icon={<Activity size={20} />}
          />
          <MetricCard
            label="AI Inferences"
            value={data.metrics.aiUsage ?? 0}
            detail={`Avg ${data.metrics.avgAILatencyMs ?? 0}ms`}
            active={search.metric === 'ai-usage'}
            onClick={() => changeMetric(search.metric === 'ai-usage' ? '' : 'ai-usage')}
            icon={<Bot size={20} />}
            aiAssisted
          />
          <MetricCard
            label="Documents Reviewed"
            value={data.metrics.documentsReviewed ?? 0}
            detail="Reviewed document events"
            active={search.metric === 'pending-review'}
            onClick={() => {
              changeMetric(search.metric === 'pending-review' ? '' : 'pending-review')
            }}
            icon={<ShieldCheck size={20} />}
          />
          <MetricCard
            label="File Opens"
            value={data.metrics.fileOpens ?? 0}
            detail="Document access events"
            active={search.metric === 'file-opens'}
            onClick={() => changeMetric(search.metric === 'file-opens' ? '' : 'file-opens')}
            icon={<Download size={20} />}
          />
          {isAdmin && (
            <MetricCard
              label="Admin"
              value={data.metrics.adminActions ?? 0}
              detail="Admin-only actions"
              active={search.metric === 'admin-actions'}
              onClick={() => changeMetric(search.metric === 'admin-actions' ? '' : 'admin-actions')}
              icon={<ShieldCheck size={20} />}
            />
          )}
          <MetricCard
            label="Shown"
            value={totalRows}
            detail="Rows after filters"
            active={false}
            onClick={() => {
              setAuditSearch({
                category: '',
                surface: '',
                actorRole: '',
                schoolName: '',
                query: '',
                metric: '',
                page: 1,
                pageSize: search.pageSize,
              })
            }}
            icon={<Activity size={20} />}
          />
        </section>

        <section className="app-card rounded-2xl p-4 sm:p-5">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
            <div className="relative">
              <input
                value={search.query}
                onChange={(event) => {
                  setFilter({ query: event.target.value })
                }}
                placeholder="Filter actor, school, action, or exact VertexAI search..."
                className="min-h-10 w-full rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 pr-11 text-sm font-semibold text-[var(--sea-ink)] outline-none focus:ring-2 focus:ring-[var(--vertex-blue)]"
              />
              {search.query && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter({ query: '' })
                  }}
                  className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--sea-ink-soft)] transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                  aria-label="Clear audit search"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => router.invalidate()}
              className="rounded-xl bg-[var(--vertex-blue)] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--lagoon-deep)]"
            >
              Refresh
            </button>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <select value={search.category} onChange={(event) => {
              const nextCategory = event.target.value
              setFilter({ category: nextCategory, query: nextCategory ? search.query : '' })
            }} className="rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-semibold">
              <option value="">All categories</option>
              {categoryOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={search.surface} onChange={(event) => {
              setFilter({ surface: event.target.value })
            }} className="rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-semibold">
              <option value="">All surfaces</option>
              {surfaceOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
            <select value={search.actorRole} onChange={(event) => {
              setFilter({ actorRole: event.target.value })
            }} className="rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-semibold">
              <option value="">All roles</option>
              <option value="admin">Admin</option>
              <option value="vertex_user">Vertex Staff</option>
              <option value="school_leader">School Leader</option>
              <option value="school_staff">School Staff</option>
            </select>
            <select value={search.schoolName} onChange={(event) => {
              setFilter({ schoolName: event.target.value })
            }} className="rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-semibold">
              <option value="">All schools</option>
              {data.schoolOptions.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="app-card rounded-2xl p-5">
            <h2 className="mb-1 flex items-center gap-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
              Top 5 Search Categories
              <AiDisclosure />
            </h2>
            <p className="mb-4 text-xs font-semibold leading-5 text-[var(--sea-ink-soft)]">
              Similar VertexAI prompts are grouped by topic. Open a category to review the exact searches.
            </p>
            <div className="space-y-3">
              {(data?.topSearches || []).map((item) => (
                <button
                  key={item.category}
                  type="button"
                  onClick={() => setSelectedSearchCategory(item.category)}
                  className="w-full rounded-xl border border-[var(--chip-line)] bg-white p-3 text-left transition hover:bg-[var(--foam)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--sea-ink)]">
                      {item.category}
                      <AiDisclosure className="h-4 w-4" />
                    </span>
                    <span className="rounded-full bg-[var(--vertex-gold)] px-2 py-0.5 text-xs font-black text-[var(--vertex-blue)]">{item.count}</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-[var(--sea-ink-soft)]">
                    {item.exactSearchCount} exact {item.exactSearchCount === 1 ? 'search' : 'searches'} - Last searched {formatDate(item.lastSearchedAt)}
                  </div>
                </button>
              ))}
              {(data?.topSearches || []).length === 0 && (
                <p className="rounded-xl border border-dashed border-[var(--chip-line)] bg-white p-4 text-sm font-semibold text-[var(--sea-ink-soft)]">
                  No VertexAI searches have been logged yet.
                </p>
              )}
            </div>
          </div>

          <div className="app-card rounded-2xl p-5">
            <h2 className="mb-4 flex items-center gap-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
              AI Inference Categories
              <AiDisclosure />
            </h2>
            <div className="space-y-3">
              {(data?.aiCategoryCounts || []).map((item) => (
                <button
                  key={item.category}
                  type="button"
                  onClick={() => {
                    setFilter({ category: 'ai', query: item.category })
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--chip-line)] bg-white px-3 py-2 text-sm font-bold text-[var(--sea-ink)] transition hover:bg-[var(--foam)]"
                >
                  <span className="inline-flex items-center gap-1.5">
                    {item.category}
                    <AiDisclosure className="h-4 w-4" />
                  </span>
                  <span className="text-[var(--vertex-blue)]">{item.count}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="app-card overflow-hidden rounded-2xl">
          <div className="border-b border-[var(--line)] p-5">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <h2 className="font-display text-xl font-bold text-[var(--vertex-blue)]">Event Details</h2>
                <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  Admins see the combined audit log. Vertex staff see a restricted log without admin-only functions such as OAuth.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-[var(--sea-ink-soft)]">
                <span>
                  {firstRow}-{lastRow} of {totalRows}
                </span>
                <select
                  value={search.pageSize}
                  onChange={(event) => {
                    setAuditSearch({ ...search, pageSize: Number(event.target.value), page: 1 })
                  }}
                  className="rounded-lg border border-[var(--chip-line)] bg-white px-2 py-1.5 text-xs font-bold text-[var(--sea-ink)]"
                  aria-label="Audit events per page"
                >
                  <option value={25}>25 / page</option>
                  <option value={50}>50 / page</option>
                  <option value={100}>100 / page</option>
                </select>
              </div>
            </div>
          </div>

          <div className="divide-y divide-[var(--line)]">
            {rows.length === 0 ? (
              <p className="p-5 text-sm font-semibold text-[var(--sea-ink-soft)]">No audit events match the current filters.</p>
            ) : rows.map((row) => (
              <article key={row.id} className={`grid gap-4 bg-white p-5 lg:grid-cols-[180px_minmax(0,1fr)_260px] ${row.category === 'ai' ? 'border-l-4 border-l-[var(--vertex-gold)]' : ''}`}>
                <div>
                  <div className="text-xs font-black uppercase tracking-wide text-[var(--vertex-blue)]">{formatLabel(row.action)}</div>
                  <div className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">{formatDate(row.occurredAt)}</div>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-6 text-[var(--sea-ink)]">{row.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-[var(--foam)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">
                      {formatSurface(row.surface)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--foam)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">
                      {row.aiInferenceCategory || formatLabel(row.category)}
                      {row.aiInferenceCategory && <AiDisclosure className="h-4 w-4" />}
                    </span>
                    {row.schoolName && (
                      <span className="rounded-full bg-[var(--foam)] px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">
                        {row.schoolName}
                      </span>
                    )}
                  </div>
                  {row.searchQuery && (
                    <div className="mt-3 rounded-xl border border-[var(--chip-line)] bg-[var(--foam)] p-3">
                      <div className="text-[10px] font-black uppercase tracking-wide text-[var(--sea-ink-soft)]">Exact VertexAI Search</div>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[var(--sea-ink)]">{row.searchQuery}</p>
                    </div>
                  )}
                  {row.category === 'ai' && (
                    <details className="mt-3 rounded-xl border border-[var(--vertex-gold)] bg-amber-50/70 p-3">
                      <summary className="cursor-pointer text-xs font-black uppercase tracking-wide text-[var(--vertex-blue)]">
                        AI inference details
                      </summary>
                      <dl className="mt-3 grid gap-2 text-xs font-semibold text-[var(--sea-ink-soft)] sm:grid-cols-3">
                        <div>
                          <dt className="font-black text-[var(--sea-ink)]">Model</dt>
                          <dd className="break-words">{row.aiModel || 'n/a'}</dd>
                        </div>
                        <div>
                          <dt className="font-black text-[var(--sea-ink)]">Category</dt>
                          <dd>{row.aiInferenceCategory || 'n/a'}</dd>
                        </div>
                        <div>
                          <dt className="font-black text-[var(--sea-ink)]">Latency</dt>
                          <dd>{row.aiLatencyMs ?? 'n/a'}{row.aiLatencyMs === null || row.aiLatencyMs === undefined ? '' : 'ms'}</dd>
                        </div>
                      </dl>
                    </details>
                  )}
                  {(row.metadata || row.aiModel || row.aiDiagnostic || row.aiLatencyMs || row.entityType || row.entityId) && (
                    <button
                      type="button"
                      onClick={() => setSelectedAuditEvent(row)}
                      className="mt-3 rounded-xl border border-[var(--chip-line)] px-3 py-2 text-xs font-bold text-[var(--vertex-blue)] transition hover:bg-[var(--foam)]"
                    >
                      {row.category === 'ai' ? 'View AI inference details' : 'View technical details'}
                    </button>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs font-semibold text-[var(--sea-ink-soft)] lg:grid-cols-1">
                  <div><dt className="font-black text-[var(--sea-ink)]">Actor</dt><dd className="break-words">{row.actorName || row.actorEmail || 'System'}</dd></div>
                  <div><dt className="font-black text-[var(--sea-ink)]">Role</dt><dd>{formatRole(row.actorRole)}</dd></div>
                  <div><dt className="font-black text-[var(--sea-ink)]">Where</dt><dd>{formatSurface(row.surface)}</dd></div>
                  <div>
                    <dt className="font-black text-[var(--sea-ink)]">Category</dt>
                    <dd className="inline-flex items-center gap-1.5">
                      {row.aiInferenceCategory || row.category}
                      {row.aiInferenceCategory && <AiDisclosure className="h-4 w-4" />}
                    </dd>
                  </div>
                  <div><dt className="font-black text-[var(--sea-ink)]">School</dt><dd>{row.schoolName || 'n/a'}</dd></div>
                </dl>
              </article>
            ))}
          </div>

          {totalRows > 0 && (
            <div className="flex flex-col gap-3 border-t border-[var(--line)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-bold text-[var(--sea-ink-soft)]">
                Page {pagination?.page ?? search.page} of {totalPages}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditSearch({ page: Math.max(search.page - 1, 1) })}
                  disabled={!pagination?.hasPreviousPage}
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--chip-line)] px-3 py-2 text-xs font-bold text-[var(--sea-ink)] transition hover:bg-[var(--foam)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setAuditSearch({ page: Math.min(search.page + 1, totalPages) })}
                  disabled={!pagination?.hasNextPage}
                  className="inline-flex items-center gap-1 rounded-xl border border-[var(--chip-line)] px-3 py-2 text-xs font-bold text-[var(--sea-ink)] transition hover:bg-[var(--foam)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      {selectedTopSearch && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[min(680px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-5">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-[var(--vertex-gold)]">Search Category Drill Through</div>
                <h2 className="mt-1 flex items-center gap-2 font-display text-xl font-bold text-[var(--vertex-blue)]">
                  {selectedTopSearch.category}
                  <AiDisclosure />
                </h2>
                <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  {selectedTopSearch.count} total searches across {selectedTopSearch.exactSearchCount} exact {selectedTopSearch.exactSearchCount === 1 ? 'prompt' : 'prompts'}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSearchCategory('')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--chip-line)] text-lg font-bold text-[var(--sea-ink-soft)] transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                aria-label="Close search category drill through"
              >
                ×
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto bg-[var(--foam)] p-4">
              {selectedTopSearch.exactSearches.map((exactSearch) => (
                <button
                  key={exactSearch.query}
                  type="button"
                  onClick={() => {
                    setFilter({ category: 'ai', query: exactSearch.query })
                    setSelectedSearchCategory('')
                  }}
                  className="w-full rounded-xl border border-[var(--chip-line)] bg-white p-3 text-left transition hover:border-[var(--vertex-blue)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="break-words text-sm font-bold text-[var(--sea-ink)]">{exactSearch.query}</span>
                    <span className="shrink-0 rounded-full bg-[var(--vertex-gold)] px-2 py-0.5 text-xs font-black text-[var(--vertex-blue)]">{exactSearch.count}</span>
                  </div>
                  <div className="mt-2 text-xs font-semibold text-[var(--sea-ink-soft)]">
                    Last searched {formatDate(exactSearch.lastSearchedAt)}
                  </div>
                </button>
              ))}
            </div>

            <div className="border-t border-[var(--line)] bg-white p-4 text-right">
              <button
                type="button"
                onClick={() => setSelectedSearchCategory('')}
                className="rounded-xl border border-[var(--chip-line)] px-4 py-2 text-sm font-bold text-[var(--sea-ink)] transition hover:bg-[var(--foam)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedAuditEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] p-5">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-[var(--vertex-gold)]">Technical Audit Details</div>
                <h2 className="mt-1 font-display text-xl font-bold text-[var(--vertex-blue)]">{formatLabel(selectedAuditEvent.action)}</h2>
                <p className="mt-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  {formatDate(selectedAuditEvent.occurredAt)} · {formatSurface(selectedAuditEvent.surface)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuditEvent(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--chip-line)] text-lg font-bold text-[var(--sea-ink-soft)] transition hover:bg-[var(--foam)] hover:text-[var(--vertex-blue)]"
                aria-label="Close technical audit details"
              >
                ×
              </button>
            </div>

            <div className="grid gap-4 overflow-y-auto bg-[var(--foam)] p-4 md:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-xl border border-[var(--chip-line)] bg-white p-4">
                <h3 className="text-xs font-black uppercase tracking-wide text-[var(--sea-ink)]">Readable Summary</h3>
                <dl className="mt-3 space-y-3 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  <div><dt className="font-black text-[var(--sea-ink)]">Actor</dt><dd>{selectedAuditEvent.actorName || selectedAuditEvent.actorEmail || 'System'}</dd></div>
                  <div><dt className="font-black text-[var(--sea-ink)]">Role</dt><dd>{formatRole(selectedAuditEvent.actorRole)}</dd></div>
                  <div>
                    <dt className="font-black text-[var(--sea-ink)]">Category</dt>
                    <dd className="inline-flex items-center gap-1.5">
                      {selectedAuditEvent.aiInferenceCategory || selectedAuditEvent.category}
                      {selectedAuditEvent.aiInferenceCategory && <AiDisclosure className="h-4 w-4" />}
                    </dd>
                  </div>
                  <div><dt className="font-black text-[var(--sea-ink)]">School</dt><dd>{selectedAuditEvent.schoolName || 'n/a'}</dd></div>
                  {selectedAuditEvent.searchQuery && (
                    <div><dt className="font-black text-[var(--sea-ink)]">Exact VertexAI Search</dt><dd className="whitespace-pre-wrap break-words">{selectedAuditEvent.searchQuery}</dd></div>
                  )}
                  {selectedAuditEvent.aiModel && (
                    <div><dt className="font-black text-[var(--sea-ink)]">AI Model</dt><dd className="break-words">{selectedAuditEvent.aiModel}</dd></div>
                  )}
                  {selectedAuditEvent.aiInferenceCategory && (
                    <div><dt className="font-black text-[var(--sea-ink)]">AI Category</dt><dd>{selectedAuditEvent.aiInferenceCategory}</dd></div>
                  )}
                  {selectedAuditEvent.aiLatencyMs !== null && selectedAuditEvent.aiLatencyMs !== undefined && (
                    <div><dt className="font-black text-[var(--sea-ink)]">AI Latency</dt><dd>{selectedAuditEvent.aiLatencyMs}ms</dd></div>
                  )}
                </dl>
              </div>

              <div className="min-w-0 rounded-xl border border-[var(--chip-line)] bg-white p-4">
                <h3 className="text-xs font-black uppercase tracking-wide text-[var(--sea-ink)]">JSON Details</h3>
                <pre className="mt-3 max-h-[420px] overflow-auto rounded-xl bg-neutral-950 p-3 text-xs leading-5 text-white">
                  {JSON.stringify({
                    id: selectedAuditEvent.id,
                    occurredAt: selectedAuditEvent.occurredAt,
                    action: selectedAuditEvent.action,
                    surface: selectedAuditEvent.surface,
                    category: selectedAuditEvent.category,
                    entityType: selectedAuditEvent.entityType,
                    entityId: selectedAuditEvent.entityId,
                    schoolName: selectedAuditEvent.schoolName,
                    clientEmail: selectedAuditEvent.clientEmail,
                    searchQuery: selectedAuditEvent.searchQuery,
                    aiInferenceCategory: selectedAuditEvent.aiInferenceCategory,
                    aiModel: selectedAuditEvent.aiModel,
                    aiDiagnostic: selectedAuditEvent.aiDiagnostic,
                    aiLatencyMs: selectedAuditEvent.aiLatencyMs,
                    metadata: selectedAuditEvent.metadata,
                  }, null, 2)}
                </pre>
              </div>
            </div>

            <div className="border-t border-[var(--line)] bg-white p-4 text-right">
              <button
                type="button"
                onClick={() => setSelectedAuditEvent(null)}
                className="rounded-xl border border-[var(--chip-line)] px-4 py-2 text-sm font-bold text-[var(--sea-ink)] transition hover:bg-[var(--foam)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
