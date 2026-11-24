import type { AdminApplication, ApprovalMail, CodeMail } from "@/lib/admin/contracts";

// A mail or link action answers with the request as the server read it then. Answers can arrive after a save
// of the same card (or in any order), so only the progress is taken from them, and only where it is not older
// than what the list holds now. The version, status, note and approval stay as they are: drafts survive, and a
// save still meets a change made elsewhere as a conflict.

/** How far a mail got: finished beats asked, asked beats stored. */
const reached = (mail: ApprovalMail) => (mail.finishedAt ? 2 : mail.sendStartedAt ? 1 : 0);

/**
 * How far a link got, in the order the server reads it (applications-store.ts): a link only ever moves up, as
 * nothing reopens a revoked link, undoes a download or moves an expiry back.
 */
const LINK_REACHED: Record<NonNullable<ApprovalMail["linkState"]>, number> = { open: 0, expired: 1, downloaded: 2, closed: 3 };

type MailLink = Pick<ApprovalMail, "linkExpiresAt" | "linkState">;

/** The later of two reads of one mail's link: a newer link (a later attempt made it), or the same one further along. */
function laterLink(held: MailLink, read: MailLink): MailLink {
  const pick = ({ linkExpiresAt, linkState }: MailLink) => ({ linkExpiresAt, linkState });
  if (!held.linkExpiresAt || !read.linkExpiresAt) return pick(read.linkExpiresAt ? read : held);
  if (held.linkExpiresAt !== read.linkExpiresAt) return pick(read.linkExpiresAt > held.linkExpiresAt ? read : held);
  const reach = (link: MailLink) => (link.linkState ? LINK_REACHED[link.linkState] : -1);
  return pick(reach(read) >= reach(held) ? read : held);
}

/**
 * The later of two reads of the latest approval mail: a newer mail, or the same mail further along. For the
 * same mail its sending and its link are taken apart: an answer read before a withdrawal can not reopen the link
 * the withdrawal closed.
 */
function laterMail(held: ApprovalMail | null, read: ApprovalMail | null): ApprovalMail | null {
  if (!held || !read) return read ?? held;
  if (held.id !== read.id) return BigInt(read.id) > BigInt(held.id) ? read : held;
  return { ...(reached(read) >= reached(held) ? read : held), ...laterLink(held, read) };
}

/** The later of two reads of the latest code mail: a later request, or the same one once answered. */
function laterCodeMail(held: CodeMail | null, read: CodeMail | null): CodeMail | null {
  if (!held || !read) return read ?? held;
  if (held.requestedAt !== read.requestedAt) return read.requestedAt > held.requestedAt ? read : held;
  return read.status !== "pending" ? read : held;
}

/**
 * `current` (the list's row now) with the progress of `read` (an action's answer). Whether a Mac is registered
 * comes only from a read of this version or a later one: an approval change moves the version, so an answer
 * read before a withdrawal can not bring the Mac back.
 */
export function mergeProgress(current: AdminApplication, read: AdminApplication): AdminApplication {
  return {
    ...current,
    macRegistered: read.updatedAt >= current.updatedAt ? read.macRegistered : current.macRegistered,
    latestCodeMail: laterCodeMail(current.latestCodeMail, read.latestCodeMail),
    approvalMail: laterMail(current.approvalMail, read.approvalMail),
  };
}

/**
 * One link change at a time on a card: a link made by hand, its revocation and an approval mail each replace the
 * request's link, so an answer of one can never land after (and over) the other's.
 */
export type LinkLock = {
  /** Another change of the card is under way. */
  busy: boolean;
  /** Takes the card's turn; false while another change has it. */
  acquire: () => boolean;
  release: () => void;
};
