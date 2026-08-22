CREATE TABLE `project_execution_nodes` (
	`id` text PRIMARY KEY,
	`execution_id` text NOT NULL,
	`step_name` text NOT NULL,
	`graph_id` text NOT NULL,
	`event_node_id` text NOT NULL,
	`node_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`error` text,
	CONSTRAINT `fk_project_execution_nodes_execution_id_project_executions_id_fk` FOREIGN KEY (`execution_id`) REFERENCES `project_executions`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `project_executions` ADD `event_payload` text;--> statement-breakpoint
CREATE UNIQUE INDEX `project_execution_nodes_execution_step_unique` ON `project_execution_nodes` (`execution_id`,`step_name`);--> statement-breakpoint
CREATE INDEX `project_execution_nodes_execution_started_idx` ON `project_execution_nodes` (`execution_id`,`started_at`);