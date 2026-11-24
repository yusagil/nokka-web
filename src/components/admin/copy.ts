import type { ApplicationStatus, ApprovalMailStatus, CodeMail } from "@/lib/admin/contracts";

// The inbox is for the one operator and is Korean only, so its copy lives here rather than in the
// public en/ko dictionaries.

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  new: "신규",
  hold: "보류",
  contacted: "안내완료",
};

export const APPROVAL_MAIL_STATUS_LABEL: Record<ApprovalMailStatus, string> = {
  queued: "발송 대기",
  sending: "보내는 중",
  accepted: "메일 서비스가 접수함",
  rejected: "메일 서비스가 거절함(보내지 않음)",
  uncertain: "발송 여부 확인 불가",
  failed: "보내지 못함",
  interrupted: "보내기 전에 중단됨",
  cancelled: "취소됨",
};

export const CODE_MAIL_STATUS_LABEL: Record<CodeMail["status"], string> = {
  pending: "처리 결과 기록 전",
  accepted: "메일 서비스가 접수함",
  rejected: "메일 서비스가 거절함",
  uncertain: "발송 여부 확인 불가",
};

/** Why an approval mail was not sent (or not known to be), by its error code. Provider codes are shown as is. */
const APPROVAL_MAIL_REASON: Record<string, string> = {
  no_installer: "전달할 설치 파일이 지정되지 않았습니다",
  installer_withdrawn: "링크를 만든 뒤 설치 파일이 철회되었습니다. 설치 파일을 다시 지정한 뒤 보내세요",
  mail_not_configured: "메일 발송 설정이 없습니다",
  approval_withdrawn: "업데이트 허용을 껐습니다",
  revoked_by_operator: "설치 링크를 회수했습니다",
  link_revoked: "설치 링크를 회수했습니다",
  replaced_by_operator_link: "직접 만든 설치 링크로 대체했습니다",
  superseded: "새 승인 메일로 대체했습니다",
  result_not_recorded: "메일 서비스의 응답이 기록되지 않았습니다",
  internal_error: "서버 오류로 멈췄습니다",
};

export const approvalMailReason = (code: string) => APPROVAL_MAIL_REASON[code] ?? `메일 서비스 코드 ${code}`;

