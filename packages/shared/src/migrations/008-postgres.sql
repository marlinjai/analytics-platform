-- Migration 008: Configurable minimum sessions per variant for experiments
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS min_sessions_per_variant INTEGER NOT NULL DEFAULT 100;
