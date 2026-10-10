CREATE TABLE `scope_projections` (
	`id` text PRIMARY KEY,
	`position_x` real NOT NULL,
	`position_y` real NOT NULL,
	`canvas_id` text NOT NULL,
	CONSTRAINT `fk_scope_projections_canvas_id_canvases_id_fk` FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON DELETE CASCADE
);
