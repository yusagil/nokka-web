-- Daily admin digest of new access requests (GET /api/cron/application-digest). Each request is put
-- into exactly one batch; a batch keeps its count (and so its mail payload) across retries. No
-- names or emails are copied here: items only link request ids to their batch.
CREATE TABLE application_digest_runs (
  id uuid PRIMARY KEY,
  -- sending: a cron call holds the lease and is talking to the mail provider.
  -- failed: the provider refused the mail (not sent); the next call retries it with a new key.
  -- unknown: it may or may not have been sent; retried with the same key while the provider still
  --   remembers it, then with a new key (the admin may get that digest twice).
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown', 'skipped')),
  application_count integer NOT NULL CHECK (application_count >= 0),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Provider Idempotency-Key and when it was first sent (the provider keeps keys for 24 hours).
  idempotency_key text CHECK (char_length(idempotency_key) BETWEEN 1 AND 256),
  idempotency_key_used_at timestamptz,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  first_attempted_at timestamptz,
  last_attempted_at timestamptz,
  -- When the provider accepted the mail (not when it reached the inbox).
  sent_at timestamptz,
  provider_message_id text,
  -- Short machine code only (for example resend_403_validation_error); never provider messages.
  error_code text,
  CONSTRAINT application_digest_runs_lease_check CHECK ((status = 'sending') = (lease_expires_at IS NOT NULL)),
  CONSTRAINT application_digest_runs_sent_check CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

-- At most one unfinished batch: it must be delivered or resolved before the next one is formed.
CREATE UNIQUE INDEX application_digest_runs_open_key
  ON application_digest_runs ((true))
  WHERE status IN ('sending', 'failed', 'unknown');

CREATE INDEX application_digest_runs_sent_at_idx
  ON application_digest_runs (sent_at)
  WHERE status = 'sent';

CREATE TABLE application_digest_items (
  application_id bigint PRIMARY KEY REFERENCES access_applications (id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES application_digest_runs (id)
);

CREATE INDEX application_digest_items_run_id_idx ON application_digest_items (run_id);

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE application_digest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_digest_items ENABLE ROW LEVEL SECURITY;
