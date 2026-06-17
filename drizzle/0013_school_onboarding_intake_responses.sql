CREATE TABLE `school_onboarding_intake_responses` (
	`school_name` text PRIMARY KEY NOT NULL,
	`response_json` text NOT NULL,
	`completed_step_ids_json` text NOT NULL,
	`submitted_by_user_id` text,
	`submitted_by_email` text,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`submitted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `school_onboarding_intake_responses_updated_at_idx` ON `school_onboarding_intake_responses` (`updated_at`);
