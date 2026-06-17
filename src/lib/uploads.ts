import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/start-server-core'
import { completeAsanaTask } from './asana'
import { eq } from 'drizzle-orm'
import {
  assertCanAccessSchool,
  assertTrustedOrigin,
  requireSession,
  requireStaffSession,
} from './security'
import { resolveSchoolNudgeRecipient, sendNudgeEmailMessage } from './nudge-email'

const maxUploadBytes = 25 * 1024 * 1024
const allowedExtensions = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'png', 'jpg', 'jpeg'])
const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'image/png',
  'image/jpeg',
  'application/octet-stream',
])

async function getEnv() {
  const { getCloudflareEnv } = await import('./cloudflare-env.server')
  return getCloudflareEnv()
}

async function getBucket() {
  const env = await getEnv()
  const bucket = (env as any).UPLOADS_BUCKET
  if (!bucket) {
    throw new Error('R2 bucket binding "UPLOADS_BUCKET" is required for file uploads.')
  }
  return bucket
}

function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function safeFileName(fileName: string) {
  const clean = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, '-')
  return clean || 'document'
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) || '' : ''
}

function normalizeDuplicateFileName(fileName: string) {
  return safeFileName(fileName).toLowerCase()
}

function fileNameFromR2Key(key: string) {
  const objectName = key.split('/').at(-1) || ''
  return objectName.replace(/^\d{10,}-/, '')
}

async function assertAllowedFile(file: File, cleanName: string) {
  if (file.size === 0) {
    throw new Error('The uploaded file is empty.')
  }
  if (file.size > maxUploadBytes) {
    throw new Error('The uploaded file is too large. Please upload a file smaller than 25 MB.')
  }

  const extension = getFileExtension(cleanName)
  const mimeType = file.type || 'application/octet-stream'
  if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(mimeType)) {
    throw new Error('Unsupported file type. Please upload a PDF, Word, Excel, CSV, PNG, or JPG file.')
  }

  const firstBytes = new Uint8Array(await file.slice(0, 512).arrayBuffer())
  const headerText = new TextDecoder().decode(firstBytes).trimStart().toLowerCase()
  if (
    headerText.startsWith('<!doctype html') ||
    headerText.startsWith('<html') ||
    headerText.startsWith('<script') ||
    headerText.startsWith('<?xml') ||
    headerText.startsWith('<svg')
  ) {
    throw new Error('Unsupported file content. Please upload a document, spreadsheet, or image file.')
  }
}

function assertValidTaskId(taskId: string) {
  if (!/^(\d{8,}|mock-task-[1-5])$/.test(taskId)) {
    throw new Error('Invalid onboarding task identifier.')
  }
}

async function findDuplicateOnboardingFile({
  db,
  bucket,
  submissions,
  schoolName,
  schoolSlug,
  cleanName,
}: {
  db: any
  bucket: any
  submissions: any
  schoolName: string
  schoolSlug: string
  cleanName: string
}) {
  const normalizedCleanName = normalizeDuplicateFileName(cleanName)
  const schoolSubmissions = await db
    .select({
      asanaTaskName: submissions.asanaTaskName,
      fileName: submissions.fileName,
      r2Key: submissions.r2Key,
    })
    .from(submissions)
    .where(eq(submissions.schoolName, schoolName))
    .all()

  const duplicateSubmission = schoolSubmissions.find((submission: any) =>
    normalizeDuplicateFileName(submission.fileName) === normalizedCleanName,
  )
  if (duplicateSubmission) {
    return {
      source: 'submission',
      fileName: duplicateSubmission.fileName,
      asanaTaskName: duplicateSubmission.asanaTaskName,
    }
  }

  let cursor: string | undefined
  do {
    const listed = await bucket.list({
      prefix: `${schoolSlug}/`,
      cursor,
    })
    const duplicateObject = listed.objects?.find((object: any) =>
      normalizeDuplicateFileName(fileNameFromR2Key(object.key || '')) === normalizedCleanName,
    )
    if (duplicateObject) {
      return {
        source: 'r2',
        fileName: fileNameFromR2Key(duplicateObject.key || cleanName) || cleanName,
        asanaTaskName: null,
      }
    }
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)

  return null
}

