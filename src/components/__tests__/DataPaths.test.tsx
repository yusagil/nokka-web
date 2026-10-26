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
    const deepgram = within(table).getByText(/Deepgram · audio sent while recording/);
    expect(deepgram).toHaveTextContent("(Sent off this Mac)");
    const recordings = within(table).getByRole("row", { name: /^Recordings/ });
    expect(within(recordings).queryByText(/Sent off this Mac/)).not.toBeInTheDocument();
  });

  it("describes local-only mode", () => {
    render(<DataPaths dict={en.dataPaths} />);
    expect(screen.getByRole("heading", { level: 3, name: "Local-only mode" })).toBeInTheDocument();
    expect(screen.getByText(/Blocks everything except model downloads/)).toBeInTheDocument();
  });

  it("renders the Korean table", () => {
    render(<DataPaths dict={ko.dataPaths} />);
    const table = screen.getByRole("table", { name: "단계별 데이터 경로" });
    expect(within(table).getByRole("rowheader", { name: "실시간 전사·화자 구분" })).toBeInTheDocument();
  });
});
