CREATE TABLE `school_onboarding_progress` (
	`school_name` text PRIMARY KEY NOT NULL,
	`completed_task_count` integer NOT NULL,
	`total_task_count` integer NOT NULL,
	`asana_project_gid` text,
	`source` text NOT NULL,
	`synced_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `school_onboarding_progress_synced_at_idx` ON `school_onboarding_progress` (`synced_at`);
