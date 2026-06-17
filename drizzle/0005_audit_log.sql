CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`actor_user_id` text,
	`actor_email` text,
	`actor_name` text,
	`actor_role` text,
	`surface` text NOT NULL,
	`category` text NOT NULL,
	`action` text NOT NULL,
	`message` text NOT NULL,
	`entity_type` text,
	`entity_id` text,
	`school_name` text,
	`client_email` text,
	`search_query` text,
	`ai_inference_category` text,
	`ai_model` text,
	`ai_diagnostic` text,
	`ai_latency_ms` integer,
	`metadata` text,
	`ip_address` text,
	`user_agent` text,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE INDEX `audit_log_occurred_at_idx` ON `audit_log` (`occurred_at`);
CREATE INDEX `audit_log_surface_category_idx` ON `audit_log` (`surface`,`category`);
CREATE INDEX `audit_log_actor_role_idx` ON `audit_log` (`actor_role`);
CREATE INDEX `audit_log_ai_inference_category_idx` ON `audit_log` (`ai_inference_category`);
