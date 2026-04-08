-- Run once on existing MariaDB installs that already have `packages` without options_json.
-- Safe to run multiple times if your server supports IF NOT EXISTS for columns (MariaDB 10.3.3+):
-- If ALTER fails because column exists, ignore the error.

ALTER TABLE `packages` ADD COLUMN `options_json` TEXT NULL AFTER `output_formats_json`;
