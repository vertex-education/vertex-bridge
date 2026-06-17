import { and, asc, eq, sql } from 'drizzle-orm'
import { db } from '#/db'
import {
  schoolConversationMessages,
  schoolConversationReads,
  schoolConversations,
} from '#/db/schema'
import { getCloudflareEnv } from './cloudflare-env.server'
import { type AppSession, assertCanAccessSchool, isStaffSession } from './security'

export type ConversationChannel = 'ai' | 'staff'
export type ConversationSenderType = 'client' | 'staff' | 'ai' | 'system'

export type ConversationMessageView = {
  id: string
  conversationId: string
  schoolName: string
  channel: ConversationChannel
  senderType: ConversationSenderType
  senderUserId: string | null
  senderEmail: string | null
  senderName: string | null
  body: string
  aiModel: string | null
  aiDiagnostic: string | null
  metadata: unknown
  createdAt: string
}

export type ConversationView = {
  conversationId: string
  schoolName: string
  channel: ConversationChannel
  messages: ConversationMessageView[]
  unreadCount: number
  lastReadAt: string | null
  lastMessageCreatedAt: string | null
}

export type StaffConversationSummary = {
  schoolName: string
  conversationId: string
  unreadCount: number
  lastMessage: ConversationMessageView | null
}

type CreateMessageInput = {
  schoolName: string
  channel: ConversationChannel
  senderType: ConversationSenderType
  senderUserId?: string | null
  senderEmail?: string | null
  senderName?: string | null
  body: string
  aiModel?: string | null
  aiDiagnostic?: string | null
  metadata?: unknown
}

export type ConversationBroadcastPayload = {
  type: 'conversation:new-message' | 'conversation:read'
  schoolName: string
  channel: ConversationChannel
  message?: ConversationMessageView
  at: string
}

function toIso(value: Date | string | number | null | undefined) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function parseMetadata(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeChannel(value: string | null): ConversationChannel {
  return value === 'staff' ? 'staff' : 'ai'
}

function normalizeSenderType(value: string | null): ConversationSenderType {
  if (value === 'staff' || value === 'ai' || value === 'system') return value
  return 'client'
}

function serializeMessage(message: typeof schoolConversationMessages.$inferSelect): ConversationMessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    schoolName: message.schoolName,
    channel: normalizeChannel(message.channel),
    senderType: normalizeSenderType(message.senderType),
    senderUserId: message.senderUserId,
    senderEmail: message.senderEmail,
    senderName: message.senderName,
    body: message.body,
    aiModel: message.aiModel,
    aiDiagnostic: message.aiDiagnostic,
    metadata: parseMetadata(message.metadata),
    createdAt: toIso(message.createdAt) ?? new Date().toISOString(),
  }
}

