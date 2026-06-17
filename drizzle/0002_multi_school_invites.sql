DROP INDEX IF EXISTS `invitations_email_unique`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `invitations_email_school_unique` ON `invitations` (`email`, `school_name`);
