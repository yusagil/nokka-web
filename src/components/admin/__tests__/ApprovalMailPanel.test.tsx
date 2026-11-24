import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminApplication, ApprovalMail } from "@/lib/admin/contracts";
import ApplicationCard from "../ApplicationCard";
import ApprovalMailPanel from "../ApprovalMailPanel";
import { APPROVAL_MAIL_STATUS_LABEL, copy } from "../copy";

// Fixtures for tests only.
const item: AdminApplication = {
  id: "7",
  name: "김테스트",
  email: "kim@example.com",
  createdAt: "2026-11-19T12:30:00.000Z",
  status: "new",
  operatorNote: "",
  lastContactedAt: null,
  updatedAt: "2026-11-19T12:30:00.000Z",
  updatesApproved: true,
  macRegistered: false,
  latestCodeMail: null,
  approvalMail: null,
};

const mail = (overrides: Partial<ApprovalMail> = {}): ApprovalMail => ({
  id: "11",
  trigger: "approval",
  status: "accepted",
  errorCode: null,
  createdAt: "2026-11-25T00:00:00.000Z",
  sendStartedAt: "2026-11-25T00:00:01.000Z",
  finishedAt: "2026-11-25T00:00:02.000Z",
  linkExpiresAt: "2026-11-28T00:00:00.000Z",
  linkState: "open",
  ...overrides,
});

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
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

function renderPanel(current: AdminApplication) {
  const props = { item: current, onItem: vi.fn(), onReload: vi.fn(async () => {}) };
  render(<ApprovalMailPanel {...props} />);
  return props;
}

const sentBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

describe("ApprovalMailPanel", () => {
  it("shows the mail's result, the registered Mac and the latest code mail separately", () => {
    renderPanel({
      ...item,
      macRegistered: true,
      latestCodeMail: { requestedAt: "2026-11-25T01:00:00.000Z", status: "uncertain" },
      approvalMail: mail({ status: "rejected", errorCode: "gmail_send_400_invalidArgument" }),
    });
    expect(screen.getByText(APPROVAL_MAIL_STATUS_LABEL.rejected)).toBeInTheDocument();
    expect(screen.getByText(/메일 서비스 코드 gmail_send_400_invalidArgument/)).toBeInTheDocument();
    expect(screen.getByText(copy.macRegistered)).toBeInTheDocument();
    expect(screen.getByText(/최근 코드 메일: .* 요청 · 발송 여부 확인 불가/)).toBeInTheDocument();
  });

  it("sends a waiting mail with one press, as the card showed it", async () => {
    const user = userEvent.setup();
    const sent = { ...item, approvalMail: mail({ status: "accepted" }) };
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: sent }));
    const props = renderPanel({ ...item, approvalMail: mail({ status: "interrupted", errorCode: null, sendStartedAt: null }) });

    await user.click(screen.getByRole("button", { name: copy.approvalMailSend }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/applications/7/approval-mail");
    expect(sentBody()).toEqual({ expectedMailId: "11", intent: "send" });
    expect(props.onItem).toHaveBeenCalledWith(sent);
    expect(screen.getByRole("status")).toHaveTextContent(copy.approvalMailDone(APPROVAL_MAIL_STATUS_LABEL.accepted));
  });

  it("asks before sending again a mail that may have arrived, and sends nothing on cancel", async () => {
    const user = userEvent.setup();
    renderPanel({ ...item, approvalMail: mail({ status: "uncertain", errorCode: "gmail_send_timeout" }) });

    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.approvalMailResendWarning);
    await user.click(screen.getByRole("button", { name: copy.approvalMailCancel }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: { ...item, approvalMail: mail({ id: "12", trigger: "manual" }) } }));
    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    await user.click(screen.getByRole("button", { name: copy.approvalMailConfirm }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual({ expectedMailId: "11", intent: "resend" });
  });

  it("names an operator's revocation as the reason a mail was cancelled, and offers a new one", () => {
    renderPanel({ ...item, approvalMail: mail({ status: "cancelled", errorCode: "revoked_by_operator", sendStartedAt: null, linkState: "closed" }) });
    expect(screen.getByText(/설치 링크를 회수했습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.approvalMailNewLink })).toBeInTheDocument();
  });

  it("names a withdrawn installer as the reason nothing was sent", () => {
    renderPanel({ ...item, approvalMail: mail({ status: "failed", errorCode: "installer_withdrawn", sendStartedAt: null }) });
    expect(screen.getByText(/설치 파일이 철회되었습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy.approvalMailNewLink })).toBeInTheDocument();
  });

  it("sends again without asking when nothing was delivered", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: { ...item, approvalMail: mail({ id: "12", trigger: "manual" }) } }));
    renderPanel({ ...item, approvalMail: mail({ status: "failed", errorCode: "no_installer", sendStartedAt: null, linkExpiresAt: null, linkState: null }) });
    expect(screen.getByText(/전달할 설치 파일이 지정되지 않았습니다/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.approvalMailNewLink }));
    expect(sentBody()).toEqual({ expectedMailId: "11", intent: "resend" });
  });

  it("offers a request allowed before approval mails its first mail with a new link", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: { ...item, approvalMail: mail({ trigger: "manual" }) } }));
    renderPanel(item);
    expect(screen.getByText(copy.approvalMailNone)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.approvalMailFirst }));
    expect(sentBody()).toEqual({ expectedMailId: null, intent: "send" });
  });

  it.each([
    ["expired", copy.linkStateExpired("2026. 11. 28. 09:00")],
    ["downloaded", copy.linkStateDownloaded],
    ["closed", copy.linkStateClosed],
  ] as const)("sends a new link at once when the mailed link is %s", async (linkState, line) => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: { ...item, approvalMail: mail({ id: "12", trigger: "manual" }) } }));
    renderPanel({ ...item, approvalMail: mail({ linkState }) });
    expect(screen.getByText(line)).toBeInTheDocument();
    expect(screen.getByText(copy.approvalMailNewLinkHint)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.approvalMailNewLink }));
    expect(screen.queryByText(copy.approvalMailResendWarning)).not.toBeInTheDocument();
    expect(sentBody()).toEqual({ expectedMailId: "11", intent: "resend" });
  });

  it("asks first when the mailed link is still open and not downloaded", async () => {
    const user = userEvent.setup();
    renderPanel({ ...item, approvalMail: mail({ linkState: "open" }) });
    expect(screen.getByText(copy.linkStateOpen("2026. 11. 28. 09:00"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(copy.approvalMailResendWarning);
  });

  it("offers no button while a mail is being sent, or once updates are off", () => {
    renderPanel({ ...item, approvalMail: mail({ status: "sending", finishedAt: null }) });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains an out-of-date card and offers the latest state instead of sending", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(reply(409, { ok: false, code: "CONFLICT" }));
    const props = renderPanel({ ...item, approvalMail: mail({ status: "queued", sendStartedAt: null, finishedAt: null }) });
    await user.click(screen.getByRole("button", { name: copy.approvalMailSend }));
    expect(screen.getByRole("alert")).toHaveTextContent(copy.approvalMailConflict);
    expect(props.onItem).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: copy.reload }));
    expect(props.onReload).toHaveBeenCalledTimes(1);
  });

  it("sends one request for two quick presses", async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    renderPanel({ ...item, approvalMail: mail({ status: "queued", sendStartedAt: null, finishedAt: null }) });
    const button = screen.getByRole("button", { name: copy.approvalMailSend });
    await user.click(button);
    await user.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    answer(reply(200, { ok: true, item: { ...item, approvalMail: mail() } }));
  });
});

