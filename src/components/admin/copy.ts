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
  noChanges: "바뀐 내용이 없습니다.",
  saveFailed: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  conflict:
    "다른 곳에서 이 신청이 먼저 바뀌었습니다. 최신 내용을 불러오면 저장하지 않은 수정은 사라집니다.",
  notFound: "이 신청을 찾을 수 없습니다. 목록을 다시 불러와 주세요.",
  reload: "최신 내용 불러오기",
  compose: "메일 작성",
  composeHint: "메일 앱에 초안을 엽니다. 직접 보낸 뒤 상태를 안내완료로 바꿔 저장하세요.",
  mailSubject: "Nokka 사용 신청 관련 안내",
  mailBody: (name: string) =>
    `${name}님, 안녕하세요.\n\nNokka 사용을 신청해 주셔서 감사합니다.\n\n\n\nNokka 드림`,
};
