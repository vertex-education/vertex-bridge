CREATE TABLE `task_file_requirements` (
	`asana_task_id` text PRIMARY KEY NOT NULL,
	`task_name` text NOT NULL,
	`task_notes_hash` text NOT NULL,
	`requires_file_upload` integer NOT NULL,
	`reason` text NOT NULL,
	`classifier` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_file_requirements_notes_hash_idx` ON `task_file_requirements` (`task_notes_hash`);--> statement-breakpoint
CREATE INDEX `task_file_requirements_classifier_idx` ON `task_file_requirements` (`classifier`);
