-- Private admin inbox: operator status and note on each request, plus Better Auth tables for the single
-- GitHub admin. Existing requests keep their name, email and created_at and start as 'new'.
ALTER TABLE access_applications
  ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'hold', 'contacted')),
  ADD COLUMN operator_note text NOT NULL DEFAULT '' CHECK (char_length(operator_note) <= 500),
  ADD COLUMN last_contacted_at timestamptz,
  -- Optimistic-concurrency token; millisecond precision so it round-trips through JSON exactly.
  ADD COLUMN updated_at timestamptz(3) NOT NULL DEFAULT now();

UPDATE access_applications SET updated_at = created_at;

CREATE INDEX access_applications_created_at_id_idx
  ON access_applications (created_at DESC, id DESC);
CREATE INDEX access_applications_status_created_at_id_idx
  ON access_applications (status, created_at DESC, id DESC);

-- Better Auth 1.7.26 schema (getMigrations output for the auth_* model names).
CREATE TABLE "auth_user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" boolean NOT NULL,
  "image" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "auth_session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE
);

CREATE TABLE "auth_account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz NOT NULL,
  -- Added here: one local account per provider identity.
  CONSTRAINT auth_account_provider_account_key UNIQUE ("providerId", "accountId")
);

CREATE TABLE "auth_verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("userId");
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("userId");
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE "auth_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "auth_verification" ENABLE ROW LEVEL SECURITY;
