import { createFileRoute } from '@tanstack/react-router'
import { handleAsanaOAuthCallback } from '#/lib/asana-oauth.server'
import { requireStaffSession } from '#/lib/security'

export const Route = createFileRoute('/api/asana/oauth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireStaffSession()
          return await handleAsanaOAuthCallback(request, session)
        } catch (err) {
          console.error('Failed to complete Asana OAuth:', err)
          return new Response('Unable to complete Asana authorization.', { status: 500 })
        }
      },
    },
  },
})