export const copy = {
  title: "신청함",
  intro: "Nokka 사용 신청 목록입니다. 상태와 메모는 저장을 눌러야 기록됩니다.",
  pageLoading: "신청함을 불러오는 중…",
  pageFailed: "신청함을 표시하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  unsaved: "저장하지 않은 수정이 있습니다. 검색하거나 상태 필터를 바꾸면 사라집니다.",
  signOut: "로그아웃",
  signingOut: "로그아웃 중…",
  signOutFailed: "로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  searchLabel: "이름·이메일 검색",
  search: "검색",
  filterLegend: "상태",
  filterAll: "전체",
  listHeading: "신청 목록",
  loading: "불러오는 중…",
  loadingMore: "더 불러오는 중…",
  loadMore: "더 보기",
  count: (n: number, more: boolean) => (more ? `${n}건 표시 중, 더 있음` : `${n}건`),
  empty: "아직 신청이 없습니다.",
  emptyFiltered: "조건에 맞는 신청이 없습니다.",
  retry: "다시 시도",
  loadFailed: "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
  unauthenticated: "로그인이 필요합니다. 페이지를 새로고침해 다시 로그인해 주세요.",
  forbidden: "이 계정으로는 신청함을 볼 수 없습니다.",
  appliedAt: "신청",
  lastContactedAt: "마지막 안내",
  open: "처리하기",
  close: "접기",
  statusLegend: "처리 상태",
  noteLabel: "메모",
  noteHint: "운영 기록용이며 신청자에게 보이지 않습니다.",
  noteCount: (n: number, max: number) => `${n}/${max}`,
  noteTooLong: (max: number) => `메모는 ${max}자 이내로 입력해 주세요.`,
  noteInvalid: "메모를 확인해 주세요.",
  save: "저장",
  saving: "저장 중…",
  saved: "저장했습니다.",
  savedWithPending: "저장했습니다. 저장하는 동안 바꾼 내용은 아직 저장되지 않았습니다.",
  movedOut: (status: string) => `저장했습니다. ${status} 상태가 되어 지금 목록에서 뺐습니다.`,
  updatesLegend: "앱 업데이트",
  updatesLabel: "업데이트 허용",
  updatesHint:
    "켜고 저장하면 설치 링크가 든 승인 메일이 이 이메일로 한 번 자동 발송됩니다. 이 이메일로 앱에서 등록 코드를 받아 Mac 한 대를 등록할 수 있고, 코드 메일은 신청자가 앱에서 요청할 때 따로 갑니다.",
  updatesRevokeWarning:
    "끄고 저장하면 등록된 Mac의 업데이트, 아직 쓰지 않은 코드, 열린 설치 링크와 아직 보내지 않은 승인 메일이 바로 중단됩니다. 다시 켜면 새 링크가 든 승인 메일이 다시 가고, Mac은 새 코드로 다시 등록해야 합니다.",
  savedWithMail: (status: string) => `저장했습니다. 승인 메일: ${status}`,
  progressLegend: "진행 상황",
  progressHint: "‘안내완료’는 직접 기록하는 처리 상태이고, 아래 승인 메일 결과와는 별개입니다. 최신 결과는 목록을 다시 불러오면 보입니다.",
  macRegistered: "등록된 Mac: 있음",
  macNotRegistered: "등록된 Mac: 없음",
  codeMailNone: "최근 코드 메일: 기록 없음",
  codeMail: (when: string, status: string) => `최근 코드 메일: ${when} 요청 · ${status}`,
  approvalMailLegend: "승인 메일",
  approvalMailNone:
    "보낸 승인 메일이 없습니다(승인 메일 자동 발송 전에 허용한 신청). 보내면 다운로드 1회짜리 새 설치 링크가 든 안내 메일이 이 신청자에게 가고, 전에 전달한 링크는 막힙니다.",
  approvalMailFirst: "새 설치 링크 메일 보내기",
  approvalMailNewLink: "새 링크로 다시 보내기",
  approvalMailNewLinkHint:
    "링크가 만료됐거나, 받는 중에 끊겼거나, 신청자가 링크를 잃어버렸다면 다시 보내세요. 새 메일의 링크도 다운로드 1회만 되고, 전 링크는 막힙니다.",
  linkStateOpen: (until: string) => `메일의 설치 링크: 아직 받지 않음 · ${until}까지`,
  linkStateDownloaded: "메일의 설치 링크: 이미 받기 시작함(다운로드 1회 사용)",
  linkStateExpired: (until: string) => `메일의 설치 링크: ${until}에 만료됨`,
  linkStateClosed: "메일의 설치 링크: 막힘(회수 또는 새 링크로 교체)",
  approvalMailAuto: "자동 발송",
  approvalMailManual: "직접 요청",
  approvalMailEmpty: "없음",
  approvalMailReasonLine: (reason: string) => `사유: ${reason}`,
  approvalMailSend: "승인 메일 지금 보내기",
  approvalMailResend: "승인 메일 다시 보내기",
  approvalMailBusy: "보내는 중…",
  approvalMailResendWarning:
    "이미 신청자에게 갔을 수 있는 메일입니다. 다시 보내면 메일을 두 통 받을 수 있고, 새 링크가 만들어지는 즉시 이전 메일의 링크는 쓸 수 없습니다.",
  approvalMailConfirm: "확인하고 다시 보내기",
  approvalMailCancel: "취소",
  approvalMailDone: (status: string) => `승인 메일: ${status}`,
  approvalMailConflict: "그 사이 승인 메일 상태가 바뀌었습니다. 최신 내용을 불러온 뒤 다시 판단해 주세요.",
  approvalMailInProgress: "승인 메일을 보내는 중입니다. 잠시 뒤 최신 내용을 불러와 주세요.",
  approvalMailNotApproved: "업데이트 허용을 저장한 뒤에 보낼 수 있습니다. 목록을 다시 불러와 주세요.",
  approvalMailFailed: "요청하지 못했습니다. 잠시 후 최신 내용을 불러와 확인해 주세요.",
  updatesApprovedBadge: "업데이트 허용",
  /** Short state of an allowed request's approval mail, beside the badges of a closed card. */
  mailBadge: {
    none: "승인 메일 없음",
    sending: "승인 메일 보내는 중",
    accepted: "승인 메일 접수",
    notSent: "승인 메일 안 감",
    uncertain: "승인 메일 확인 불가",
    expired: "설치 링크 만료",
    downloaded: "설치 링크로 받음",
    closed: "설치 링크 막힘",
  },
  noChanges: "바뀐 내용이 없습니다.",
  saveFailed: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  conflict:
    "다른 곳에서 이 신청이 먼저 바뀌었습니다. 최신 내용을 불러오면 저장하지 않은 수정은 사라집니다.",
  notFound: "이 신청을 찾을 수 없습니다. 목록을 다시 불러와 주세요.",
  reload: "최신 내용 불러오기",
  composeGmail: "Gmail로 메일 작성",
  compose: "메일 앱으로 메일 작성",
  composeHint:
    "Gmail은 이 브라우저의 새 탭에, 메일 앱은 이 브라우저나 Mac에 연결된 앱에 초안을 엽니다. 어느 쪽도 자동으로 보내지 않습니다. 직접 보낸 뒤 상태를 안내완료로 바꿔 저장하세요.",
  installLinkLegend: "비공개 설치 링크",
  installLinkHint: (hours: number) =>
    `승인 메일과 별도로 이 신청자에게 직접 전달할 때 쓰는 설치 파일 링크입니다. 만든 때부터 ${hours}시간 동안 쓸 수 있습니다. 링크를 열기만 해서는 쓰이지 않고, 페이지의 ‘설치 파일 받기’를 처음 누른 한 번만 받을 수 있습니다. 받는 중에 끊겼다는 연락을 받으면 새 링크를 만들어 전달하거나 승인 메일을 다시 보내세요. 새로 만들면 승인 메일에 든 링크를 포함한 이전 링크가 바로 막히고, 아직 보내지 않은 승인 메일은 취소됩니다. 링크 주소는 만든 직후 이 화면에서만 볼 수 있습니다.`,
  installLinkRevokeHint:
    "회수하거나 새로 만들면 그 링크의 새 요청은 바로 거절되고, 아직 보내지 않은 승인 메일도 취소됩니다. 이미 시작된 다운로드는 중간에 끊지 않으므로 끝까지 받을 수 있습니다.",
  installLinkIssue: "설치 링크 만들기",
  installLinkReissue: "새 링크 만들기",
  installLinkIssuing: "만드는 중…",
  installLinkRevoke: "링크 회수",
  installLinkRevoking: "회수 중…",
  installLinkLabel: "설치 링크",
  installLinkSummary: (version: string, build: number, until: string) =>
    `Nokka ${version} (${build}) 설치 파일 · ${until}까지 사용 가능. 이 화면을 벗어나면 주소를 다시 볼 수 없습니다.`,
  installLinkCopy: "링크 복사",
  installLinkCopied: "링크를 복사했습니다.",
  installLinkCopyFailed: "복사하지 못했습니다. 링크를 직접 선택해 복사하세요.",
  installLinkCopyBody: "메일 본문 복사",
  installLinkBodyCopied: "링크가 든 메일 본문을 복사했습니다. 작성 창의 본문에 붙여 넣으세요.",
  installLinkBodyCopyFailed: "본문을 복사하지 못했습니다. 아래 메일 본문을 직접 선택해 복사하세요.",
  installLinkBodyLabel: "메일 본문",
  installLinkReissued: "새 링크를 만들었습니다. 이전 링크와 그 링크로 복사한 본문은 쓸 수 없으니 다시 복사하세요.",
  installLinkComposeGmail: "Gmail로 링크 메일 작성",
  installLinkCompose: "메일 앱으로 링크 메일 작성",
  installLinkComposeHint:
    "먼저 메일 본문을 복사하세요. Gmail은 이 브라우저의 새 탭에, 메일 앱은 이 브라우저나 Mac에 연결된 앱에 받는 사람과 제목만 채운 초안을 엽니다. 링크는 작성 창 주소에 넣지 않으니 본문에 붙여 넣고, 직접 확인한 뒤 보내세요.",
  installLinkReplacedByMail: "승인 메일로 새 링크가 나가 여기서 만든 링크는 막혔습니다. 이 링크와 그 본문은 더 이상 전달하지 마세요.",
  installLinkRevoked: "링크를 회수했습니다. 새 요청은 거절되며, 이미 시작된 다운로드는 끝까지 받을 수 있습니다.",
  installLinkNoneOpen: "열려 있는 링크가 없습니다.",
  installLinkNotApproved: "업데이트 허용을 저장한 뒤에 만들 수 있습니다. 목록을 다시 불러와 주세요.",
  installLinkNoInstaller: "아직 전달할 설치 파일이 지정되지 않았습니다. 릴리스 도구에서 설치 파일을 지정해야 합니다.",
  installLinkIssueFailed: "링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  installLinkRevokeFailed: "링크를 회수하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  installLinkMailSubject: "Nokka 설치 링크 안내",
  installLinkMailBody: (name: string, url: string, until: string) =>
    `${name}님, 안녕하세요.\n\nNokka 업데이트가 승인되어 설치 파일 링크를 보내 드립니다.\n\n${url}\n\n` +
    `설치할 Mac에서 링크를 열고 ‘설치 파일 받기’를 누르면 바로 받기 시작합니다. 이 버튼은 한 번만 쓸 수 있고, 링크는 ${until}까지 쓸 수 있습니다. 받는 중에 끊기면 이 메일에 회신해 새 링크를 요청해 주세요. 다른 사람과 공유하지 마세요.\n` +
    "설치한 뒤 Nokka 메뉴에서 ‘업데이트 확인…’을 선택하세요. 등록 화면이 열리면 이 이메일 주소로 코드를 받아 이 Mac을 등록하세요. 등록한 Mac은 앱 안에서 다음 업데이트를 받을 수 있습니다.\n\nNokka 드림",
  mailSubject: "Nokka 사용 신청 관련 안내",
  mailBody: (name: string) =>
    `${name}님, 안녕하세요.\n\nNokka 사용을 신청해 주셔서 감사합니다.\n\n\n\nNokka 드림`,
};