export async function ensureConversationTables() {
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS school_conversations (
      id text PRIMARY KEY NOT NULL,
      school_name text NOT NULL,
      channel text NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    )
  `)
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS school_conversations_school_channel_unique ON school_conversations (school_name, channel)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS school_conversations_school_name_idx ON school_conversations (school_name)`)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS school_conversation_messages (
      id text PRIMARY KEY NOT NULL,
      conversation_id text NOT NULL,
      school_name text NOT NULL,
      channel text NOT NULL,
      sender_type text NOT NULL,
      sender_user_id text,
      sender_email text,
      sender_name text,
      body text NOT NULL,
      ai_model text,
      ai_diagnostic text,
      metadata text,
      created_at integer NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES school_conversations(id) ON DELETE cascade,
      FOREIGN KEY (sender_user_id) REFERENCES user(id) ON DELETE set null
    )
  `)
  await db.run(sql`CREATE INDEX IF NOT EXISTS school_conversation_messages_conversation_created_at_idx ON school_conversation_messages (conversation_id, created_at)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS school_conversation_messages_school_channel_created_at_idx ON school_conversation_messages (school_name, channel, created_at)`)
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS school_conversation_reads (
      id text PRIMARY KEY NOT NULL,
      conversation_id text NOT NULL,
      user_id text NOT NULL,
      last_read_message_id text,
      last_read_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES school_conversations(id) ON DELETE cascade,
      FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE cascade
    )
  `)
  await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS school_conversation_reads_conversation_user_unique ON school_conversation_reads (conversation_id, user_id)`)
  await db.run(sql`CREATE INDEX IF NOT EXISTS school_conversation_reads_user_idx ON school_conversation_reads (user_id)`)
}

export async function assertCanAccessConversation(session: AppSession, schoolName: string) {
  await assertCanAccessSchool(session, schoolName)
}

export async function getOrCreateConversation(schoolName: string, channel: ConversationChannel) {
  await ensureConversationTables()
  const now = new Date()
  const existing = await db
    .select()
    .from(schoolConversations)
    .where(and(eq(schoolConversations.schoolName, schoolName), eq(schoolConversations.channel, channel)))
    .all()

  if (existing[0]) return existing[0]

  const id = crypto.randomUUID()
  await db
    .insert(schoolConversations)
    .values({
      id,
      schoolName,
      channel,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [schoolConversations.schoolName, schoolConversations.channel],
    })
    .run()

  const rows = await db
    .select()
    .from(schoolConversations)
    .where(and(eq(schoolConversations.schoolName, schoolName), eq(schoolConversations.channel, channel)))
    .all()

  return rows[0] ?? {
    id,
    schoolName,
    channel,
    createdAt: now,
    updatedAt: now,
  }
}

export async function createConversationMessage(input: CreateMessageInput) {
  const body = input.body.trim()
  if (!body) throw new Error('Message body is required.')

  const conversation = await getOrCreateConversation(input.schoolName, input.channel)
  const now = new Date()

  const message = {
    id: crypto.randomUUID(),
    conversationId: conversation.id,
    schoolName: input.schoolName,
    channel: input.channel,
    senderType: input.senderType,
    senderUserId: input.senderUserId ?? null,
    senderEmail: input.senderEmail ?? null,
    senderName: input.senderName ?? null,
    body,
    aiModel: input.aiModel ?? null,
    aiDiagnostic: input.aiDiagnostic ?? null,
    metadata: input.metadata === undefined ? null : JSON.stringify(input.metadata),
    createdAt: now,
  }

  await db.insert(schoolConversationMessages).values(message).run()
  await db
    .update(schoolConversations)
    .set({ updatedAt: now })
    .where(eq(schoolConversations.id, conversation.id))
    .run()

  return serializeMessage(message)
}

export async function getConversationForUser(session: AppSession, schoolName: string, channel: ConversationChannel): Promise<ConversationView> {
  await assertCanAccessConversation(session, schoolName)
  const conversation = await getOrCreateConversation(schoolName, channel)
  const [messageRows, readRows] = await Promise.all([
    db
      .select()
      .from(schoolConversationMessages)
      .where(eq(schoolConversationMessages.conversationId, conversation.id))
      .orderBy(asc(schoolConversationMessages.createdAt))
      .all(),
    db
      .select()
      .from(schoolConversationReads)
      .where(and(eq(schoolConversationReads.conversationId, conversation.id), eq(schoolConversationReads.userId, session.user.id)))
      .all(),
  ])

  const messages = messageRows.map(serializeMessage)
  const lastReadAt = toIso(readRows[0]?.lastReadAt)
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0
  const unreadCount = messages.filter((message) => {
    if (message.senderUserId === session.user.id) return false
    return new Date(message.createdAt).getTime() > lastReadTime
  }).length

  return {
    conversationId: conversation.id,
    schoolName,
    channel,
    messages,
    unreadCount,
    lastReadAt,
    lastMessageCreatedAt: messages.at(-1)?.createdAt ?? null,
  }
}

export async function listStaffConversationSummaries(session: AppSession): Promise<StaffConversationSummary[]> {
  if (!isStaffSession(session)) throw new Error('Unauthorized. Vertex staff only.')
  await ensureConversationTables()

  const { asc } = await import('drizzle-orm')
  const { clientProfiles, invitations } = await import('#/db/schema')
  const [profiles, inviteRows] = await Promise.all([
    db.select({ schoolName: clientProfiles.schoolName }).from(clientProfiles).orderBy(asc(clientProfiles.schoolName)).all(),
    db.select({ schoolName: invitations.schoolName }).from(invitations).orderBy(asc(invitations.schoolName)).all(),
  ])

  const schoolNames = Array.from(new Set([
    ...profiles.map((profile) => profile.schoolName),
    ...inviteRows.map((invite) => invite.schoolName),
  ])).filter((schoolName): schoolName is string => Boolean(schoolName)).sort((a, b) => a.localeCompare(b))

  const summaries = await Promise.all(schoolNames.map(async (schoolName) => {
    const conversation = await getConversationForUser(session, schoolName, 'staff')
    return {
      schoolName,
      conversationId: conversation.conversationId,
      unreadCount: conversation.unreadCount,
      lastMessage: conversation.messages.at(-1) ?? null,
    }
  }))

  return summaries.sort((a, b) => {
    if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount
    const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0
    const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0
    if (aTime !== bTime) return bTime - aTime
    return a.schoolName.localeCompare(b.schoolName)
  })
}

export async function markConversationRead(session: AppSession, schoolName: string, channel: ConversationChannel) {
  await assertCanAccessConversation(session, schoolName)
  const conversation = await getOrCreateConversation(schoolName, channel)
  const rows = await db
    .select()
    .from(schoolConversationMessages)
    .where(eq(schoolConversationMessages.conversationId, conversation.id))
    .orderBy(asc(schoolConversationMessages.createdAt))
    .all()
  const lastMessage = rows.at(-1)
  const now = new Date()

  await db
    .insert(schoolConversationReads)
    .values({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      userId: session.user.id,
      lastReadMessageId: lastMessage?.id ?? null,
      lastReadAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schoolConversationReads.conversationId, schoolConversationReads.userId],
      set: {
        lastReadMessageId: lastMessage?.id ?? null,
        lastReadAt: now,
        updatedAt: now,
      },
    })
    .run()

  await broadcastConversationEvent({
    type: 'conversation:read',
    schoolName,
    channel,
    at: now.toISOString(),
  })

  return { success: true, lastReadAt: now.toISOString(), lastReadMessageId: lastMessage?.id ?? null }
}

export async function createUserStaffMessage(session: AppSession, schoolName: string, body: string) {
  await assertCanAccessConversation(session, schoolName)
  const senderType: ConversationSenderType = isStaffSession(session) ? 'staff' : 'client'
  const message = await createConversationMessage({
    schoolName,
    channel: 'staff',
    senderType,
    senderUserId: session.user.id,
    senderEmail: session.user.email,
    senderName: session.user.name || session.user.email,
    body,
  })
  await broadcastConversationEvent({
    type: 'conversation:new-message',
    schoolName,
    channel: 'staff',
    message,
    at: message.createdAt,
  })
  return message
}

export async function broadcastConversationEvent(payload: ConversationBroadcastPayload) {
  try {
    const env = getCloudflareEnv() as any
    const roomNamespace = env.SCHOOL_CONVERSATION_ROOM
    if (!roomNamespace?.getByName) return
    const room = roomNamespace.getByName(`school:${payload.schoolName}`)
    if (typeof room.broadcast === 'function') {
      await room.broadcast(payload)
    }
  } catch (err) {
    console.warn('Conversation broadcast failed:', err)
  }
}
