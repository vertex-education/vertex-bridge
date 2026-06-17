import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull(),
  image: text('image'),
  role: text('role').notNull().default('school_leader'), // 'school_leader' | 'school_staff' | 'vertex_user' | 'admin' | legacy 'school_user'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(), // SHA-256 hash of the raw invite token
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
})

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
})

export const invitations = sqliteTable('invitations', {
  id: text('id').primaryKey(),
  email: text('email').notNull(),
  role: text('role').notNull(), // 'school_leader' | 'school_staff' | 'vertex_user' | 'admin' | legacy 'school_user'
  schoolContactRole: text('school_contact_role'), // 'school_leader' | 'school_staff'
  schoolName: text('school_name'),
  state: text('state'),
  services: text('services'), // e.g., 'SFO'
  clientType: text('client_type'), // 'New' | 'Existing' | 'Existing New'
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  invitedByEmail: text('invited_by_email'),
  token: text('token').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  accepted: integer('accepted', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    emailSchoolUnique: uniqueIndex('invitations_email_school_unique').on(table.email, table.schoolName),
  }
})

export const schoolContacts = sqliteTable('school_contacts', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  email: text('email').notNull(),
  name: text('name'),
  contactRole: text('contact_role').notNull().default('school_staff'), // 'school_leader' | 'school_staff'
  invitedByUserId: text('invited_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  invitedByEmail: text('invited_by_email'),
  acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolEmailUnique: uniqueIndex('school_contacts_school_email_unique').on(table.schoolName, table.email),
    schoolNameIdx: index('school_contacts_school_name_idx').on(table.schoolName),
    userIdIdx: index('school_contacts_user_id_idx').on(table.userId),
    invitedByUserIdIdx: index('school_contacts_invited_by_user_id_idx').on(table.invitedByUserId),
  }
})

export const clientProfiles = sqliteTable('client_profiles', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull().unique(),
  state: text('state').notNull(),
  services: text('services').notNull(),
  clientType: text('client_type').notNull(),
  primaryContactName: text('primary_contact_name').notNull(),
  primaryContactEmail: text('primary_contact_email').notNull(),
  onboardingCoordinator: text('onboarding_coordinator').notNull(),
  onboardingStartDate: text('onboarding_start_date').notNull(),
  hubspotCompanyId: text('hubspot_company_id').notNull(),
  hubspotDealId: text('hubspot_deal_id').notNull(),
  lifecycleStage: text('lifecycle_stage').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  asanaTaskId: text('asana_task_id').notNull(),
  asanaTaskName: text('asana_task_name').notNull(),
  r2Key: text('r2_key').notNull(),
  fileName: text('file_name').notNull(),
  fileSize: integer('file_size').notNull(),
  uploadedBy: text('uploaded_by')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  uploadedByName: text('uploaded_by_name').notNull(),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }).notNull(),
  status: text('status').notNull().default('Pending'), // 'Pending' | 'Reviewed'
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  nudgeSentAt: integer('nudge_sent_at', { mode: 'timestamp' }),
})

export const taskFileRequirements = sqliteTable('task_file_requirements', {
  asanaTaskId: text('asana_task_id').primaryKey(),
  taskName: text('task_name').notNull(),
  taskNotesHash: text('task_notes_hash').notNull(),
  requiresFileUpload: integer('requires_file_upload', { mode: 'boolean' }).notNull(),
  reason: text('reason').notNull(),
  classifier: text('classifier').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    notesHashIdx: index('task_file_requirements_notes_hash_idx').on(table.taskNotesHash),
    classifierIdx: index('task_file_requirements_classifier_idx').on(table.classifier),
  }
})

export const schoolOnboardingProgress = sqliteTable('school_onboarding_progress', {
  schoolName: text('school_name').primaryKey(),
  completedTaskCount: integer('completed_task_count').notNull(),
  totalTaskCount: integer('total_task_count').notNull(),
  asanaProjectGid: text('asana_project_gid'),
  source: text('source').notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    syncedAtIdx: index('school_onboarding_progress_synced_at_idx').on(table.syncedAt),
  }
})

