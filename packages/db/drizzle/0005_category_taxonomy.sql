-- Thirty-seven categories in thirteen departments, nine of them live. The storefront lists
-- every category, so an upcoming one needs a row rather than an absence: it appears in the
-- nav and the sidebar with a zero count instead of vanishing until it has stock.
ALTER TABLE `categories` ADD `department` varchar(64) NOT NULL DEFAULT 'construction-materials';--> statement-breakpoint
ALTER TABLE `categories` ADD `status` enum('live','upcoming') NOT NULL DEFAULT 'upcoming';--> statement-breakpoint
CREATE INDEX `categories_dept_idx` ON `categories` (`department`,`display_order`);