describe("ApplicationCard with an approval", () => {
  it("says how the approval mail went once the approval is saved, and warns about everything a withdrawal ends", async () => {
    const user = userEvent.setup();
    const off = { ...item, updatesApproved: false };
    const saved = { ...item, updatedAt: "2026-11-25T00:00:03.000Z", approvalMail: mail() };
    fetchMock.mockResolvedValueOnce(reply(200, { ok: true, item: saved }));
    const onSaved = vi.fn();
    render(
      <ul>
        <ApplicationCard item={off} expanded onToggle={() => {}} onSaved={onSaved} onReload={async () => {}} />
      </ul>,
    );
    expect(screen.getByText(copy.updatesHint)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: copy.updatesLabel }));
    await user.click(screen.getByRole("button", { name: copy.save }));
    expect(onSaved).toHaveBeenCalledWith(saved, false);
    expect(screen.getAllByRole("status").some((node) => node.textContent === copy.savedWithMail(APPROVAL_MAIL_STATUS_LABEL.accepted))).toBe(true);
    expect(copy.updatesRevokeWarning).toMatch(/설치 링크/);
    expect(copy.updatesRevokeWarning).toMatch(/승인 메일/);
  });
});

/** Holds the record like the inbox does, so whatever the card hands back is what it shows next. */
function Inbox({ start, onSaved = () => {} }: { start: AdminApplication; onSaved?: (item: AdminApplication, stillEditing: boolean) => void }) {
  const [current, setCurrent] = useState(start);
  return (
    <ul>
      <ApplicationCard
        item={current}
        expanded
        onToggle={() => {}}
        onSaved={(saved, stillEditing) => {
          setCurrent(saved);
          onSaved(saved, stillEditing);
        }}
        onReload={async () => {}}
      />
    </ul>
  );
}

const MANUAL_URL = `http://localhost:3000/install#${"h".repeat(42)}A`;

