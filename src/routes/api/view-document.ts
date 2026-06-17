import { createFileRoute } from '@tanstack/react-router'
import { getAccessibleSubmission } from '#/lib/security'

function contentDisposition(fileName: string) {
  const asciiName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/"/g, '') || 'document'
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

async function getUploadsBucket() {
  const { getCloudflareEnv } = await import('#/lib/cloudflare-env.server')
  const env = getCloudflareEnv()
  return (env as any).UPLOADS_BUCKET
}

export const Route = createFileRoute('/api/view-document')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        const submissionId = url.searchParams.get('submissionId')
        
        if (!submissionId) {
          return new Response('Missing submissionId parameter', { status: 400 })
        }

        try {
          const { auth } = await import('#/lib/auth')
          const session = await auth.api.getSession({
            headers: request.headers,
          })
          if (!session?.user) {
            return new Response('Unauthorized', { status: 401 })
          }

          const submission = await getAccessibleSubmission(submissionId, session)
          const bucket = await getUploadsBucket()
          if (!bucket) {
            return new Response('R2 bucket binding "UPLOADS_BUCKET" is not available.', { status: 500 })
          }

          const object = await bucket.get(submission.r2Key)
          if (!object) {
            return new Response('Document not found in storage.', { status: 404 })
          }

          const headers = new Headers()
          object.writeHttpMetadata(headers)
          headers.set('etag', object.httpEtag)
          headers.set('Content-Disposition', contentDisposition(submission.fileName))
          headers.set('X-Content-Type-Options', 'nosniff')
          headers.set('Cache-Control', 'private, no-store')

          const { isSchoolSession } = await import('#/lib/security')
          const { recordAuditEvent } = await import('#/lib/audit')
          await recordAuditEvent({
            session,
            request,
            surface: isSchoolSession(session) ? 'client' : 'vertex',
            category: 'file',
            action: 'file_opened',
            message: `${session.user.email} opened ${submission.fileName} for ${submission.schoolName}.`,
            entityType: 'submission',
            entityId: submission.id,
            schoolName: submission.schoolName,
            metadata: {
              asanaTaskId: submission.asanaTaskId,
              asanaTaskName: submission.asanaTaskName,
              fileName: submission.fileName,
              fileSize: submission.fileSize,
              status: submission.status,
            },
          })

          return new Response(object.body, {
            headers
          })
        } catch (err: any) {
          const message = err?.message || String(err)
          const status = message.startsWith('Unauthorized') ? 403 : 500
          return new Response(status === 500 ? 'Document could not be retrieved.' : message, { status })
        }
      }
    }
  }
})
