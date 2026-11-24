import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApplication, ApprovalMail } from "@/lib/admin/contracts";
import ApplicationInbox from "../ApplicationInbox";
import { APPROVAL_MAIL_STATUS_LABEL, copy } from "../copy";
import { mergeProgress } from "../progress";

// Fixtures for tests only. Answers are held back and released in a chosen order, as a slow network would.
const T0 = "2026-11-25T00:00:00.000Z";
const T1 = "2026-11-25T00:05:00.000Z";
const MANUAL_URL = `http://localhost:3000/install#${"r".repeat(42)}A`;

const mail = (overrides: Partial<ApprovalMail> = {}): ApprovalMail => ({
  id: "11",
  trigger: "approval",
  status: "accepted",
  errorCode: null,
  createdAt: T0,
  sendStartedAt: T0,
  finishedAt: T0,
  linkExpiresAt: "2026-11-28T00:00:00.000Z",
  linkState: "open",
  ...overrides,
});

const kim: AdminApplication = {
  id: "7",
  name: "김테스트",
  email: "kim@example.com",
  createdAt: "2026-11-19T12:30:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: T0,
  updatesApproved: true,
  macRegistered: true,
  latestCodeMail: null,
  approvalMail: mail(),
};

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** An answer held until `release` is called. */
function held() {
  let release!: (value: unknown) => void;
  const answer = new Promise((resolve) => (release = resolve));
  return { answer, release };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openInbox(item: AdminApplication) {
  const user = userEvent.setup();
  fetchMock.mockResolvedValueOnce(reply(200, { ok: true, items: [item], nextCursor: null }));
  render(<ApplicationInbox />);
  await user.click(await screen.findByRole("button", { name: `${copy.open} ${item.name}` }));
  return user;
}

const bodyOf = (call: number) => JSON.parse(fetchMock.mock.calls[call][1].body as string);

describe("answers that arrive late", () => {
  it("keeps a withdrawal saved meanwhile, its version and a note edited after it, when a resend answers last", async () => {
    const user = await openInbox(kim);
    const resend = held();
    const save = held();

    // Resend (confirmed: its link may still work), then withdraw and save while it is under way.
    fetchMock.mockReturnValueOnce(resend.answer);
    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    await user.click(screen.getByRole("button", { name: copy.approvalMailConfirm }));
    fetchMock.mockReturnValueOnce(save.answer);
    await user.click(screen.getByRole("checkbox", { name: copy.updatesLabel }));
    await user.click(screen.getByRole("button", { name: copy.save }));

    // The withdrawal answers first.
    const withdrawn = { ...kim, updatedAt: T1, updatesApproved: false, macRegistered: false };
    save.release(reply(200, { ok: true, item: withdrawn }));
    expect(await screen.findByRole("checkbox", { name: copy.updatesLabel })).not.toBeChecked();
    await user.type(screen.getByLabelText(copy.noteLabel), "철회 후 메모");

    // Then the resend, read before the withdrawal: a new mail, but the old version, approval and Mac.
    const readBefore = { ...kim, approvalMail: mail({ id: "12", trigger: "manual", createdAt: T1 }) };
    resend.release(reply(200, { ok: true, item: readBefore }));
    expect(await screen.findByText(copy.approvalMailDone(APPROVAL_MAIL_STATUS_LABEL.accepted))).toBeInTheDocument();

    expect(screen.getByRole("checkbox", { name: copy.updatesLabel })).not.toBeChecked();
    for (const badge of Object.values(copy.mailBadge)) expect(screen.queryByText(badge)).not.toBeInTheDocument();
    expect(screen.getByText(copy.macNotRegistered)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.noteLabel)).toHaveValue("철회 후 메모");
    // The newer mail is shown.
    expect(screen.getByText(new RegExp(copy.approvalMailManual))).toBeInTheDocument();

    // The next save goes against the withdrawal's version.
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: { ...withdrawn, operatorNote: "철회 후 메모" } }));
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(bodyOf(3)).toEqual({ operatorNote: "철회 후 메모", expectedUpdatedAt: T1 });
  });

  it("keeps the mailed link closed when a resend's answer, read before the withdrawal closed it, comes last", async () => {
    const user = await openInbox({ ...kim, approvalMail: mail({ linkState: "expired" }) });
    const resend = held();
    const save = held();
    fetchMock.mockReturnValueOnce(resend.answer);
    await user.click(screen.getByRole("button", { name: copy.approvalMailNewLink }));
    fetchMock.mockReturnValueOnce(save.answer);
    await user.click(screen.getByRole("checkbox", { name: copy.updatesLabel }));
    await user.click(screen.getByRole("button", { name: copy.save }));

    // The server sent mail 12, then the withdrawal closed its link: both answers name mail 12.
    const sent = mail({ id: "12", trigger: "manual", createdAt: T1, linkExpiresAt: "2026-11-28T00:05:00.000Z" });
    save.release(
      reply(200, { ok: true, item: { ...kim, updatedAt: T1, updatesApproved: false, macRegistered: false, approvalMail: { ...sent, linkState: "closed" } } }),
    );
    expect(await screen.findByText(copy.linkStateClosed)).toBeInTheDocument();
    resend.release(reply(200, { ok: true, item: { ...kim, approvalMail: { ...sent, linkState: "open" } } }));
    expect(await screen.findByText(copy.approvalMailDone(APPROVAL_MAIL_STATUS_LABEL.accepted))).toBeInTheDocument();

    expect(screen.getByText(copy.linkStateClosed)).toBeInTheDocument();
    expect(screen.queryByText(copy.linkStateOpen("2026. 11. 28. 09:05"))).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: copy.updatesLabel })).not.toBeChecked();
  });

  it("starts no approval mail while a link made by hand is under way, so its late answer can't bring back a closed link", async () => {
    const user = await openInbox(kim);
    const issue = held();
    fetchMock.mockReturnValueOnce(issue.answer);
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));

    // The mail waits for the link: no request, and the button says it is busy.
    const resend = screen.getByRole("button", { name: copy.approvalMailResend });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    await user.click(resend);
    expect(screen.queryByText(copy.approvalMailResendWarning)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    issue.release(
      reply(201, { ok: true, link: { url: MANUAL_URL, expiresAt: "2026-11-28T01:00:00.000Z", build: 24, version: "2.7.0" }, item: kim }),
    );
    expect(await screen.findByLabelText(copy.installLinkLabel)).toHaveValue(MANUAL_URL);

    // Now the mail goes, and its newer link replaces the one made by hand.
    fetchMock.mockResolvedValueOnce(
      reply(200, { ok: true, item: { ...kim, approvalMail: mail({ id: "12", trigger: "manual", linkExpiresAt: "2026-11-28T02:00:00.000Z" }) } }),
    );
    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    await user.click(screen.getByRole("button", { name: copy.approvalMailConfirm }));
    expect(await screen.findByText(copy.installLinkReplacedByMail)).toBeInTheDocument();
    expect(screen.queryByLabelText(copy.installLinkLabel)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(MANUAL_URL);
  });

  it("makes no link by hand while an approval mail is being sent", async () => {
    const user = await openInbox({ ...kim, approvalMail: mail({ linkState: "expired" }) });
    const resend = held();
    fetchMock.mockReturnValueOnce(resend.answer);
    await user.click(screen.getByRole("button", { name: copy.approvalMailNewLink }));

    const issue = screen.getByRole("button", { name: copy.installLinkIssue });
    expect(issue).toHaveAttribute("aria-disabled", "true");
    await user.click(issue);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    resend.release(reply(200, { ok: true, item: { ...kim, approvalMail: mail({ id: "12", trigger: "manual" }) } }));
    expect(await screen.findByText(copy.approvalMailDone(APPROVAL_MAIL_STATUS_LABEL.accepted))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.installLinkIssue })).not.toHaveAttribute("aria-disabled", "true");
  });
});

