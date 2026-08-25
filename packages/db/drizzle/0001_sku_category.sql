ALTER TABLE `skus` ADD `category_id` bigint;
--> statement-breakpoint
UPDATE `skus` s JOIN `products` p ON p.id = s.product_id SET s.category_id = p.category_id;
--> statement-breakpoint
ALTER TABLE `skus` ADD CONSTRAINT `skus_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `skus_cat_id_idx` ON `skus` (`category_id`,`id`);
