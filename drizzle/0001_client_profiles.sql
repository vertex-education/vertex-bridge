CREATE TABLE `client_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`state` text NOT NULL,
	`services` text NOT NULL,
	`client_type` text NOT NULL,
	`primary_contact_name` text NOT NULL,
	`primary_contact_email` text NOT NULL,
	`onboarding_coordinator` text NOT NULL,
	`onboarding_start_date` text NOT NULL,
	`hubspot_company_id` text NOT NULL,
	`hubspot_deal_id` text NOT NULL,
	`lifecycle_stage` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `client_profiles_school_name_unique` ON `client_profiles` (`school_name`);