export const uploadOnboardingFile = createServerFn({ method: 'POST' })
  .validator((data: FormData) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { submissions } = await import('#/db/schema')

    assertTrustedOrigin()
    const session = await requireSession()

    const currentUser = session.user

    // 2. Extract form parameters
    const file = data.get('file')
    if (!(file instanceof File)) {
      throw new Error('No valid file was uploaded.')
    }

    const asanaTaskId = data.get('asanaTaskId') as string
    const asanaTaskName = data.get('asanaTaskName') as string
    const schoolName = data.get('schoolName') as string
    const contactName = currentUser.name

    if (!asanaTaskId || !asanaTaskName || !schoolName) {
      throw new Error('Missing required onboarding task or school metadata.')
    }
    assertValidTaskId(asanaTaskId)
    await assertCanAccessSchool(session, schoolName)

    // 3. Prepare file details and paths
    const cleanName = safeFileName(file.name)
    await assertAllowedFile(file, cleanName)
    const schoolSlug = slugify(schoolName)
    const unixTimestamp = Math.floor(Date.now() / 1000)

    // Key format: {school-slug}/{asana-task-id}/{timestamp}-{safe-filename}
    const r2Key = `${schoolSlug}/${asanaTaskId}/${unixTimestamp}-${cleanName}`
    const mimeType = file.type || 'application/octet-stream'

    // 4. Upload to Cloudflare R2
    const bucket = await getBucket()
    const duplicateFile = await findDuplicateOnboardingFile({
      db,
      bucket,
      submissions,
      schoolName,
      schoolSlug,
      cleanName,
    })
    if (duplicateFile) {
      throw new Error(
        duplicateFile.asanaTaskName
          ? `A file named "${duplicateFile.fileName}" has already been uploaded for this school's onboarding journey on "${duplicateFile.asanaTaskName}". Rename the file if this is a different document.`
          : `A file named "${duplicateFile.fileName}" already exists in this school's onboarding uploads. Rename the file if this is a different document.`,
      )
    }

    const fileBuffer = await file.arrayBuffer()
    await bucket.put(r2Key, fileBuffer, {
      httpMetadata: {
        contentType: mimeType
      },
      customMetadata: {
        schoolName,
        asanaTaskId,
        asanaTaskName,
        uploadedBy: currentUser.id,
        uploadedByName: contactName
      }
    })

    // 5. Store metadata in D1 database
    const submissionId = crypto.randomUUID()
    await db.insert(submissions).values({
      id: submissionId,
      schoolName,
      asanaTaskId,
      asanaTaskName,
      r2Key,
      fileName: cleanName,
      fileSize: file.size,
      uploadedBy: currentUser.id,
      uploadedByName: contactName,
      uploadedAt: new Date(),
      status: 'Pending',
    }).run()

    // 6. Complete matching task in Asana
    const asanaResult = await completeAsanaTask({
      data: {
        taskId: asanaTaskId,
        schoolName,
        contactName,
        taskName: asanaTaskName,
        fileName: cleanName
      }
    })

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: getRequest(),
      surface: 'client',
      category: 'upload',
      action: 'file_uploaded',
      message: `${contactName} uploaded ${cleanName} for ${schoolName}.`,
      entityType: 'submission',
      entityId: submissionId,
      schoolName,
      metadata: {
        asanaTaskId,
        asanaTaskName,
        fileName: cleanName,
        fileSize: file.size,
        mimeType,
        r2Key,
      },
    })
    await recordAuditEvent({
      session,
      request: getRequest(),
      surface: 'client',
      category: 'asana',
      action: asanaResult.success ? 'step_completed_asana_validated' : 'step_completion_asana_failed',
      message: asanaResult.success
        ? `Onboarding step completed in Asana for ${schoolName}: ${asanaTaskName}.`
        : `File upload succeeded, but Asana validation failed for ${schoolName}: ${asanaTaskName}.`,
      entityType: 'asana_task',
      entityId: asanaTaskId,
      schoolName,
      metadata: {
        submissionId,
        asanaTaskName,
        fileName: cleanName,
        asanaUpdated: asanaResult.success,
        asanaError: asanaResult.error || null,
      },
    })

    return {
      success: true,
      submissionId,
      asanaUpdated: asanaResult.success,
      asanaError: asanaResult.error || null
    }
  })

