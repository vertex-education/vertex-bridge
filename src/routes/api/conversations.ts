import { createFileRoute } from '@tanstack/react-router'
import {
  getConversationForUser,
  type ConversationChannel,
} from '#/lib/conversations'

function parseChannel(value: string | null): ConversationChannel {
  return value === 'staff' ? 'staff' : 'ai'
}

export const Route = createFileRoute('/api/conversations')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) return Response.json({ error: 'Please sign in.' }, { status: 401 })

          const url = new URL(request.url)
          const schoolName = url.searchParams.get('schoolName')?.trim()
          if (!schoolName) return Response.json({ error: 'schoolName is required.' }, { status: 400 })

          const channel = parseChannel(url.searchParams.get('channel'))
          const conversation = await getConversationForUser(session as any, schoolName, channel)
          return Response.json(conversation)
        } catch (err: any) {
          const message = err?.message || 'Unable to load conversation.'
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return Response.json({ error: status === 500 ? 'Unable to load conversation.' : message }, { status })
        }
      },
    },
  },
})