describe("mergeProgress", () => {
  it("keeps the row's version, status, note and approval, and takes only newer progress", () => {
    const current = { ...kim, updatedAt: T1, status: "hold" as const, operatorNote: "B", updatesApproved: false, macRegistered: false };
    const read = { ...kim, updatedAt: T0, status: "new" as const, operatorNote: "A", updatesApproved: true, macRegistered: true };
    const merged = mergeProgress(current, read);
    expect(merged).toMatchObject({ updatedAt: T1, status: "hold", operatorNote: "B", updatesApproved: false });
    // Read before this version: the Mac it saw may be gone.
    expect(merged.macRegistered).toBe(false);
    expect(mergeProgress(current, { ...read, updatedAt: T1 }).macRegistered).toBe(true);
  });

  it("keeps the newer approval mail, or the same mail further along", () => {
    const merged = (held: ApprovalMail | null, read: ApprovalMail | null) =>
      mergeProgress({ ...kim, approvalMail: held }, { ...kim, approvalMail: read }).approvalMail;
    const sent = mail({ id: "12" });
    expect(merged(sent, mail({ id: "11" }))).toEqual(sent);
    // Across a digit boundary too.
    const tenth = mail({ id: "10" });
    expect(merged(tenth, mail({ id: "9" }))).toEqual(tenth);
    const queued = mail({ id: "12", status: "queued", sendStartedAt: null, finishedAt: null, linkExpiresAt: null, linkState: null });
    expect(merged(sent, queued)).toEqual(sent);
    expect(merged(queued, sent)).toEqual(sent);
    expect(merged(null, sent)).toEqual(sent);
  });

  it("never reopens a link of the same mail that a later read saw closed, downloaded or expired", () => {
    const merged = (held: ApprovalMail, read: ApprovalMail) =>
      mergeProgress({ ...kim, approvalMail: held }, { ...kim, approvalMail: read }).approvalMail!;
    const open = mail({ id: "12", linkState: "open" });
    for (const linkState of ["closed", "downloaded", "expired"] as const) {
      const moved = mail({ id: "12", linkState });
      expect(merged(moved, open).linkState).toBe(linkState);
      expect(merged(open, moved).linkState).toBe(linkState);
    }
    expect(merged(mail({ id: "12", linkState: "closed" }), mail({ id: "12", linkState: "downloaded" })).linkState).toBe("closed");
    // The sending still comes from the read further along, the link from where it got furthest.
    const asked = mail({ id: "12", status: "sending", finishedAt: null, linkState: "closed" });
    expect(merged(asked, open)).toMatchObject({ status: "accepted", finishedAt: T0, linkState: "closed" });
  });

  it("takes the newer link of the same mail, made by a later attempt, as it is", () => {
    const merged = (held: ApprovalMail, read: ApprovalMail) =>
      mergeProgress({ ...kim, approvalMail: held }, { ...kim, approvalMail: read }).approvalMail!;
    const first = mail({ id: "12", linkExpiresAt: "2026-11-28T00:00:00.000Z", linkState: "closed" });
    const second = mail({ id: "12", linkExpiresAt: "2026-11-28T00:03:00.000Z", linkState: "open" });
    expect(merged(first, second)).toMatchObject({ linkExpiresAt: second.linkExpiresAt, linkState: "open" });
    expect(merged(second, first)).toMatchObject({ linkExpiresAt: second.linkExpiresAt, linkState: "open" });
    // A read without the link (before the attempt made it) keeps the one known.
    const before = mail({ id: "12", status: "sending", sendStartedAt: null, finishedAt: null, linkExpiresAt: null, linkState: null });
    expect(merged(second, before)).toMatchObject({ linkExpiresAt: second.linkExpiresAt, linkState: "open" });
  });

  it("keeps the later code mail, or the same one once answered", () => {
    const later = { requestedAt: T1, status: "pending" as const };
    const earlier = { requestedAt: T0, status: "accepted" as const };
    expect(mergeProgress({ ...kim, latestCodeMail: later }, { ...kim, latestCodeMail: earlier }).latestCodeMail).toBe(later);
    const answered = { requestedAt: T1, status: "accepted" as const };
    expect(mergeProgress({ ...kim, latestCodeMail: later }, { ...kim, latestCodeMail: answered }).latestCodeMail).toBe(answered);
    expect(mergeProgress({ ...kim, latestCodeMail: answered }, { ...kim, latestCodeMail: later }).latestCodeMail).toBe(answered);
  });
});
