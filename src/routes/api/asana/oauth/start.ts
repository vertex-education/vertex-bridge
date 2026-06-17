import { createFileRoute } from '@tanstack/react-router'
import { createAsanaAuthorizationResponse } from '#/lib/asana-oauth.server'
import { requireStaffSession } from '#/lib/security'

export const Route = createFileRoute('/api/asana/oauth/start')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await requireStaffSession()
          return await createAsanaAuthorizationResponse(request, session)
        } catch (err) {
          console.error('Failed to start Asana OAuth:', err)
          return new Response('Unable to start Asana authorization.', { status: 500 })
        }
      },
    },
  },
})
