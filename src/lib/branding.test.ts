import { describe, expect, it } from "vitest";
import packageMetadata from "../../package.json";
import {
  APP_ICON_URL,
  APP_VERSION,
  BRAND_STATEMENT,
  PRODUCT_DESCRIPTION,
  PRODUCT_NAME,
  TAGLINE,
} from "./branding";

describe("product branding", () => {
  it("uses the official product spelling", () => {
    expect(PRODUCT_NAME).toBe("MAXplorer");
  });

  it("keeps the official tagline and brand statement", () => {
    expect(TAGLINE).toBe("More than just a file manager.");
    expect(BRAND_STATEMENT).toBe("Your files. Your way.");
  });

  it("describes the product consistently", () => {
    expect(PRODUCT_DESCRIPTION).toBe("A powerful, customisable desktop file manager.");
  });

  it("reads the version from project metadata", () => {
    expect(APP_VERSION).toBe(packageMetadata.version);
  });

  it("points the About screen at the canonical icon artwork", () => {
    expect(APP_ICON_URL).toContain("maxplorer-icon");
  });
});
