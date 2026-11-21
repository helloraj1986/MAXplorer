// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MediaShell } from "./MediaShell";
import { MediaRail } from "./MediaRail";
import { useMediaStore } from "../../state/mediaStore";

describe("MediaShell", () => {
  afterEach(cleanup);
  beforeEach(() => {
    useMediaStore.setState({
      workspaceOpen: true,
      screen: "board",
      searchQuery: "",
      manifest: null,
      manifestLoading: false,
      engine: null,
    });
  });

  it("renders the rail, the top bar and the content slot", () => {
    render(
      <MediaShell>
        <p>board content</p>
      </MediaShell>,
    );
    expect(screen.getByRole("navigation", { name: "Media navigation" })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: "Search addons" })).toBeTruthy();
    expect(screen.getByText("board content")).toBeTruthy();
  });

  it("hides the chrome in player mode and shows it again on the board", () => {
    useMediaStore.setState({ screen: "player" });
    const { rerender } = render(
      <MediaShell>
        <p>player</p>
      </MediaShell>,
    );
    expect(screen.queryByRole("navigation", { name: "Media navigation" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Search addons" })).toBeNull();

    useMediaStore.setState({ screen: "board" });
    rerender(
      <MediaShell>
        <p>player</p>
      </MediaShell>,
    );
    expect(screen.getByRole("navigation", { name: "Media navigation" })).toBeTruthy();
  });

  it("keeps Disabled roadmap destinations inert and labelled", () => {
    render(
      <MediaShell>
        <p>board</p>
      </MediaShell>,
    );
    for (const label of ["Library", "Calendar", "Addons", "Settings"]) {
      const button = screen.getByRole("button", { name: label }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.title.length).toBeGreaterThan(0);
    }
  });
});

describe("MediaRail", () => {
  afterEach(cleanup);
  beforeEach(() => {
    useMediaStore.setState({ screen: "board", searchQuery: "", engine: null });
  });

  it("marks Home as the active destination on the board", () => {
    render(<MediaRail />);
    const home = screen.getByRole("button", { name: "Home" });
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(home.tabIndex).toBe(0);
  });

  it("moves focus with the arrow keys between enabled items", () => {
    render(<MediaRail />);
    const home = screen.getByRole("button", { name: "Home" });
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    // Library / Calendar / Addons are disabled, so Discover is the next stop.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Discover" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowUp" });
    expect(document.activeElement).toBe(home);
  });

  it("returns to the board and clears the selection from Home", () => {
    useMediaStore.setState({ screen: "detail" });
    render(<MediaRail />);
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(useMediaStore.getState().screen).toBe("board");
  });

  it("shows the search field value from the store", () => {
    useMediaStore.setState({ searchQuery: "sintel" });
    render(
      <MediaShell>
        <p>board</p>
      </MediaShell>,
    );
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("sintel");
  });
});
