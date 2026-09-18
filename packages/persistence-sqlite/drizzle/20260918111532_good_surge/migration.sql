CREATE TABLE `functions` (
	`canvas_id` text PRIMARY KEY,
	`arguments` text NOT NULL,
	`returns` text NOT NULL,
	`input_position` text NOT NULL,
	`output_position` text NOT NULL,
	CONSTRAINT `fk_functions_canvas_id_canvases_id_fk` FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE `graphs` RENAME TO `canvases`;--> statement-breakpoint
ALTER TABLE `connections` RENAME COLUMN `graph_id` TO `canvas_id`;--> statement-breakpoint
ALTER TABLE `nodes` RENAME COLUMN `graph_id` TO `canvas_id`;