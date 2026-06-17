import { createFileRoute } from '@tanstack/react-router'
import { disconnectAsana } from '#/lib/asana-oauth.server'
import { assertTrustedOrigin, requireStaffSession } from '#/lib/security'

export const Route = createFileRoute('/api/asana/oauth/disconnect')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          assertTrustedOrigin(request)
          const session = await requireStaffSession()
          await disconnectAsana()
          const { recordAuditEvent } = await import('#/lib/audit')
          await recordAuditEvent({
            session,
            request,
            surface: 'admin',
            category: 'oauth',
            action: 'asana_oauth_disconnected',
            message: `${session.user.email} disconnected Asana OAuth.`,
            entityType: 'asana_connection',
            entityId: 'default',
          })
          return Response.json({ ok: true })
        } catch (err) {
          console.error('Failed to disconnect Asana:', err)
          return Response.json({ ok: false }, { status: 500 })
        }
      },
    },
  },
})
