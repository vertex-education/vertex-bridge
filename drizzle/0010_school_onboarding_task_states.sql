CREATE TABLE `school_onboarding_task_states` (
	`asana_task_id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`task_name` text NOT NULL,
	`completed` integer NOT NULL,
	`source` text NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `school_onboarding_task_states_school_name_idx` ON `school_onboarding_task_states` (`school_name`);--> statement-breakpoint
CREATE INDEX `school_onboarding_task_states_completed_idx` ON `school_onboarding_task_states` (`completed`);
