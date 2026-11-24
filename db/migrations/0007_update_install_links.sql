-- Private first-install links (/install#<token>, then POST /api/updates/v1/install/session and GET/HEAD
-- /api/updates/v1/install/{ref}/Nokka.dmg). The operator issues one from the admin inbox for a request
-- whose updates are allowed and hands it to that person; it serves one stored package until it expires,
-- is revoked or replaced, the approval is withdrawn or the package is withdrawn. Only the token's SHA-256
-- is stored. Depends on 0005 and 0006.

-- The package new install links serve: the bridge build (staged and verified, never in the protected
-- feed) or a published build. NULL: no link can be issued. Set by the release tool
-- (scripts/update-packages.mjs installer), which also clears it when that build is withdrawn.
ALTER TABLE update_channel
  ADD COLUMN installer_build integer REFERENCES update_packages (build);

ALTER TABLE update_channel_events
  DROP CONSTRAINT update_channel_events_action_check,
  ADD CONSTRAINT update_channel_events_action_check
    CHECK (action IN ('init', 'publish', 'rollback', 'withdraw', 'installer'));

CREATE TABLE update_install_links (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  -- Random and not secret: names this link's download address and cookie, so links opened in several
  -- tabs never share one. It opens nothing without the token.
  ref uuid NOT NULL UNIQUE,
  application_id bigint NOT NULL REFERENCES access_applications (id) ON DELETE CASCADE,
  -- The package this link was issued for; a later installer change does not move it.
  build integer NOT NULL REFERENCES update_packages (build),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Revoked by the operator, replaced by a newer link for the same request, or ended with the approval.
  revoked_at timestamptz,
  -- GET responses that started sending package bytes (whole or a range), for the operator's check.
  -- No addresses, agents or ranges are kept.
  download_count integer NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  last_download_at timestamptz,
  CONSTRAINT update_install_links_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT update_install_links_download_check CHECK ((download_count = 0) = (last_download_at IS NULL))
);

-- At most one link per request that has not been revoked: issuing a new one revokes the old one first.
CREATE UNIQUE INDEX update_install_links_one_open_idx
  ON update_install_links (application_id) WHERE revoked_at IS NULL;
CREATE INDEX update_install_links_build_idx ON update_install_links (build);

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE update_install_links ENABLE ROW LEVEL SECURITY;
