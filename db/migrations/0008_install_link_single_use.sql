-- Private install links open once. The first successful POST /api/updates/v1/install/session consumes the
-- link's token and gives that browser its own session secret, which the link's download cookie carries; the
-- token opens nothing after that, while the session downloads and resumes until the link closes (expiry,
-- revocation, replacement, approval or package withdrawal, all as in 0007). Only the secret's SHA-256 is
-- stored, like the token's. Depends on 0007.
--
-- Links issued before this migration were never opened under these rules: each can still be opened once
-- until it closes. Download cookies set before it carried the token itself and open nothing any more; the
-- download refuses them (404) and clears them, and opening the link again gives a session.
ALTER TABLE update_install_links
  ADD COLUMN exchanged_at timestamptz,
  ADD COLUMN session_hash bytea UNIQUE CHECK (octet_length(session_hash) = 32),
  ADD CONSTRAINT update_install_links_exchange_check CHECK ((exchanged_at IS NULL) = (session_hash IS NULL));
