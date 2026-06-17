CREATE TABLE `asana_oauth_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`encrypted_client_secret` text NOT NULL,
	`redirect_uri` text,
	`updated_by_user_id` text NOT NULL,
	`updated_by_email` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
