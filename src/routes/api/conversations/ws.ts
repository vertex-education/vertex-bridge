import { createFileRoute } from '@tanstack/react-router'
import { assertCanAccessConversation } from '#/lib/conversations'
import { getCloudflareEnv } from '#/lib/cloudflare-env.server'

export const Route = createFileRoute('/api/conversations/ws')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          if (request.headers.get('upgrade') !== 'websocket') {
            return new Response('Expected WebSocket upgrade.', { status: 426 })
          }

          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) return new Response('Please sign in.', { status: 401 })

          const url = new URL(request.url)
          const schoolName = url.searchParams.get('schoolName')?.trim()
          if (!schoolName) return new Response('schoolName is required.', { status: 400 })

          await assertCanAccessConversation(session as any, schoolName)

          const env = getCloudflareEnv() as any
          const roomNamespace = env.SCHOOL_CONVERSATION_ROOM
          if (!roomNamespace?.getByName) {
            return new Response('Conversation realtime is not configured.', { status: 503 })
          }

          const room = roomNamespace.getByName(`school:${schoolName}`)
          return room.fetch(request)
        } catch (err: any) {
          const message = err?.message || 'Unable to open conversation socket.'
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return new Response(status === 500 ? 'Unable to open conversation socket.' : message, { status })
        }
      },
    },
  },
})
