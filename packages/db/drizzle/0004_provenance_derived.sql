-- `derived` joins fetched / verified / ai_filled: a value computed from other values stated on
-- the same SKU (luminous intensity from flux and beam angle, fill factor from Vmp/Imp/Voc/Isc).
-- It is not read off a source and it is not a guess, so it needed its own name. The formula
-- travels in sku_attribute_values.note.
--
-- The rest of drizzle's generated delta for this snapshot was already applied by the
-- hand-written 0001-0003 migrations, which its snapshot did not know about; re-running those
-- statements would fail on columns that exist. Only the enum is a real change.
ALTER TABLE `sku_attribute_values` MODIFY COLUMN `provenance` enum('fetched','verified','ai_filled','derived') NOT NULL DEFAULT 'ai_filled';
