import { Fragment, type ReactNode } from "react";
import type { Locale } from "@/dictionaries";

/**
 * The app's interface is Korean, so the English copy quotes its labels in Korean (‘코드 받기’). Each such quote is
 * marked lang="ko" so screen readers switch pronunciation (WCAG 3.1.2); the quote marks stay outside.
 */
export function withAppLabels(copy: string, locale: Locale): ReactNode {
  if (locale === "ko") return copy;
  return copy.split(/(‘[^’]*’)/).map((part, i) =>
    /^‘[^’]*\p{Script=Hangul}[^’]*’$/u.test(part) ? (
      <Fragment key={i}>
        ‘<span lang="ko">{part.slice(1, -1)}</span>’
      </Fragment>
    ) : (
      part
    )
  );
}
