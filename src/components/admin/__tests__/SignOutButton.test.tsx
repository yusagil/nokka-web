import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, it, expect, vi } from "vitest";
import { signOutAdmin } from "@/lib/admin/auth-client";
import { copy } from "../copy";
import SignOutButton from "../SignOutButton";

vi.mock("@/lib/admin/auth-client", () => ({ signOutAdmin: vi.fn() }));
const signOut = vi.mocked(signOutAdmin);

afterEach(() => {
  signOut.mockReset();
});

describe("SignOutButton", () => {
  it("signs out once, even when pressed again while it is working", async () => {
    const user = userEvent.setup();
    signOut.mockReturnValue(new Promise(() => {})); // success navigates away and never returns
    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: copy.signOut }));
    const button = screen.getByRole("button", { name: copy.signingOut });
    expect(button).toHaveAttribute("aria-disabled", "true");
    await user.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("says so and lets you retry when sign-out fails", async () => {
    const user = userEvent.setup();
    signOut.mockRejectedValueOnce(new Error("Sign-out failed"));
    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: copy.signOut }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.signOutFailed);

    signOut.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole("button", { name: copy.signOut }));
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
