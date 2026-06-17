ALTER TABLE `school_onboarding_task_states` ADD `due_date` text;
--> statement-breakpoint
CREATE TABLE `school_nudge_settings` (
	`school_name` text PRIMARY KEY NOT NULL,
	`scheduled_nudges_enabled` integer DEFAULT true NOT NULL,
	`updated_by_user_id` text,
	`updated_by_email` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `onboarding_task_reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`asana_task_id` text NOT NULL,
	`task_name` text NOT NULL,
	`due_date` text NOT NULL,
	`reminder_type` text NOT NULL,
	`client_email` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`sent_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `onboarding_task_reminder_log_school_name_idx` ON `onboarding_task_reminder_log` (`school_name`);
--> statement-breakpoint
CREATE INDEX `onboarding_task_reminder_log_due_date_idx` ON `onboarding_task_reminder_log` (`due_date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `onboarding_task_reminder_log_unique` ON `onboarding_task_reminder_log` (`school_name`,`asana_task_id`,`due_date`,`reminder_type`);
