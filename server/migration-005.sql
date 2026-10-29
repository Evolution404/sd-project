-- Treat voltage levels as a managed system dictionary without replacing their
-- existing stable IDs or the foreign keys referencing voltage_levels.
ALTER TABLE voltage_levels ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0);
ALTER TABLE voltage_levels ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;
ALTER TABLE voltage_levels ADD COLUMN updated_at TEXT;
