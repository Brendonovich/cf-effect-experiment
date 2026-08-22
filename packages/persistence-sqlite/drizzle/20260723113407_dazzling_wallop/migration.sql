CREATE TABLE `http_endpoints` (
	`id` text PRIMARY KEY,
	`namespace` text NOT NULL,
	`handler_id` text NOT NULL,
	`instance_key` text NOT NULL,
	`metadata` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `http_endpoints_logical_key` ON `http_endpoints` (`namespace`,`handler_id`,`instance_key`);