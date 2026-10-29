-- Exact per-host inbound IP allowlist, disabled for non-loopback until explicitly populated.
CREATE TABLE IF NOT EXISTS allowed_ips (
 id TEXT PRIMARY KEY, ip TEXT NOT NULL UNIQUE, note TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);
