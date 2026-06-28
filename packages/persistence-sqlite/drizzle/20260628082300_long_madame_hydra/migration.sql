CREATE TABLE `connections` (
	`id` text PRIMARY KEY,
	`out_node_id` text NOT NULL,
	`out_io_id` text NOT NULL,
	`in_node_id` text NOT NULL,
	`in_io_id` text NOT NULL,
	`graph_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graphs` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`properties` text NOT NULL,
	`schema_package` text NOT NULL,
	`schema_schema` text NOT NULL,
	`position_x` real NOT NULL,
	`position_y` real NOT NULL,
	`graph_id` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `project_meta` (
	`name` text NOT NULL
);
