CREATE TABLE `project_executions` (
	`id` text PRIMARY KEY,
	`project_id` text NOT NULL,
	`revision_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_id` text,
	`status` text NOT NULL,
	`received_at` text NOT NULL,
	`started_at` text,
	`completed_at` text,
	`error` text,
	CONSTRAINT `fk_project_executions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_project_executions_revision_id_project_revisions_id_fk` FOREIGN KEY (`revision_id`) REFERENCES `project_revisions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `project_executions_project_received_idx` ON `project_executions` (`project_id`,`received_at`);--> statement-breakpoint
CREATE INDEX `project_executions_revision_received_idx` ON `project_executions` (`revision_id`,`received_at`);