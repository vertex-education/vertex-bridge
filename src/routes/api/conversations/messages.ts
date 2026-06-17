import { createFileRoute } from '@tanstack/react-router'
import { createUserStaffMessage } from '#/lib/conversations'
import { assertTrustedOrigin } from '#/lib/security'

export const Route = createFileRoute('/api/conversations/messages')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          await assertTrustedOrigin(request)
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({ headers: request.headers })
          if (!session?.user) return Response.json({ error: 'Please sign in.' }, { status: 401 })

          const data = await request.json() as { schoolName?: string; body?: string }
          const schoolName = data.schoolName?.trim()
          const body = data.body?.trim()
          if (!schoolName) return Response.json({ error: 'schoolName is required.' }, { status: 400 })
          if (!body) return Response.json({ error: 'Message is required.' }, { status: 400 })

          const message = await createUserStaffMessage(session as any, schoolName, body)
          const { isStaffSession } = await import('#/lib/security')
          const { recordAuditEvent } = await import('#/lib/audit')
          const staffSender = isStaffSession(session as any)
          await recordAuditEvent({
            session: session as any,
            request,
            surface: staffSender ? 'vertex' : 'client',
            category: 'communication',
            action: staffSender ? 'staff_message_sent' : 'client_message_sent',
            message: `${session.user.email} sent a Vertex Team message for ${schoolName}.`,
            entityType: 'school_conversation_message',
            entityId: message.id,
            schoolName,
            metadata: {
              channel: 'staff',
              senderType: message.senderType,
            },
          })

          return Response.json({ message })
        } catch (err: any) {
          const message = err?.message || 'Unable to send message.'
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return Response.json({ error: status === 500 ? 'Unable to send message.' : message }, { status })
        }
      },
    },
  },
})
