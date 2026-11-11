import { render, screen, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import en from "@/dictionaries/en.json";
import ko from "@/dictionaries/ko.json";
import DataPaths from "../DataPaths";

describe("DataPaths", () => {
  it("is the #privacy section", () => {
    const { container } = render(<DataPaths dict={en.dataPaths} />);
    expect(container.querySelector("section#privacy")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 2, name: en.dataPaths.heading })
    ).toBeInTheDocument();
  });

  it("has a captioned table with one row header per step", () => {
    render(<DataPaths dict={en.dataPaths} />);
    const table = screen.getByRole("table", { name: en.dataPaths.table.caption });
    expect(within(table).getAllByRole("columnheader")).toHaveLength(3);
    const rowHeaders = within(table).getAllByRole("rowheader");
    expect(rowHeaders.map((th) => th.textContent)).toEqual(
      en.dataPaths.table.rows.map((row) => row.stage)
    );
  });

  it("marks cloud destinations as leaving the Mac for screen readers", () => {
    render(<DataPaths dict={en.dataPaths} />);
    const table = screen.getByRole("table");
    const live = within(table).getByText(/Deepgram or Soniox · audio sent while recording/);
    expect(live).toHaveTextContent("(Sent off this Mac)");
    expect(live).toHaveTextContent(/speakers still on this Mac/);
    const recordings = within(table).getByRole("row", { name: /^Recordings/ });
    expect(within(recordings).queryByText(/Sent off this Mac/)).not.toBeInTheDocument();
  });

  it("keeps gap filling after a recording on this Mac whatever the engine", () => {
    render(<DataPaths dict={en.dataPaths} />);
    const table = screen.getByRole("table");
    const gaps = within(table).getByRole("row", { name: /^Filling gaps after a recording/ });
    expect(gaps).toHaveTextContent(/this Mac, whatever the engine/);
    expect(within(gaps).queryByText(/Sent off this Mac/)).not.toBeInTheDocument();
    const library = within(table).getByRole("row", { name: /^Re-transcribing from the library/ });
    expect(library).toHaveTextContent(/Deepgram or Soniox · audio sent/);
  });

  it("describes local-only mode for both cloud engines", () => {
    render(<DataPaths dict={en.dataPaths} />);
    expect(screen.getByRole("heading", { level: 3, name: "Local-only mode" })).toBeInTheDocument();
    expect(screen.getByText(/Blocks everything except model downloads/)).toHaveTextContent(
      /Deepgram and Soniox switch to engines on your Mac/
    );
  });

  it("lists the key storage, the no-audio key check, Soniox deletion and update checks", () => {
    render(<DataPaths dict={en.dataPaths} />);
    expect(screen.getByText(/Deepgram, Soniox, Claude and OpenAI keys/)).toBeInTheDocument();
    expect(screen.getByText(/connection check only verifies the key and sends no audio/)).toBeInTheDocument();
    expect(screen.getByText(/deletes the uploaded audio and transcript from Soniox/)).toBeInTheDocument();
    expect(screen.getByText(/Update checks read the release list from nokka-web on GitHub/)).toBeInTheDocument();
  });

  it("renders the Korean table", () => {
    render(<DataPaths dict={ko.dataPaths} />);
    const table = screen.getByRole("table", { name: "단계별 데이터 경로" });
    expect(within(table).getByRole("rowheader", { name: "실시간 전사·화자 구분" })).toBeInTheDocument();
    const gaps = within(table).getByRole("row", { name: /^녹음 후 빠진 구간 채우기/ });
    expect(gaps).toHaveTextContent(/엔진과 관계없이 이 Mac/);
    expect(within(gaps).queryByText(/이 Mac 밖으로 전송/)).not.toBeInTheDocument();
  });
});
