ALTER TABLE `sku_images` ADD `source_kind` enum('curated','official_page','official_pdf','distributor','unknown') NOT NULL DEFAULT 'unknown';
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `quality_score` decimal(3,2);
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `judge_json` json;
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `cutout_key` varchar(255);
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `soft` boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `phash` varchar(16);
--> statement-breakpoint
ALTER TABLE `sku_images` ADD `source_sha1` varchar(40);
--> statement-breakpoint
CREATE INDEX `sku_images_quality_idx` ON `sku_images` (`quality_score`);
--> statement-breakpoint
ALTER TABLE `sku_attribute_values` ADD `note` varchar(512);
--> statement-breakpoint
ALTER TABLE `skus` ADD `price_checked_at` datetime;
