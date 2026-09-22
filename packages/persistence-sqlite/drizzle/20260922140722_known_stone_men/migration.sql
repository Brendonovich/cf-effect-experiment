CREATE TABLE `queues` (
	`canvas_id` text PRIMARY KEY,
	`arguments` text NOT NULL,
	`returns` text NOT NULL,
	`input_position` text NOT NULL,
	`output_position` text NOT NULL,
	CONSTRAINT `fk_queues_canvas_id_canvases_id_fk` FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON DELETE CASCADE
);
