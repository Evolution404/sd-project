-- Cross-batch duplicate review. Existing demand identities and work quantities
-- remain unchanged when attaching another source to an existing demand.
CREATE TABLE demand_duplicate_reviews (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 matched_demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 new_demand_id TEXT REFERENCES demands(id) ON DELETE RESTRICT,
 decision TEXT NOT NULL CHECK(decision IN ('separate','link')),
 reason TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_duplicate_review_batch ON demand_duplicate_reviews(batch_id);
CREATE TABLE batch_demand_sources (
 batch_id TEXT NOT NULL REFERENCES demand_batches(id) ON DELETE RESTRICT,
 demand_id TEXT NOT NULL REFERENCES demands(id) ON DELETE RESTRICT,
 source_id TEXT NOT NULL REFERENCES source_records(id) ON DELETE RESTRICT,
 PRIMARY KEY(batch_id,demand_id,source_id)
);
