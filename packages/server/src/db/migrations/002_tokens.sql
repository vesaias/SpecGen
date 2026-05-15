-- 002_tokens.sql — Encrypted connector token storage (Task D.2)
--
-- Extends the existing `connector_tokens` table (created in 001_init.sql) with
-- AES-256-GCM crypto fields and operational metadata. The base columns
-- (id, project_id, connector_id, ciphertext, created_at) plus the unique
-- (project_id, connector_id) index are already in place from 001.
--
-- Adds:
--   iv           — 12-byte GCM nonce
--   auth_tag     — 16-byte GCM auth tag
--   label        — optional human label (e.g. "Main repo")
--   last4        — last 4 chars of token, for redacted display
--   last_used_at — bumped on successful decrypt
--   key_version  — supports future master-key rotation (always 1 today)

ALTER TABLE connector_tokens ADD COLUMN iv BLOB NOT NULL DEFAULT x'';
ALTER TABLE connector_tokens ADD COLUMN auth_tag BLOB NOT NULL DEFAULT x'';
ALTER TABLE connector_tokens ADD COLUMN label TEXT;
ALTER TABLE connector_tokens ADD COLUMN last4 TEXT;
ALTER TABLE connector_tokens ADD COLUMN last_used_at TEXT;
ALTER TABLE connector_tokens ADD COLUMN key_version INTEGER NOT NULL DEFAULT 1;
