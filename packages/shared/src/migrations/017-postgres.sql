-- Migration 017: GDPR erasure (Art. 17) consumer idempotency ledger.
--
-- auth-brain fans out signed tenant.erased / user.erased webhooks with
-- at-least-once retries. erasure_events is the ledger that makes the consumer
-- idempotent: a replay of a completed event_id is a 200 no-op, and a row whose
-- completed_at is NULL marks an incomplete (retryable) attempt whose remaining
-- deletion work the next retry re-drives. We store only the opaque event id and
-- its kind, never any part of the payload body (it carries a user id).

CREATE TABLE IF NOT EXISTS erasure_events (
    event_id     TEXT PRIMARY KEY,
    kind         TEXT NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);