export const schoolOnboardingTaskStates = sqliteTable('school_onboarding_task_states', {
  asanaTaskId: text('asana_task_id').primaryKey(),
  schoolName: text('school_name').notNull(),
  taskName: text('task_name').notNull(),
  dueDate: text('due_date'),
  completed: integer('completed', { mode: 'boolean' }).notNull(),
  source: text('source').notNull(),
  syncedAt: integer('synced_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolNameIdx: index('school_onboarding_task_states_school_name_idx').on(table.schoolName),
    completedIdx: index('school_onboarding_task_states_completed_idx').on(table.completed),
  }
})

export const schoolOnboardingTaskAssignments = sqliteTable('school_onboarding_task_assignments', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  asanaTaskId: text('asana_task_id').notNull(),
  assignedToUserId: text('assigned_to_user_id').references(() => user.id, { onDelete: 'set null' }),
  assignedToEmail: text('assigned_to_email').notNull(),
  assignedToName: text('assigned_to_name'),
  assignedByUserId: text('assigned_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  assignedByEmail: text('assigned_by_email'),
  assignedAt: integer('assigned_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolTaskUnique: uniqueIndex('school_onboarding_task_assignments_school_task_unique').on(table.schoolName, table.asanaTaskId),
    schoolNameIdx: index('school_onboarding_task_assignments_school_name_idx').on(table.schoolName),
    assignedToUserIdIdx: index('school_onboarding_task_assignments_assigned_to_user_id_idx').on(table.assignedToUserId),
    assignedToEmailIdx: index('school_onboarding_task_assignments_assigned_to_email_idx').on(table.assignedToEmail),
  }
})

export const schoolOnboardingIntakeResponses = sqliteTable('school_onboarding_intake_responses', {
  schoolName: text('school_name').primaryKey(),
  responseJson: text('response_json').notNull(),
  completedStepIdsJson: text('completed_step_ids_json').notNull(),
  submittedByUserId: text('submitted_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  submittedByEmail: text('submitted_by_email'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    updatedAtIdx: index('school_onboarding_intake_responses_updated_at_idx').on(table.updatedAt),
  }
})

export const schoolConversations = sqliteTable('school_conversations', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  channel: text('channel').notNull(), // 'ai' | 'staff'
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolChannelUnique: uniqueIndex('school_conversations_school_channel_unique').on(table.schoolName, table.channel),
    schoolNameIdx: index('school_conversations_school_name_idx').on(table.schoolName),
  }
})

export const schoolConversationMessages = sqliteTable('school_conversation_messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => schoolConversations.id, { onDelete: 'cascade' }),
  schoolName: text('school_name').notNull(),
  channel: text('channel').notNull(), // 'ai' | 'staff'
  senderType: text('sender_type').notNull(), // 'client' | 'staff' | 'ai' | 'system'
  senderUserId: text('sender_user_id').references(() => user.id, { onDelete: 'set null' }),
  senderEmail: text('sender_email'),
  senderName: text('sender_name'),
  body: text('body').notNull(),
  aiModel: text('ai_model'),
  aiDiagnostic: text('ai_diagnostic'),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    conversationCreatedAtIdx: index('school_conversation_messages_conversation_created_at_idx').on(table.conversationId, table.createdAt),
    schoolChannelCreatedAtIdx: index('school_conversation_messages_school_channel_created_at_idx').on(table.schoolName, table.channel, table.createdAt),
  }
})

export const schoolConversationReads = sqliteTable('school_conversation_reads', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => schoolConversations.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  lastReadMessageId: text('last_read_message_id'),
  lastReadAt: integer('last_read_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    conversationUserUnique: uniqueIndex('school_conversation_reads_conversation_user_unique').on(table.conversationId, table.userId),
    userIdx: index('school_conversation_reads_user_idx').on(table.userId),
  }
})

