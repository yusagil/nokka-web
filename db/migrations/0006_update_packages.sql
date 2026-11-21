-- Protected Sparkle packages for registered Macs (GET/HEAD /api/updates/v1/appcast.xml and
-- /api/updates/v1/packages/{build}/Nokka.dmg). The release tool (scripts/update-packages.mjs) loads a
-- notarized DMG in fixed-size chunks, reads it back against its SHA-256 and only then moves the
-- channel pointer, in one transaction. The API serves these rows only after the registration check;
-- nothing here is public and no row holds a URL to another copy of the bytes.

CREATE TABLE update_packages (
  -- CFBundleVersion. A build number names one package forever: rows are never deleted once offered,
  -- so a withdrawn build can not come back with other bytes.
  build integer PRIMARY KEY CHECK (build > 0),
  short_version text NOT NULL CHECK (short_version ~ '^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$'),
  minimum_system_version text NOT NULL CHECK (minimum_system_version ~ '^[0-9]{1,3}(\.[0-9]{1,3}){0,2}$'),
  byte_length bigint NOT NULL CHECK (byte_length > 0),
  sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
  -- Sparkle EdDSA signature of the exact DMG bytes (64 bytes, standard base64).
  ed_signature text NOT NULL CHECK (ed_signature ~ '^[A-Za-z0-9+/]{86}==$'),
  -- arm64 CDHash of the signed app inside (lowercase hex), sent as <nokka:targetCDHash>.
  target_cdhash text NOT NULL CHECK (target_cdhash ~ '^[0-9a-f]{40}$'),
  -- Plain text shown in the update window; no markup and no external resources.
  release_notes text NOT NULL DEFAULT '' CHECK (char_length(release_notes) <= 20000),
  chunk_size integer NOT NULL CHECK (chunk_size BETWEEN 65536 AND 4194304),
  chunk_count integer NOT NULL CHECK (chunk_count > 0),
  -- staged: bytes are being loaded or checked, never served. published: offered by the channel at
  -- least once and downloadable. withdrawn: never served again.
  state text NOT NULL DEFAULT 'staged' CHECK (state IN ('staged', 'published', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Set by a full read-back whose length and SHA-256 matched; the chunks are frozen from then on.
  verified_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz,
  CONSTRAINT update_packages_chunks_check
    CHECK (chunk_count::bigint = (byte_length + chunk_size - 1) / chunk_size),
  CONSTRAINT update_packages_published_check
    CHECK (state <> 'published' OR (verified_at IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT update_packages_withdrawn_check CHECK ((state = 'withdrawn') = (withdrawn_at IS NOT NULL)),
  -- Target of the channel pointer below: the pointed build must stay 'published'.
  CONSTRAINT update_packages_build_state_key UNIQUE (build, state)
);

CREATE TABLE update_package_chunks (
  build integer NOT NULL REFERENCES update_packages (build),
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  data bytea NOT NULL CHECK (octet_length(data) > 0),
  PRIMARY KEY (build, chunk_index)
);

-- DMG bytes are already compressed: store them out of line without compression, so a range read
-- (substring) fetches only the TOAST slices it needs.
ALTER TABLE update_package_chunks ALTER COLUMN data SET STORAGE EXTERNAL;

-- One row once the release tool initializes the protected channel. No row means an empty feed.
CREATE TABLE update_channel (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- B: the bridge build the 2.6.2 public feed installs. Every protected build is above it.
  bridge_build integer NOT NULL CHECK (bridge_build > 22),
  -- The build in the protected feed, or NULL for an empty channel (none yet, or rolled back to none).
  current_build integer,
  current_state text NOT NULL DEFAULT 'published' CHECK (current_state = 'published'),
  -- Highest build ever published here; a new publication must be above it and above bridge_build.
  high_water_build integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT update_channel_current_fkey
    FOREIGN KEY (current_build, current_state) REFERENCES update_packages (build, state),
  CONSTRAINT update_channel_high_water_check
    CHECK (high_water_build IS NULL OR high_water_build > bridge_build),
  CONSTRAINT update_channel_current_check
    CHECK (current_build IS NULL OR (high_water_build IS NOT NULL AND current_build <= high_water_build))
);

-- What the release tool changed, in order (no people, tokens or bytes).
CREATE TABLE update_channel_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('init', 'publish', 'rollback', 'withdraw')),
  build integer,
  previous_build integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A package description never changes and chunks are written once, only until the package is
-- verified. A package that was never offered (and its chunks) can be discarded whole. Only the state
-- columns move, and only forwards.
CREATE FUNCTION update_packages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only a package that was never offered can be discarded (its build number was never seen).
    IF OLD.state <> 'staged' THEN
      RAISE EXCEPTION 'update package % was offered and can not be deleted', OLD.build
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.build, NEW.short_version, NEW.minimum_system_version, NEW.byte_length, NEW.sha256,
      NEW.ed_signature, NEW.target_cdhash, NEW.release_notes, NEW.chunk_size, NEW.chunk_count,
      NEW.created_at)
     IS DISTINCT FROM
     (OLD.build, OLD.short_version, OLD.minimum_system_version, OLD.byte_length, OLD.sha256,
      OLD.ed_signature, OLD.target_cdhash, OLD.release_notes, OLD.chunk_size, OLD.chunk_count,
      OLD.created_at) THEN
    RAISE EXCEPTION 'update package % is immutable', OLD.build USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'update package % is already verified', OLD.build USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT ((OLD.state = NEW.state)
          OR (OLD.state = 'staged' AND NEW.state IN ('published', 'withdrawn'))
          OR (OLD.state = 'published' AND NEW.state = 'withdrawn')) THEN
    RAISE EXCEPTION 'update package % can not go from % to %', OLD.build, OLD.state, NEW.state
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_packages_guard
  BEFORE UPDATE OR DELETE ON update_packages
  FOR EACH ROW EXECUTE FUNCTION update_packages_guard();

CREATE FUNCTION update_package_chunks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.build ELSE NEW.build END;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'update package chunks are written once' USING ERRCODE = 'restrict_violation';
  END IF;
  -- FOR SHARE: a verification (which locks the package row FOR UPDATE) waits for this write, or this
  -- write for it.
  PERFORM 1 FROM update_packages
    WHERE build = target AND state = 'staged' AND (TG_OP = 'DELETE' OR verified_at IS NULL)
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'update package % is not open for loading', target USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER update_package_chunks_guard
  BEFORE INSERT OR UPDATE OR DELETE ON update_package_chunks
  FOR EACH ROW EXECUTE FUNCTION update_package_chunks_guard();

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE update_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_package_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE update_channel_events ENABLE ROW LEVEL SECURITY;
