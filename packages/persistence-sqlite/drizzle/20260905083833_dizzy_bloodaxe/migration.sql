ALTER TABLE `connections` RENAME COLUMN `out_io_id` TO `out_io`;--> statement-breakpoint
UPDATE `connections` SET `out_io` = json_object('_tag', 'Port', 'id', `out_io`);--> statement-breakpoint
ALTER TABLE `nodes` ADD `split_scope_outputs` text;
