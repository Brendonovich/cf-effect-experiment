ALTER TABLE `connections` ADD `out_io` text NOT NULL;--> statement-breakpoint
ALTER TABLE `nodes` ADD `split_scope_outputs` text;--> statement-breakpoint
ALTER TABLE `connections` DROP COLUMN `out_io_id`;