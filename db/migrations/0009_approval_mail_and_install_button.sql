-- Approval mail and install links that download once. Depends on 0005-0008. Compatible with the version still
-- running while it is applied: it only adds a table, nullable columns and columns whose defaults keep the old
-- behaviour (the new code asks for the new behaviour explicitly).

-- Install links issued by the new code serve their package once: the browser that opened the link with the
-- page's button gets one transfer, consumed right before the first byte is sent. Links issued before (false)
-- keep their rules: downloads and resumes until they close. The default stays false so that a link issued by
-- the previous version while this migration is ahead of it keeps the rules that version promises.
ALTER TABLE update_install_links
  ADD COLUMN single_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN transfer_started_at timestamptz,
  ADD CONSTRAINT update_install_links_transfer_check
    CHECK (transfer_started_at IS NULL OR (single_transfer AND exchanged_at IS NOT NULL));

-- The approval mail: a mail with a new install link that goes to the request's stored email once its updates
-- are allowed. Saving the approval stores one row in the same transaction; the mail itself is sent after the
-- commit by whoever claims the row. The operator can send it again (a new row, and a new link that replaces
-- the old one). The link's token is only ever in the mail; the row keeps which link it was.
CREATE TABLE approval_mails (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_id bigint NOT NULL REFERENCES access_applications (id) ON DELETE CASCADE,
  -- The request's updates_generation when the row was stored (registrations move it on later).
  generation bigint NOT NULL CHECK (generation >= 0),
  -- approval: stored by the approval change itself; manual: the operator asked for it.
  trigger text NOT NULL CHECK (trigger IN ('approval', 'manual')),
  -- queued: committed, not claimed. sending: claimed by attempt `attempts`. accepted/rejected/uncertain: the
  -- provider's answer (uncertain: it may have been sent; never sent again automatically). failed: stopped before
  -- the provider was asked, nothing sent. cancelled: approval withdrawn or replaced before the provider was asked.
  state text NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'sending', 'accepted', 'rejected', 'uncertain', 'failed', 'cancelled')),
  -- Incremented by every claim; each later write names its attempt, so a stalled attempt can not write over a
  -- newer one.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Short machine code only (for example no_installer or gmail_send_400_invalidArgument); never provider text.
  error_code text CHECK (char_length(error_code) <= 100),
  install_link_id bigint REFERENCES update_install_links (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  -- Committed right before the one provider request: once set, the mail may have gone out.
  send_started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT approval_mails_claim_check CHECK ((state = 'queued') = (claimed_at IS NULL) OR state = 'cancelled'),
  CONSTRAINT approval_mails_send_check CHECK (send_started_at IS NULL OR claimed_at IS NOT NULL),
  CONSTRAINT approval_mails_finish_check CHECK ((state IN ('queued', 'sending')) = (finished_at IS NULL))
);

-- One automatic mail per approval: a repeated save, a retried request or a migration never stores a second.
CREATE UNIQUE INDEX approval_mails_approval_key ON approval_mails (application_id, generation) WHERE trigger = 'approval';
CREATE INDEX approval_mails_application_id_idx ON approval_mails (application_id, id DESC);
CREATE INDEX approval_mails_open_idx ON approval_mails (state) WHERE state IN ('queued', 'sending');

-- The admin card shows each request's latest code mail.
CREATE INDEX update_challenges_application_created_idx
  ON update_challenges (application_id, created_at DESC) WHERE application_id IS NOT NULL;

-- Same as 0001: RLS without policies keeps hosted data APIs out; the owning role bypasses it.
ALTER TABLE approval_mails ENABLE ROW LEVEL SECURITY;