// Mark submission as reviewed
export const reviewSubmission = createServerFn({ method: 'POST' })
  .validator((submissionId: string) => submissionId)
  .handler(async ({ data: submissionId }) => {
    const { db } = await import('#/db')
    const { submissions } = await import('#/db/schema')

    assertTrustedOrigin()
    const session = await requireStaffSession()

    const rows = await db.select().from(submissions).where(eq(submissions.id, submissionId)).all()
    const submission = rows[0]

    await db.update(submissions)
      .set({ status: 'Reviewed', reviewedAt: new Date() })
      .where(eq(submissions.id, submissionId))
      .run()

    if (submission) {
      const { recordAuditEvent } = await import('./audit')
      await recordAuditEvent({
        session,
        request: getRequest(),
        surface: 'vertex',
        category: 'review',
        action: 'file_reviewed',
        message: `${session.user.name || session.user.email} marked ${submission.fileName} reviewed for ${submission.schoolName}.`,
        entityType: 'submission',
        entityId: submission.id,
        schoolName: submission.schoolName,
        metadata: {
          asanaTaskId: submission.asanaTaskId,
          asanaTaskName: submission.asanaTaskName,
          fileName: submission.fileName,
          uploadedByName: submission.uploadedByName,
        },
      })
    }

    return { success: true }
  })

// Send nudge email to client
export const sendNudgeEmail = createServerFn({ method: 'POST' })
  .validator((data: {
    schoolName: string
    taskName: string
    submissionId?: string
  }) => data)
  .handler(async ({ data }) => {
    const { db } = await import('#/db')
    const { submissions } = await import('#/db/schema')

    assertTrustedOrigin()
    const session = await requireStaffSession()

    const recipient = await resolveSchoolNudgeRecipient(data.schoolName)
    if (!recipient) {
      throw new Error('No school user or client contact email was found for this school.')
    }

    const { emailSent, emailError } = await sendNudgeEmailMessage({
      clientEmail: recipient.email,
      schoolName: data.schoolName,
      contactName: recipient.name,
      taskName: data.taskName,
    })

    // Record nudge timestamp if submissionId is provided
    if (data.submissionId) {
      await db.update(submissions)
        .set({ nudgeSentAt: new Date() })
        .where(eq(submissions.id, data.submissionId))
        .run()
    }

    const { recordAuditEvent } = await import('./audit')
    await recordAuditEvent({
      session,
      request: getRequest(),
      surface: 'vertex',
      category: 'notification',
      action: emailSent ? 'nudge_sent' : 'nudge_recorded',
      message: emailSent
        ? `Nudge sent to ${recipient.email} for ${data.taskName}.`
        : `Nudge recorded for ${recipient.email}; email delivery was not completed.`,
      entityType: data.submissionId ? 'submission' : 'onboarding_task',
      entityId: data.submissionId || null,
      schoolName: data.schoolName,
      clientEmail: recipient.email,
      metadata: {
        contactName: recipient.name,
        taskName: data.taskName,
        emailSent,
        emailError: emailError || null,
      },
    })

    return { success: true, emailSent, emailError }
  })
