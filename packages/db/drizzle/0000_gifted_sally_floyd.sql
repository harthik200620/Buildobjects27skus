CREATE TABLE `attribute_groups` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`category_id` bigint NOT NULL,
	`key` varchar(48) NOT NULL,
	`label` varchar(120) NOT NULL,
	`display_order` int NOT NULL DEFAULT 0,
	`importance` tinyint NOT NULL DEFAULT 3,
	CONSTRAINT `attribute_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `attr_groups_cat_key_uq` UNIQUE(`category_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `attributes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`group_id` bigint NOT NULL,
	`category_id` bigint NOT NULL,
	`key` varchar(64) NOT NULL,
	`label` varchar(120) NOT NULL,
	`data_type` enum('text','number','boolean','enum') NOT NULL DEFAULT 'text',
	`unit` varchar(24),
	`enum_values` json,
	`is_filterable` boolean NOT NULL DEFAULT false,
	`filter_widget` enum('checkbox','range','toggle','chips'),
	`filter_order` int NOT NULL DEFAULT 100,
	`importance_rank` tinyint NOT NULL DEFAULT 3,
	`show_in_key_specs` boolean NOT NULL DEFAULT false,
	`show_on_card` boolean NOT NULL DEFAULT false,
	`compare` boolean NOT NULL DEFAULT false,
	`synonyms` json NOT NULL DEFAULT ('[]'),
	`display_order` int NOT NULL DEFAULT 0,
	CONSTRAINT `attributes_id` PRIMARY KEY(`id`),
	CONSTRAINT `attributes_cat_key_uq` UNIQUE(`category_id`,`key`)
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`code` varchar(8) NOT NULL,
	`name` varchar(120) NOT NULL,
	`logo_key` varchar(255),
	`official_domains` json NOT NULL DEFAULT ('[]'),
	`intel` json NOT NULL DEFAULT ('{}'),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `brands_id` PRIMARY KEY(`id`),
	CONSTRAINT `brands_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`slug` varchar(64) NOT NULL,
	`code` varchar(8) NOT NULL,
	`name` varchar(120) NOT NULL,
	`name_te` varchar(160),
	`name_hi` varchar(160),
	`icon` varchar(48),
	`hero_image_key` varchar(255),
	`display_order` int NOT NULL DEFAULT 0,
	`unit` varchar(24),
	`spec_template_version` int NOT NULL DEFAULT 1,
	`stats` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `categories_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `estimates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`public_id` varchar(16) NOT NULL,
	`inputs` json NOT NULL,
	`outputs` json NOT NULL,
	`tier` varchar(12) NOT NULL,
	`city` varchar(48) NOT NULL,
	`grand_total` decimal(14,2),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `estimates_id` PRIMARY KEY(`id`),
	CONSTRAINT `estimates_public_uq` UNIQUE(`public_id`)
);
--> statement-breakpoint
CREATE TABLE `filter_configs` (
	`category_id` bigint NOT NULL,
	`config` json NOT NULL,
	`computed_at` datetime NOT NULL,
	CONSTRAINT `filter_configs_category_id` PRIMARY KEY(`category_id`)
);
--> statement-breakpoint
CREATE TABLE `gst_rates` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`category_slug` varchar(64) NOT NULL,
	`hsn` varchar(16) NOT NULL,
	`rate` decimal(5,2) NOT NULL,
	`source` varchar(255),
	`verified_at` datetime,
	`needs_verification` boolean NOT NULL DEFAULT true,
	CONSTRAINT `gst_rates_id` PRIMARY KEY(`id`),
	CONSTRAINT `gst_rates_cat_uq` UNIQUE(`category_slug`)
);
--> statement-breakpoint
CREATE TABLE `ingest_items` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`run_id` bigint NOT NULL,
	`sku_code` varchar(32) NOT NULL,
	`stage` varchar(24) NOT NULL,
	`status` enum('queued','running','done','failed','skipped') NOT NULL DEFAULT 'queued',
	`attempts` int NOT NULL DEFAULT 0,
	`error` text,
	`started_at` datetime,
	`finished_at` datetime,
	`duration_ms` int,
	`meta` json,
	CONSTRAINT `ingest_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ingest_runs` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`started_at` datetime NOT NULL,
	`finished_at` datetime,
	`status` enum('running','done','failed','aborted') NOT NULL DEFAULT 'running',
	`scope` json NOT NULL DEFAULT ('{}'),
	`summary` json,
	CONSTRAINT `ingest_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`phone` varchar(16) NOT NULL,
	`code` varchar(8) NOT NULL,
	`expires_at` datetime NOT NULL,
	`consumed` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `otp_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`category_id` bigint NOT NULL,
	`brand_id` bigint NOT NULL,
	`name` varchar(200) NOT NULL,
	`slug` varchar(160) NOT NULL,
	`model_no` varchar(120),
	`status` enum('active','draft','retired') NOT NULL DEFAULT 'active',
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`),
	CONSTRAINT `products_slug_uq` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `regions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`region_id` varchar(24) NOT NULL,
	`name` varchar(64) NOT NULL,
	`state_code` varchar(4) NOT NULL,
	`pincode_from` varchar(6) NOT NULL,
	`pincode_to` varchar(6) NOT NULL,
	`default_pincode` varchar(6) NOT NULL,
	`serviceable` boolean NOT NULL DEFAULT true,
	`delivery_days` tinyint NOT NULL DEFAULT 3,
	CONSTRAINT `regions_id` PRIMARY KEY(`id`),
	CONSTRAINT `regions_region_uq` UNIQUE(`region_id`)
);
--> statement-breakpoint
CREATE TABLE `search_synonyms` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`term` varchar(120) NOT NULL,
	`synonyms` json NOT NULL,
	`lang` varchar(8) NOT NULL DEFAULT 'en',
	`category_slug` varchar(64),
	CONSTRAINT `search_synonyms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` bigint NOT NULL,
	`region_id` varchar(24),
	`pincode` varchar(6),
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sku_attribute_values` (
	`sku_id` bigint NOT NULL,
	`attribute_id` bigint NOT NULL,
	`value_text` varchar(1024),
	`value_number` decimal(18,6),
	`value_bool` boolean,
	`unit_override` varchar(24),
	`provenance` enum('fetched','verified','ai_filled') NOT NULL DEFAULT 'ai_filled',
	`confidence` decimal(3,2),
	`source_url` text,
	`fetched_at` datetime,
	CONSTRAINT `sku_attribute_values_sku_id_attribute_id_pk` PRIMARY KEY(`sku_id`,`attribute_id`)
);
--> statement-breakpoint
CREATE TABLE `sku_documents` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`sku_id` bigint NOT NULL,
	`type` enum('brochure','datasheet','manual','warranty_card','certificate') NOT NULL,
	`title` varchar(200) NOT NULL,
	`storage_key` varchar(255) NOT NULL,
	`source_url` text,
	`pages` int,
	`size_kb` int,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sku_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sku_images` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`sku_id` bigint NOT NULL,
	`position` tinyint NOT NULL,
	`role` enum('hero','angle','in_context','detail','pack_or_dimensions') NOT NULL,
	`alt` varchar(255) NOT NULL DEFAULT '',
	`source_url` text,
	`width` int,
	`height` int,
	`blurhash` varchar(64),
	`storage_key_original` varchar(255) NOT NULL,
	`placeholder` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `sku_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `sku_images_pos_uq` UNIQUE(`sku_id`,`position`)
);
--> statement-breakpoint
CREATE TABLE `skus` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`product_id` bigint NOT NULL,
	`sku_code` varchar(32) NOT NULL,
	`variant_label` varchar(120) NOT NULL DEFAULT '',
	`mrp` decimal(12,2),
	`selling_price` decimal(12,2),
	`price_provenance` enum('fetched','verified','estimated') NOT NULL DEFAULT 'estimated',
	`price_source_url` text,
	`price_note` varchar(255),
	`price_fetched_at` datetime,
	`gst_rate` decimal(5,2) NOT NULL DEFAULT '18.00',
	`gst_needs_verification` boolean NOT NULL DEFAULT false,
	`unit` varchar(24) NOT NULL DEFAULT 'piece',
	`pack_qty` decimal(10,3) NOT NULL DEFAULT '1',
	`stock_status` enum('in_stock','low','out_of_stock','preorder') NOT NULL DEFAULT 'in_stock',
	`short_description` varchar(200) NOT NULL DEFAULT '',
	`long_description` mediumtext,
	`key_specs` json NOT NULL DEFAULT ('[]'),
	`spec_json` json,
	`seo` json,
	`hero_image_key` varchar(255),
	`blurhash` varchar(64),
	`rating_placeholder` decimal(2,1) NOT NULL DEFAULT '4.3',
	`official_url` text,
	`coverage` json,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `skus_id` PRIMARY KEY(`id`),
	CONSTRAINT `skus_code_uq` UNIQUE(`sku_code`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`phone` varchar(16) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`last_login_at` datetime,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_phone_uq` UNIQUE(`phone`)
);
--> statement-breakpoint
ALTER TABLE `attribute_groups` ADD CONSTRAINT `attribute_groups_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attributes` ADD CONSTRAINT `attributes_group_id_attribute_groups_id_fk` FOREIGN KEY (`group_id`) REFERENCES `attribute_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `attributes` ADD CONSTRAINT `attributes_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `filter_configs` ADD CONSTRAINT `filter_configs_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ingest_items` ADD CONSTRAINT `ingest_items_run_id_ingest_runs_id_fk` FOREIGN KEY (`run_id`) REFERENCES `ingest_runs`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_brand_id_brands_id_fk` FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sku_attribute_values` ADD CONSTRAINT `sku_attribute_values_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sku_attribute_values` ADD CONSTRAINT `sku_attribute_values_attribute_id_attributes_id_fk` FOREIGN KEY (`attribute_id`) REFERENCES `attributes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sku_documents` ADD CONSTRAINT `sku_documents_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sku_images` ADD CONSTRAINT `sku_images_sku_id_skus_id_fk` FOREIGN KEY (`sku_id`) REFERENCES `skus`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `skus` ADD CONSTRAINT `skus_product_id_products_id_fk` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attributes_cat_filterable_idx` ON `attributes` (`category_id`,`is_filterable`);--> statement-breakpoint
CREATE INDEX `attributes_group_idx` ON `attributes` (`group_id`);--> statement-breakpoint
CREATE INDEX `categories_order_idx` ON `categories` (`display_order`);--> statement-breakpoint
CREATE INDEX `ingest_items_run_sku_idx` ON `ingest_items` (`run_id`,`sku_code`);--> statement-breakpoint
CREATE INDEX `ingest_items_sku_stage_idx` ON `ingest_items` (`sku_code`,`stage`);--> statement-breakpoint
CREATE INDEX `otp_phone_idx` ON `otp_challenges` (`phone`);--> statement-breakpoint
CREATE INDEX `products_cat_brand_idx` ON `products` (`category_id`,`brand_id`);--> statement-breakpoint
CREATE INDEX `search_synonyms_term_idx` ON `search_synonyms` (`term`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sav_attr_number_idx` ON `sku_attribute_values` (`attribute_id`,`value_number`);--> statement-breakpoint
CREATE INDEX `sav_provenance_idx` ON `sku_attribute_values` (`provenance`);--> statement-breakpoint
CREATE INDEX `sku_documents_sku_idx` ON `sku_documents` (`sku_id`);--> statement-breakpoint
CREATE INDEX `skus_product_idx` ON `skus` (`product_id`);--> statement-breakpoint
CREATE INDEX `skus_price_idx` ON `skus` (`selling_price`);