ALTER TABLE `invitations` ADD `school_contact_role` text;
--> statement-breakpoint
ALTER TABLE `invitations` ADD `invited_by_user_id` text REFERENCES `user`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `invitations` ADD `invited_by_email` text;
--> statement-breakpoint
UPDATE `invitations`
SET `school_contact_role` = 'school_leader'
WHERE `role` = 'school_user' AND `school_contact_role` IS NULL;
--> statement-breakpoint
UPDATE `user`
SET `role` = 'school_leader'
WHERE `role` = 'school_user';
--> statement-breakpoint
UPDATE `invitations`
SET `role` = 'school_leader'
WHERE `role` = 'school_user';
--> statement-breakpoint
CREATE TABLE `school_contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`user_id` text,
	`email` text NOT NULL,
	`name` text,
	`contact_role` text DEFAULT 'school_staff' NOT NULL,
	`invited_by_user_id` text,
	`invited_by_email` text,
	`accepted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`invited_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_contacts_school_email_unique` ON `school_contacts` (`school_name`,`email`);
--> statement-breakpoint
CREATE INDEX `school_contacts_school_name_idx` ON `school_contacts` (`school_name`);
--> statement-breakpoint
CREATE INDEX `school_contacts_user_id_idx` ON `school_contacts` (`user_id`);
--> statement-breakpoint
CREATE INDEX `school_contacts_invited_by_user_id_idx` ON `school_contacts` (`invited_by_user_id`);
--> statement-breakpoint
CREATE TABLE `school_onboarding_task_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`asana_task_id` text NOT NULL,
	`assigned_to_user_id` text,
	`assigned_to_email` text NOT NULL,
	`assigned_to_name` text,
	`assigned_by_user_id` text,
	`assigned_by_email` text,
	`assigned_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`assigned_to_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assigned_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_onboarding_task_assignments_school_task_unique` ON `school_onboarding_task_assignments` (`school_name`,`asana_task_id`);
--> statement-breakpoint
CREATE INDEX `school_onboarding_task_assignments_school_name_idx` ON `school_onboarding_task_assignments` (`school_name`);
--> statement-breakpoint
CREATE INDEX `school_onboarding_task_assignments_assigned_to_user_id_idx` ON `school_onboarding_task_assignments` (`assigned_to_user_id`);
--> statement-breakpoint
CREATE INDEX `school_onboarding_task_assignments_assigned_to_email_idx` ON `school_onboarding_task_assignments` (`assigned_to_email`);
