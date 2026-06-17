CREATE TABLE `school_asana_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`school_name` text NOT NULL,
	`asana_project_gid` text,
	`asana_project_name` text NOT NULL,
	`asana_project_template_gid` text,
	`asana_workspace_gid` text,
	`asana_team_gid` text,
	`asana_job_gid` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_asana_projects_school_name_unique` ON `school_asana_projects` (`school_name`);
--> statement-breakpoint
CREATE INDEX `school_asana_projects_project_gid_idx` ON `school_asana_projects` (`asana_project_gid`);
--> statement-breakpoint
CREATE INDEX `school_asana_projects_status_idx` ON `school_asana_projects` (`status`);
