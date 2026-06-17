import { and, eq } from 'drizzle-orm'
import {
  onboardingTaskReminderLog,
  schoolNudgeSettings,
  schoolOnboardingTaskStates,
  submissions,
} from '#/db/schema'
import { recordAuditEvent } from './audit'
import { resolveSchoolNudgeRecipient, sendNudgeEmailMessage } from './nudge-email'

const sevenDayReminderType = 'due_soon_7d'

function dateKeyFromScheduledTime(scheduledTime: number, offsetDays: number) {
  const date = new Date(scheduledTime)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

function reminderId(data: {
  schoolName: string
  asanaTaskId: string
  dueDate: string
  reminderType: string
}) {
  return [
    data.reminderType,
    data.dueDate,
    data.schoolName,
    data.asanaTaskId,
  ]
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9|_-]+/g, '-')
    .slice(0, 240)
}

async function hasSubmissionForTask(db: typeof import('#/db').db, schoolName: string, asanaTaskId: string) {
  const rows = await db
    .select({ id: submissions.id })
    .from(submissions)
    .where(and(
      eq(submissions.schoolName, schoolName),
      eq(submissions.asanaTaskId, asanaTaskId),
    ))
    .limit(1)
    .all()

  return rows.length > 0
}

export async function sendScheduledTaskNudges(scheduledTime = Date.now()) {
  const { db } = await import('#/db')
  const targetDueDate = dateKeyFromScheduledTime(scheduledTime, 7)
  const now = new Date()

  const [taskRows, settingsRows] = await Promise.all([
    db
      .select()
      .from(schoolOnboardingTaskStates)
      .where(and(
        eq(schoolOnboardingTaskStates.completed, false),
        eq(schoolOnboardingTaskStates.dueDate, targetDueDate),
      ))
      .all(),
    db.select().from(schoolNudgeSettings).all(),
  ])

  const settingsBySchool = new Map(settingsRows.map((row) => [row.schoolName, row]))
  let sentCount = 0
  let skippedCount = 0
  let failedCount = 0
  const failures: Array<{ schoolName: string; taskName: string; error: string }> = []

  for (const task of taskRows) {
    if (task.source === 'fallback') {
      skippedCount += 1
      continue
    }

    const setting = settingsBySchool.get(task.schoolName)
    if (setting?.scheduledNudgesEnabled === false) {
      skippedCount += 1
      continue
    }

    if (await hasSubmissionForTask(db, task.schoolName, task.asanaTaskId)) {
      skippedCount += 1
      continue
    }

    const contact = await resolveSchoolNudgeRecipient(task.schoolName)
    if (!contact) {
      skippedCount += 1
      failures.push({
        schoolName: task.schoolName,
        taskName: task.taskName,
        error: 'No client email found for school.',
      })
      continue
    }

    const id = reminderId({
      schoolName: task.schoolName,
      asanaTaskId: task.asanaTaskId,
      dueDate: targetDueDate,
      reminderType: sevenDayReminderType,
    })

    try {
      await db.insert(onboardingTaskReminderLog).values({
        id,
        schoolName: task.schoolName,
        asanaTaskId: task.asanaTaskId,
        taskName: task.taskName,
        dueDate: targetDueDate,
        reminderType: sevenDayReminderType,
        clientEmail: contact.email,
        status: 'pending',
        error: null,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
      }).run()
    } catch {
      skippedCount += 1
      continue
    }

    const result = await sendNudgeEmailMessage({
      clientEmail: contact.email,
      schoolName: task.schoolName,
      contactName: contact.name,
      taskName: task.taskName,
    })

    await db
      .update(onboardingTaskReminderLog)
      .set({
        status: result.emailSent ? 'sent' : 'failed',
        error: result.emailError || null,
        sentAt: result.emailSent ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(onboardingTaskReminderLog.id, id))
      .run()

    if (result.emailSent) {
      sentCount += 1
    } else {
      failedCount += 1
      failures.push({
        schoolName: task.schoolName,
        taskName: task.taskName,
        error: result.emailError || 'Unknown email send failure.',
      })
    }

    await recordAuditEvent({
      surface: 'system',
      category: 'notification',
      action: result.emailSent ? 'scheduled_nudge_sent' : 'scheduled_nudge_failed',
      message: result.emailSent
        ? `Scheduled 7-day nudge sent to ${contact.email} for ${task.taskName}.`
        : `Scheduled 7-day nudge failed for ${contact.email} on ${task.taskName}.`,
      entityType: 'onboarding_task',
      entityId: task.asanaTaskId,
      schoolName: task.schoolName,
      clientEmail: contact.email,
      metadata: {
        taskName: task.taskName,
        asanaTaskId: task.asanaTaskId,
        dueDate: targetDueDate,
        reminderType: sevenDayReminderType,
        emailSent: result.emailSent,
        emailError: result.emailError || null,
      },
    })
  }

  await recordAuditEvent({
    surface: 'system',
    category: 'notification',
    action: 'scheduled_nudges_processed',
    message: `Scheduled 7-day onboarding nudges processed for ${targetDueDate}.`,
    entityType: 'scheduled_nudge_run',
    metadata: {
      targetDueDate,
      sentCount,
      skippedCount,
      failedCount,
      failures,
    },
  })

  return {
    targetDueDate,
    sentCount,
    skippedCount,
    failedCount,
    failures,
  }
}
