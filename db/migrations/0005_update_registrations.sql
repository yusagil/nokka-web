-- Registered app updates (POST /api/updates/v1/challenges, /registrations, /sessions). The operator
-- explicitly allows updates per access request; an allowed email can register one Mac installation at
-- a time with a mailed one-time code. Existing and new requests start as not allowed. 0004 is left to
-- the update package storage migration; this one only depends on 0001-0003.
ALTER TABLE access_applications
  ADD COLUMN updates_approved boolean NOT NULL DEFAULT false,
  -- Permission generation: +1 on every registration and every approval change. Codes and sessions
  -- remember the generation they were issued in and stop working once it moves on.
  ADD COLUMN updates_generation bigint NOT NULL DEFAULT 0 CHECK (updates_generation >= 0),
  -- The one installation currently allowed to receive updates (foreign key added below).
  ADD COLUMN active_installation_id uuid;

-- A Mac installation's signing key (P-256, X9.63 uncompressed), bound to one request when its first
-- registration commits. The same id never gets another key or another request.
CREATE TABLE update_installations (
  installation_id uuid PRIMARY KEY,
  application_id bigint NOT NULL REFERENCES access_applications (id) ON DELETE CASCADE,
  public_key bytea NOT NULL UNIQUE CHECK (octet_length(public_key) = 65 AND get_byte(public_key, 0) = 4),
  created_at timestamptz NOT NULL DEFAULT now(),
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT update_installations_application_key UNIQUE (installation_id, application_id)
);

CREATE INDEX update_installations_application_id_idx ON update_installations (application_id);

-- The active pointer must name an installation of the same request, and an installation is active for
-- at most one request.
ALTER TABLE access_applications
  ADD CONSTRAINT access_applications_active_installation_fkey
    FOREIGN KEY (active_installation_id, id) REFERENCES update_installations (installation_id, application_id),
  ADD CONSTRAINT access_applications_active_installation_key UNIQUE (active_installation_id);

-- Code requests. Every well-formed request is recorded the same way (so repeated requests look the
-- same whether or not the email is allowed); only rows for an allowed request carry a code. Emails are
-- stored as an HMAC, and codes only as an HMAC bound to the challenge id.
CREATE TABLE update_challenges (
  id uuid PRIMARY KEY,
  email_key text NOT NULL CHECK (email_key ~ '^[0-9a-f]{64}$'),
  installation_id uuid NOT NULL,
  public_key bytea NOT NULL CHECK (octet_length(public_key) = 65 AND get_byte(public_key, 0) = 4),
  application_id bigint REFERENCES access_applications (id) ON DELETE CASCADE,
  generation bigint,
  code_hmac text CHECK (code_hmac ~ '^[0-9a-f]{64}$'),
  -- pending: usable until expires_at; used: consumed by its registration; void: superseded, revoked,
  -- too many wrong codes or the mail was refused.
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'used', 'void')),
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  -- none: no code (not allowed). pending: committed, mail not yet recorded. accepted/rejected/uncertain:
  -- the provider's answer (uncertain = it may have been sent; never resent automatically).
  mail_status text NOT NULL CHECK (mail_status IN ('none', 'pending', 'accepted', 'rejected', 'uncertain')),
  -- Short machine code only (for example gmail_send_400_invalidArgument); never provider messages.
  mail_error_code text CHECK (char_length(mail_error_code) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT update_challenges_code_check CHECK (
    (application_id IS NULL) = (code_hmac IS NULL)
    AND (application_id IS NULL) = (generation IS NULL)
    AND (application_id IS NULL) = (mail_status = 'none')
  ),
  CONSTRAINT update_challenges_used_check CHECK ((state = 'used') = (used_at IS NOT NULL))
);

CREATE INDEX update_challenges_email_key_created_at_idx ON update_challenges (email_key, created_at);
CREATE INDEX update_challenges_installation_created_at_idx ON update_challenges (installation_id, created_at);
CREATE INDEX update_challenges_application_pending_idx ON update_challenges (application_id) WHERE state = 'pending';
CREATE INDEX update_challenges_expires_at_idx ON update_challenges (expires_at);

-- Short-lived update access tokens (stored as SHA-256 only). Valid while unexpired and while the
-- request is allowed, still in the same generation and still points at this installation.
CREATE TABLE update_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  installation_id uuid NOT NULL REFERENCES update_installations (installation_id) ON DELETE CASCADE,
  application_id bigint NOT NULL REFERENCES access_applications (id) ON DELETE CASCADE,
  generation bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX update_sessions_installation_id_idx ON update_sessions (installation_id);
CREATE INDEX update_sessions_application_id_idx ON update_sessions (application_id);
CREATE INDEX update_sessions_expires_at_idx ON update_sessions (expires_at);

-- Session proofs already used (replay guard), kept well past the allowed clock skew.
CREATE TABLE update_session_nonces (
  installation_id uuid NOT NULL REFERENCES update_installations (installation_id) ON DELETE CASCADE,
  nonce_digest bytea NOT NULL CHECK (octet_length(nonce_digest) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, nonce_digest)
);

CREATE INDEX update_session_nonces_created_at_idx ON update_session_nonces (created_at);

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE update_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_session_nonces ENABLE ROW LEVEL SECURITY;
