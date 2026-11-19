-- Private list of Nokka access requests submitted from the website (POST /api/applications).
CREATE TABLE access_applications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  -- Duplicate key: trimmed and lower-cased only (no dot or plus-alias folding).
  email_normalized text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT access_applications_email_normalized_key UNIQUE (email_normalized)
);

-- Short-lived request counters keyed by an HMAC of the client IP. Raw IPs are never stored and
-- finished windows are deleted by the API.
CREATE TABLE application_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0)
);

CREATE INDEX application_rate_limits_window_started_at_idx
  ON application_rate_limits (window_started_at);

-- RLS without policies: hosted data APIs (for example Supabase's anon/authenticated roles) get no
-- rows. The owning role that ran this migration bypasses RLS, so the server must connect as it.
ALTER TABLE access_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE application_rate_limits ENABLE ROW LEVEL SECURITY;