describe("ApplicationCard progress and links", () => {
  it.each([
    [null, copy.mailBadge.none],
    [mail({ linkState: "expired" }), copy.mailBadge.expired],
    [mail({ linkState: "downloaded" }), copy.mailBadge.downloaded],
    [mail({ linkState: "open" }), copy.mailBadge.accepted],
    [mail({ status: "failed", errorCode: "no_installer", linkState: null }), copy.mailBadge.notSent],
    [mail({ status: "uncertain", errorCode: "gmail_send_timeout" }), copy.mailBadge.uncertain],
  ])("shows an allowed request's mail state on the closed card (%#)", (approvalMail, badge) => {
    render(
      <ul>
        <ApplicationCard item={{ ...item, approvalMail }} expanded={false} onToggle={() => {}} onSaved={() => {}} onReload={async () => {}} />
      </ul>,
    );
    expect(screen.getByText(badge)).toBeVisible();
  });

  it("shows no mail badge for a request whose updates are not allowed", () => {
    render(
      <ul>
        <ApplicationCard item={{ ...item, updatesApproved: false }} expanded={false} onToggle={() => {}} onSaved={() => {}} onReload={async () => {}} />
      </ul>,
    );
    for (const badge of Object.values(copy.mailBadge)) expect(screen.queryByText(badge)).not.toBeInTheDocument();
  });

  it("shows no registered Mac and no code mail for a new request, without a send button", () => {
    render(<Inbox start={{ ...item, updatesApproved: false }} />);
    expect(screen.getByText(copy.macNotRegistered)).toBeInTheDocument();
    expect(screen.getByText(copy.codeMailNone)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.approvalMailSend })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.approvalMailResend })).not.toBeInTheDocument();
  });

  it("stops offering a link made by hand once an approval mail sent after it replaced it", async () => {
    const user = userEvent.setup();
    const start = { ...item, approvalMail: mail({ linkExpiresAt: "2026-11-28T00:00:00.000Z" }) };
    render(<Inbox start={start} />);
    fetchMock.mockResolvedValueOnce(
      reply(201, {
        ok: true,
        link: { url: MANUAL_URL, expiresAt: "2026-11-28T01:00:00.000Z", build: 24, version: "2.7.0" },
        item: start,
      }),
    );
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    expect(screen.getByLabelText(copy.installLinkLabel)).toHaveValue(MANUAL_URL);

    fetchMock.mockResolvedValueOnce(
      reply(200, { ok: true, item: { ...start, approvalMail: mail({ id: "12", trigger: "manual", linkExpiresAt: "2026-11-28T02:00:00.000Z" }) } }),
    );
    await user.click(screen.getByRole("button", { name: copy.approvalMailResend }));
    await user.click(screen.getByRole("button", { name: copy.approvalMailConfirm }));

    expect(screen.queryByLabelText(copy.installLinkLabel)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.installLinkCopy })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: copy.installLinkCopyBody })).not.toBeInTheDocument();
    expect(screen.getByText(copy.installLinkReplacedByMail)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(MANUAL_URL);
  });

  it("keeps a link made by hand after a mail that never made one, and shows the mail it cancelled", async () => {
    const user = userEvent.setup();
    const start = { ...item, approvalMail: mail({ status: "queued", sendStartedAt: null, finishedAt: null, linkExpiresAt: null }) };
    render(<Inbox start={start} />);
    fetchMock.mockResolvedValueOnce(
      reply(201, {
        ok: true,
        link: { url: MANUAL_URL, expiresAt: "2026-11-28T01:00:00.000Z", build: 24, version: "2.7.0" },
        item: { ...start, approvalMail: mail({ status: "cancelled", errorCode: "replaced_by_operator_link", sendStartedAt: null, linkExpiresAt: null }) },
      }),
    );
    await user.click(screen.getByRole("button", { name: copy.installLinkIssue }));
    expect(screen.getByText(APPROVAL_MAIL_STATUS_LABEL.cancelled)).toBeInTheDocument();
    expect(screen.getByText(/직접 만든 설치 링크로 대체했습니다/)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.installLinkLabel)).toHaveValue(MANUAL_URL);
  });

  it("keeps an unsaved note through a mail sent meanwhile, and saves it against the version it was started on", async () => {
    const user = userEvent.setup();
    const start = { ...item, approvalMail: mail({ status: "failed", errorCode: "no_installer", sendStartedAt: null }) };
    render(<Inbox start={start} />);
    await user.type(screen.getByLabelText(copy.noteLabel), "A의 메모");

    // Another tab saved a note meanwhile: the answer carries that newer version.
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        ok: true,
        item: {
          ...start,
          updatedAt: "2026-11-25T09:00:00.000Z",
          operatorNote: "B의 메모",
          status: "hold",
          approvalMail: mail({ id: "12", trigger: "manual" }),
        },
      }),
    );
    await user.click(screen.getByRole("button", { name: copy.approvalMailNewLink }));
    expect(screen.getByText(APPROVAL_MAIL_STATUS_LABEL.accepted)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.noteLabel)).toHaveValue("A의 메모");

    fetchMock.mockResolvedValueOnce(reply(409, { ok: false, code: "CONFLICT" }));
    await user.click(screen.getByRole("button", { name: copy.save }));
    const patch = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(patch).toEqual({ operatorNote: "A의 메모", expectedUpdatedAt: start.updatedAt });
    expect(screen.getByText(copy.conflict)).toBeInTheDocument();
  });
});
