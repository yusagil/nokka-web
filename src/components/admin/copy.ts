import type { ApplicationStatus } from "@/lib/admin/contracts";

// The inbox is for the one operator and is Korean only, so its copy lives here rather than in the
// public en/ko dictionaries.

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  new: "신규",
  hold: "보류",
  contacted: "안내완료",
};

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
    "켜면 이 이메일로 앱에서 등록 코드를 받아 Mac 한 대를 등록할 수 있습니다. 켜는 것만으로 메일이 가지는 않습니다.",
  updatesRevokeWarning:
    "끄고 저장하면 등록된 Mac의 업데이트와 아직 쓰지 않은 코드가 바로 중단됩니다. 다시 켜도 새 코드로 다시 등록해야 합니다.",
  updatesApprovedBadge: "업데이트 허용",
  noChanges: "바뀐 내용이 없습니다.",
  saveFailed: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  conflict:
    "다른 곳에서 이 신청이 먼저 바뀌었습니다. 최신 내용을 불러오면 저장하지 않은 수정은 사라집니다.",
  notFound: "이 신청을 찾을 수 없습니다. 목록을 다시 불러와 주세요.",
  reload: "최신 내용 불러오기",
  compose: "메일 작성",
  composeHint: "메일 앱에 초안을 엽니다. 직접 보낸 뒤 상태를 안내완료로 바꿔 저장하세요.",
  installLinkLegend: "비공개 설치 링크",
  installLinkHint: (hours: number) =>
    `이 신청자에게만 전달할 설치 파일 링크입니다. ${hours}시간 동안 쓸 수 있고, 새로 만들면 이전 링크는 바로 막힙니다. 링크 주소는 만든 직후 이 화면에서만 볼 수 있습니다.`,
  installLinkRevokeHint:
    "회수하거나 새로 만들면 그 링크의 새 요청(이어 받기 포함)은 바로 거절됩니다. 이미 시작된 다운로드는 중간에 끊지 않으므로 끝까지 받을 수 있습니다.",
  installLinkIssue: "설치 링크 만들기",
  installLinkReissue: "새 링크 만들기",
  installLinkIssuing: "만드는 중…",
  installLinkRevoke: "링크 회수",
  installLinkRevoking: "회수 중…",
  installLinkLabel: "설치 링크",
  installLinkSummary: (version: string, build: number, until: string) =>
    `Nokka ${version} (${build}) 설치 파일 · ${until}까지 사용 가능. 이 화면을 벗어나면 주소를 다시 볼 수 없습니다.`,
  installLinkCopy: "복사",
  installLinkCopied: "링크를 복사했습니다.",
  installLinkCopyFailed: "복사하지 못했습니다. 링크를 직접 선택해 복사하세요.",
  installLinkCompose: "링크 메일 작성",
  installLinkComposeHint: "메일 앱에 신청 이메일로 보낼 초안을 엽니다. 직접 확인하고 보내세요.",
  installLinkRevoked: "링크를 회수했습니다. 새 요청은 거절되며, 이미 시작된 다운로드는 끝까지 받을 수 있습니다.",
  installLinkNoneOpen: "열려 있는 링크가 없습니다.",
  installLinkNotApproved: "업데이트 허용을 저장한 뒤에 만들 수 있습니다. 목록을 다시 불러와 주세요.",
  installLinkNoInstaller: "아직 전달할 설치 파일이 지정되지 않았습니다. 릴리스 도구에서 설치 파일을 지정해야 합니다.",
  installLinkIssueFailed: "링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
  installLinkRevokeFailed: "링크를 회수하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  installLinkMailSubject: "Nokka 설치 링크 안내",
  installLinkMailBody: (name: string, url: string, until: string) =>
    `${name}님, 안녕하세요.\n\nNokka 업데이트가 승인되어 설치 파일 링크를 보내 드립니다.\n\n${url}\n\n` +
    `이 링크는 ${until}까지 사용할 수 있습니다. 다른 사람과 공유하지 마세요.\n` +
    "설치한 뒤 Nokka 메뉴에서 ‘업데이트 확인…’을 선택하세요. 등록 화면이 열리면 이 이메일 주소로 코드를 받아 이 Mac을 등록하세요. 등록한 Mac은 앱 안에서 다음 업데이트를 받을 수 있습니다.\n\nNokka 드림",
  mailSubject: "Nokka 사용 신청 관련 안내",
  mailBody: (name: string) =>
    `${name}님, 안녕하세요.\n\nNokka 사용을 신청해 주셔서 감사합니다.\n\n\n\nNokka 드림`,
};
