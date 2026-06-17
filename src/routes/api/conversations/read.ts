import { createFileRoute } from '@tanstack/react-router'
import {
  markConversationRead,
  type ConversationChannel,
} from '#/lib/conversations'
import { assertTrustedOrigin } from '#/lib/security'

function parseChannel(value: string | undefined): ConversationChannel {
  return value === 'staff' ? 'staff' : 'ai'
}

export const Route = createFileRoute('/api/conversations/read')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await assertTrustedOrigin(request)
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) return Response.json({ error: 'Please sign in.' }, { status: 401 })

          const data = await request.json() as { schoolName?: string; channel?: string }
          const schoolName = data.schoolName?.trim()
          if (!schoolName) return Response.json({ error: 'schoolName is required.' }, { status: 400 })

          const result = await markConversationRead(session as any, schoolName, parseChannel(data.channel))
          return Response.json(result)
        } catch (err: any) {
          const message = err?.message || 'Unable to mark conversation read.'
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return Response.json({ error: status === 500 ? 'Unable to mark conversation read.' : message }, { status })
        }
      },
    },
  },
})
