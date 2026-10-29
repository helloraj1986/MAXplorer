// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { AppIcon } from "./AppIcon";
import { Icon } from "../Icon";

afterEach(cleanup);

describe("AppIcon", () => {
  it("renders a decorative Lucide icon by default", () => {
    const { container } = render(<AppIcon name="search" />);
    const icon = container.querySelector("svg");
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.classList.contains("ui-icon")).toBe(true);
  });

  it("exposes a label when a title is provided", () => {
    const { container } = render(<AppIcon name="search" title="Search files" />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("role")).toBe("img");
    expect(icon?.getAttribute("aria-label")).toBe("Search files");
    expect(icon?.getAttribute("aria-hidden")).toBeNull();
  });

  it("keeps the compatibility Icon facade working", () => {
    const { container } = render(<Icon name="refresh" size={18} />);
    const icon = container.querySelector("svg");
    expect(icon?.getAttribute("width")).toBe("18");
    expect(icon?.getAttribute("height")).toBe("18");
  });
});
