CREATE TABLE `asana_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text NOT NULL,
	`access_token_expires_at` integer NOT NULL,
	`scope` text,
	`connected_by_user_id` text NOT NULL,
	`connected_by_email` text NOT NULL,
	`connected_by_name` text,
	`connected_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connected_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
