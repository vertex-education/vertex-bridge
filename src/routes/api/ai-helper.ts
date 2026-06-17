import { createFileRoute } from '@tanstack/react-router'
import { getAIHelperResponse, type AskAIHelperInput } from '#/lib/ai'
import { assertTrustedOrigin } from '#/lib/security'

const rateLimitWindowMs = 60_000
const maxRequestsPerWindow = 20
const requestCounts = new Map<string, { count: number; resetAt: number }>()

function getClientIp(request: Request) {
  return request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown'
}

function assertWithinRateLimit(key: string) {
  const now = Date.now()
  const current = requestCounts.get(key)
  if (!current || current.resetAt <= now) {
    requestCounts.set(key, { count: 1, resetAt: now + rateLimitWindowMs })
    return
  }

  if (current.count >= maxRequestsPerWindow) {
    throw new Error('rate-limit')
  }

  current.count += 1
}

export const Route = createFileRoute('/api/ai-helper')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await assertTrustedOrigin(request)
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({
            headers: request.headers,
          })
          if (!session?.user) {
            return Response.json(
              {
                text: 'Please sign in to use VertexAI.',
                isFallback: false,
                model: 'vertexai-auth-required',
                diagnostic: null,
              },
              { status: 401 },
            )
          }

          assertWithinRateLimit(`${session.user.id}:${getClientIp(request)}`)

          const data = await request.json() as AskAIHelperInput
          const startedAt = Date.now()
          const response = await getAIHelperResponse(data)
          const { inferAIQueryCategory, recordAuditEvent } = await import('#/lib/audit')
          const aiInferenceCategory = inferAIQueryCategory(data.query || '')
          await recordAuditEvent({
            session,
            request,
            surface: 'client',
            category: 'ai',
            action: 'vertexai_chat_used',
            message: `${session.user.email} asked VertexAI: ${data.query}`,
            entityType: 'vertexai_chat',
            searchQuery: data.query,
            aiInferenceCategory,
            aiModel: response.model,
            aiDiagnostic: response.diagnostic,
            aiLatencyMs: Date.now() - startedAt,
            metadata: {
              currentTaskName: data.currentTask?.name || null,
              currentTaskStepNumber: data.currentTask?.stepNumber || null,
              schoolName: data.schoolContext?.schoolName || null,
              pagePath: data.pageContext?.path || null,
              pageStage: data.pageContext?.stage || null,
              completedSteps: data.pageContext?.completedSteps ?? null,
              totalSteps: data.pageContext?.totalSteps ?? null,
              isFallback: response.isFallback,
            },
          })

          return Response.json({
            ...response,
            diagnostic: null,
          })
        } catch (err) {
          console.error('VertexAI API route failed:', err)
          const isRateLimited = err instanceof Error && err.message === 'rate-limit'

          return Response.json(
            {
              text: isRateLimited
                ? 'VertexAI is receiving too many requests. Please wait a moment and try again.'
                : 'VertexAI could not process that request just now. Please refresh the page and try again.',
              isFallback: false,
              model: 'vertexai-error',
              diagnostic: null,
            },
            { status: isRateLimited ? 429 : 500 },
          )
        }
      },
    },
  },
})