export const schoolNudgeSettings = sqliteTable('school_nudge_settings', {
  schoolName: text('school_name').primaryKey(),
  scheduledNudgesEnabled: integer('scheduled_nudges_enabled', { mode: 'boolean' }).notNull().default(true),
  updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  updatedByEmail: text('updated_by_email'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const onboardingTaskReminderLog = sqliteTable('onboarding_task_reminder_log', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  asanaTaskId: text('asana_task_id').notNull(),
  taskName: text('task_name').notNull(),
  dueDate: text('due_date').notNull(),
  reminderType: text('reminder_type').notNull(),
  clientEmail: text('client_email').notNull(),
  status: text('status').notNull(),
  error: text('error'),
  sentAt: integer('sent_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolNameIdx: index('onboarding_task_reminder_log_school_name_idx').on(table.schoolName),
    dueDateIdx: index('onboarding_task_reminder_log_due_date_idx').on(table.dueDate),
    reminderUnique: uniqueIndex('onboarding_task_reminder_log_unique').on(table.schoolName, table.asanaTaskId, table.dueDate, table.reminderType),
  }
})

export const asanaConnections = sqliteTable('asana_connections', {
  id: text('id').primaryKey(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }).notNull(),
  scope: text('scope'),
  connectedByUserId: text('connected_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  connectedByEmail: text('connected_by_email').notNull(),
  connectedByName: text('connected_by_name'),
  connectedAt: integer('connected_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const asanaOAuthSettings = sqliteTable('asana_oauth_settings', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  encryptedClientSecret: text('encrypted_client_secret').notNull(),
  redirectUri: text('redirect_uri'),
  updatedByUserId: text('updated_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  updatedByEmail: text('updated_by_email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const asanaProjectSettings = sqliteTable('asana_project_settings', {
  id: text('id').primaryKey(),
  projectTemplateGid: text('project_template_gid').notNull(),
  projectTemplateName: text('project_template_name').notNull(),
  workspaceGid: text('workspace_gid'),
  teamGid: text('team_gid'),
  updatedByUserId: text('updated_by_user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  updatedByEmail: text('updated_by_email').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export const schoolAsanaProjects = sqliteTable('school_asana_projects', {
  id: text('id').primaryKey(),
  schoolName: text('school_name').notNull(),
  asanaProjectGid: text('asana_project_gid'),
  asanaProjectName: text('asana_project_name').notNull(),
  asanaProjectTemplateGid: text('asana_project_template_gid'),
  asanaWorkspaceGid: text('asana_workspace_gid'),
  asanaTeamGid: text('asana_team_gid'),
  asanaJobGid: text('asana_job_gid'),
  status: text('status').notNull().default('pending'), // 'pending' | 'creating' | 'ready' | 'failed'
  lastError: text('last_error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
}, (table) => {
  return {
    schoolNameIdx: uniqueIndex('school_asana_projects_school_name_unique').on(table.schoolName),
    projectGidIdx: index('school_asana_projects_project_gid_idx').on(table.asanaProjectGid),
    statusIdx: index('school_asana_projects_status_idx').on(table.status),
  }
})

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  occurredAt: integer('occurred_at', { mode: 'timestamp' }).notNull(),
  actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
  actorEmail: text('actor_email'),
  actorName: text('actor_name'),
  actorRole: text('actor_role'),
  surface: text('surface').notNull(), // 'admin' | 'vertex' | 'client' | 'system'
  category: text('category').notNull(),
  action: text('action').notNull(),
  message: text('message').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  schoolName: text('school_name'),
  clientEmail: text('client_email'),
  searchQuery: text('search_query'),
  aiInferenceCategory: text('ai_inference_category'),
  aiModel: text('ai_model'),
  aiDiagnostic: text('ai_diagnostic'),
  aiLatencyMs: integer('ai_latency_ms'),
  metadata: text('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
}, (table) => {
  return {
    occurredAtIdx: index('audit_log_occurred_at_idx').on(table.occurredAt),
    surfaceCategoryIdx: index('audit_log_surface_category_idx').on(table.surface, table.category),
    actorRoleIdx: index('audit_log_actor_role_idx').on(table.actorRole),
    aiInferenceCategoryIdx: index('audit_log_ai_inference_category_idx').on(table.aiInferenceCategory),
  }
})
