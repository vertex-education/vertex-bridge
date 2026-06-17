CREATE TABLE `school_conversations` (
  `id` text PRIMARY KEY NOT NULL,
  `school_name` text NOT NULL,
  `channel` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_conversations_school_channel_unique` ON `school_conversations` (`school_name`, `channel`);
--> statement-breakpoint
CREATE INDEX `school_conversations_school_name_idx` ON `school_conversations` (`school_name`);
--> statement-breakpoint
CREATE TABLE `school_conversation_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `school_name` text NOT NULL,
  `channel` text NOT NULL,
  `sender_type` text NOT NULL,
  `sender_user_id` text,
  `sender_email` text,
  `sender_name` text,
  `body` text NOT NULL,
  `ai_model` text,
  `ai_diagnostic` text,
  `metadata` text,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `school_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`sender_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `school_conversation_messages_conversation_created_at_idx` ON `school_conversation_messages` (`conversation_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX `school_conversation_messages_school_channel_created_at_idx` ON `school_conversation_messages` (`school_name`, `channel`, `created_at`);
--> statement-breakpoint
CREATE TABLE `school_conversation_reads` (
  `id` text PRIMARY KEY NOT NULL,
  `conversation_id` text NOT NULL,
  `user_id` text NOT NULL,
  `last_read_message_id` text,
  `last_read_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`conversation_id`) REFERENCES `school_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_conversation_reads_conversation_user_unique` ON `school_conversation_reads` (`conversation_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX `school_conversation_reads_user_idx` ON `school_conversation_reads` (`user_id`);
