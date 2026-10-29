-- 设计草案：仅覆盖线路、物理杆塔、逻辑杆塔及其历史。
-- 本文件不创建业务数据库，不代表完整系统迁移。
-- 时间采用规范UTC文本，历史有效区间为[valid_from, valid_to)。
-- 名称/关联的当前值与历史须由应用在同一事务更新；
-- 历史区间重叠、父对象启用状态和业务引用保护另需后端校验。
PRAGMA foreign_keys = ON;

CREATE TABLE voltage_levels (
    id TEXT NOT NULL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE CHECK (length(trim(code)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE transmission_lines (
    id TEXT NOT NULL PRIMARY KEY,
    line_code TEXT NOT NULL UNIQUE CHECK (length(trim(line_code)) > 0),
    voltage_level_id TEXT NOT NULL REFERENCES voltage_levels(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE physical_towers (
    id TEXT NOT NULL PRIMARY KEY,
    tower_code TEXT NOT NULL UNIQUE CHECK (length(trim(tower_code)) > 0),
    asset_no TEXT,
    tower_type TEXT,
    longitude REAL,
    latitude REAL,
    commissioned_on TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'inactive', 'retired')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (
        (longitude IS NULL AND latitude IS NULL)
        OR (longitude IS NOT NULL AND latitude IS NOT NULL
            AND longitude BETWEEN -180 AND 180
            AND latitude BETWEEN -90 AND 90)
    )
);

CREATE TABLE logical_towers (
    id TEXT NOT NULL PRIMARY KEY,
    logical_code TEXT NOT NULL UNIQUE CHECK (length(trim(logical_code)) > 0),
    line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
    physical_tower_id TEXT REFERENCES physical_towers(id) ON DELETE RESTRICT,
    tower_no TEXT NOT NULL CHECK (length(trim(tower_no)) > 0),
    display_name TEXT,
    sort_rank INTEGER NOT NULL CHECK (sort_rank > 0),
    circuit_position TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'active', 'inactive')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (status <> 'active' OR physical_tower_id IS NOT NULL)
);

CREATE INDEX idx_lines_voltage ON transmission_lines(voltage_level_id);
CREATE INDEX idx_logical_towers_physical ON logical_towers(physical_tower_id);
CREATE INDEX idx_logical_towers_name ON logical_towers(line_id, tower_no);
CREATE UNIQUE INDEX uq_logical_towers_active_order
    ON logical_towers(line_id, sort_rank) WHERE status = 'active';

CREATE TABLE line_name_history (
    id TEXT NOT NULL PRIMARY KEY,
    line_id TEXT NOT NULL REFERENCES transmission_lines(id) ON DELETE RESTRICT,
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (line_id, valid_from)
);

CREATE UNIQUE INDEX uq_line_name_current
    ON line_name_history(line_id) WHERE valid_to IS NULL;

CREATE TABLE logical_tower_name_history (
    id TEXT NOT NULL PRIMARY KEY,
    logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
    tower_no TEXT NOT NULL CHECK (length(trim(tower_no)) > 0),
    display_name TEXT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (logical_tower_id, valid_from)
);

CREATE UNIQUE INDEX uq_logical_name_current
    ON logical_tower_name_history(logical_tower_id) WHERE valid_to IS NULL;

CREATE TABLE logical_tower_physical_history (
    id TEXT NOT NULL PRIMARY KEY,
    logical_tower_id TEXT NOT NULL REFERENCES logical_towers(id) ON DELETE RESTRICT,
    physical_tower_id TEXT NOT NULL REFERENCES physical_towers(id) ON DELETE RESTRICT,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    change_kind TEXT NOT NULL
        CHECK (change_kind IN ('initial', 'correction', 'replacement')),
    changed_by TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
    recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (valid_to IS NULL OR valid_to > valid_from),
    UNIQUE (logical_tower_id, valid_from)
);

CREATE UNIQUE INDEX uq_logical_physical_current
    ON logical_tower_physical_history(logical_tower_id) WHERE valid_to IS NULL;
CREATE INDEX idx_physical_history_lookup
    ON logical_tower_physical_history(physical_tower_id, valid_from, valid_to);
