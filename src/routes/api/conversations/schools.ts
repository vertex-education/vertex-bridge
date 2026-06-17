import { createFileRoute } from '@tanstack/react-router'
import { listStaffConversationSummaries } from '#/lib/conversations'

export const Route = createFileRoute('/api/conversations/schools')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) return Response.json({ error: 'Please sign in.' }, { status: 401 })

          const schools = await listStaffConversationSummaries(session as any)
          return Response.json({ schools })
        } catch (err: any) {
          const message = err?.message || 'Unable to load staff conversations.'
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return Response.json({ error: status === 500 ? 'Unable to load staff conversations.' : message }, { status })
        }
      },
    },
  },
})
