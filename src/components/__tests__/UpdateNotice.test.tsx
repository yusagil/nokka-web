import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import UpdateNotice from "../UpdateNotice";

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("UpdateNotice", () => {
  it("has one page heading and a section heading for each part of the way", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Nokka 업데이트 방식이 바뀝니다" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual([
      "먼저 업데이트 창을 확인하세요",
      "이 Mac 등록하기",
      "다시 설치했거나 Mac을 바꿨다면",
      "설치 파일이 필요하다면",
      "아직 사용 신청을 하지 않았다면",
    ]);
  });

  it("says the current version keeps working and no public installer is offered", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    const intro = screen.getByText(/앞으로 Nokka 업데이트는 등록한 Mac에서 앱 안으로 받습니다/);
    expect(intro).toHaveTextContent("공개 설치 파일은 제공하지 않습니다.");
    expect(intro).toHaveTextContent("등록하지 않아도 지금 쓰는 버전은 그대로 쓸 수 있습니다.");
  });

  it("registers in the app's order, with the app's own labels", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    const region = screen.getByRole("region", { name: "이 Mac 등록하기" });
    const steps = within(within(region).getAllByRole("list")[0]).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(steps[0]).toHaveTextContent("‘업데이트 확인…’");
    expect(steps[0]).toHaveTextContent("환경설정 › 일반의 ‘업데이트 등록’에서 ‘등록…’");
    expect(steps[1]).toHaveTextContent("사용 신청 때 쓴 이메일을 입력하고 ‘코드 받기’");
    expect(steps[2]).toHaveTextContent("운영팀이 업데이트를 승인한 신청 이메일이면 8자리 일회용 코드");
    expect(steps[2]).toHaveTextContent("요청한 Mac의 그 앱에서");
    expect(steps[3]).toHaveTextContent("‘등록’을 누르세요. ‘이 Mac에 등록됨’");
    expect(within(region).getByRole("heading", { level: 3, name: "코드가 오지 않거나 만료됐다면" })).toBeInTheDocument();
    expect(within(region).getByText(/‘새 코드 받기’/)).toBeInTheDocument();
  });

  it("allows one Mac per email, and hands updates over only when the new registration is done", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    const region = screen.getByRole("region", { name: "다시 설치했거나 Mac을 바꿨다면" });
    expect(within(region).getByText("이메일 하나에 Mac 한 대를 등록합니다.")).toBeInTheDocument();
    expect(within(region).getByText(/새 코드를 받아 위 순서대로 다시 등록하세요/)).toBeInTheDocument();
    expect(within(region).getByText(/이전 등록은 새 등록을 마칠 때까지 그대로입니다/)).toBeInTheDocument();
  });

  it("links only to the access request, never to a file or a download", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName("사용 신청하기");
    expect(links[0]).toHaveAttribute("href", "/ko#apply");
    const copy = [...strings(ko.updates), ...strings(en.updates)].join("\n");
    expect(copy).not.toMatch(/\.(dmg|zip|pkg)\b|releases|다운로드|download/i);
  });

  it("offers approved users a private, time-limited installer link sent separately, with no link on the page", () => {
    render(<UpdateNotice dict={ko.updates} locale="ko" />);
    const region = screen.getByRole("region", { name: "설치 파일이 필요하다면" });
    expect(region).toHaveTextContent(
      "업데이트가 승인된 사용자에게는 유효 기간이 있는 비공개 설치 링크를 따로 전달합니다."
    );
    expect(region).toHaveTextContent("이 페이지에는 설치 파일이나 설치 링크가 없습니다.");
    expect(region).toHaveTextContent("받은 링크는 유효 기간 안에 쓰고, 다른 사람과 공유하지 마세요.");
    expect(region).toHaveTextContent("설치한 뒤에는 위 순서대로 이 Mac을 등록해야");
    expect(within(region).queryByRole("link")).toBeNull();
    expect(en.updates.installer.body[1]).toMatch(/private installer link, valid for a limited time, separately/);
  });

  it("names no delivery channel, request route or automatic sending, which do not exist yet", () => {
    for (const dict of [ko.updates, en.updates]) {
      expect(strings(dict.installer).join("\n")).not.toMatch(
        /GitHub|이메일|메일|문의|요청|신청|자동|즉시|email|contact|issue|\bform\b|request|automatic|instant/i
      );
    }
  });

  it("makes no promise about requesting access again", () => {
    const copy = [...strings(ko.updates), ...strings(en.updates)].join("\n");
    expect(copy).not.toMatch(/다시 신청할 필요|재신청|request (access )?again|no need to request/i);
  });

  it("renders the English notice and quotes the app's Korean labels with a translation", () => {
    render(<UpdateNotice dict={en.updates} locale="en" />);
    expect(screen.getByRole("heading", { level: 1, name: "Nokka updates are changing" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: "Register this Mac" });
    const steps = within(within(region).getAllByRole("list")[0]).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("‘업데이트 확인…’ (Check for Updates)");
    expect(steps[1]).toHaveTextContent("‘코드 받기’ (Get code)");
    expect(steps[3]).toHaveTextContent("‘등록’ (Register)");
    expect(screen.getByRole("link", { name: "Request access" })).toHaveAttribute("href", "/en#apply");
  });

  it("marks every Korean app label on the English page as Korean, inside its quote marks", () => {
    const { container } = render(
      <div lang="en">
        <UpdateNotice dict={en.updates} locale="en" />
      </div>
    );
    const marked = [...container.querySelectorAll('[lang="ko"]')];
    expect(marked.map((element) => element.textContent)).toEqual([
      "업데이트 확인…",
      "업데이트 확인…",
      "등록…",
      "업데이트 등록",
      "코드 받기",
      "등록",
      "이 Mac에 등록됨",
      "업데이트 확인…",
      "새 코드 받기",
    ]);
    for (const element of marked) {
      expect(element.previousSibling?.textContent?.endsWith("‘")).toBe(true);
      expect(element.nextSibling?.textContent?.startsWith("’")).toBe(true);
    }
    // No Hangul is left to the page's English: every text node with Hangul sits in a lang="ko" element.
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const unmarked: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (/\p{Script=Hangul}/u.test(node.textContent ?? "") && node.parentElement?.closest("[lang]")?.getAttribute("lang") !== "ko") {
        unmarked.push(node.textContent ?? "");
      }
    }
    expect(unmarked).toEqual([]);
  });

  it("adds no language marks to the Korean page", () => {
    const { container } = render(<UpdateNotice dict={ko.updates} locale="ko" />);
    expect(container.querySelector("[lang]")).toBeNull();
    expect(screen.getByText(/사용 신청 때 쓴 이메일을 입력하고 ‘코드 받기’를 누르세요/)).toBeInTheDocument();
  });
});
