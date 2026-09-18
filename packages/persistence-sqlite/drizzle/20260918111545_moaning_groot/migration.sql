CREATE TABLE `graphs` (
	`canvas_id` text PRIMARY KEY,
	CONSTRAINT `fk_graphs_canvas_id_canvases_id_fk` FOREIGN KEY (`canvas_id`) REFERENCES `canvases`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `graphs` (`canvas_id`) SELECT `id` FROM `canvases`;
