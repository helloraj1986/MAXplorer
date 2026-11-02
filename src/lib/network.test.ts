import { describe, expect, it } from "vitest";
import {
  networkAddressHasShare,
  networkAddressHost,
  networkAddressUsername,
  networkConnectionName,
  networkDisplayName,
  normalizeNetworkAddress,
  withNetworkUsername,
} from "./network";

describe("network addresses", () => {
  it("accepts bare hosts and common network protocols", () => {
    expect(normalizeNetworkAddress("server.local")).toBe("smb://server.local");
    expect(normalizeNetworkAddress("smb://server/share/")).toBe("smb://server/share");
    expect(normalizeNetworkAddress("AFP://Studio/Projects")).toBe(
      "afp://Studio/Projects",
    );
    expect(normalizeNetworkAddress("nfs://nas/export")).toBe("nfs://nas/export");
  });

  it("rejects unsupported or incomplete addresses", () => {
    expect(normalizeNetworkAddress("")).toBeNull();
    expect(normalizeNetworkAddress("https://example.com")).toBeNull();
    expect(normalizeNetworkAddress("smb://")).toBeNull();
  });

  it("drops passwords while keeping usernames and ports", () => {
    expect(normalizeNetworkAddress("smb://user:secret@server:445/share")).toBe(
      "smb://user@server:445/share",
    );
  });

  it("attaches and reads usernames without double-encoding them", () => {
    expect(withNetworkUsername("smb://server/share", "Rajeev")).toBe(
      "smb://Rajeev@server/share",
    );
    expect(withNetworkUsername("smb://server/share", "first last")).toBe(
      "smb://first%20last@server/share",
    );
    expect(networkAddressUsername("smb://first%20last@server/share")).toBe(
      "first last",
    );
    expect(withNetworkUsername("smb://old@server/share", "")).toBe(
      "smb://server/share",
    );
  });

  it("derives friendly names and share information", () => {
    expect(networkAddressHost("smb://Studio.local/share")).toBe("Studio");
    expect(networkDisplayName("smb://Studio.local/Projects")).toBe("Projects");
    expect(networkDisplayName("smb://Studio.local")).toBe("Studio");
    expect(networkAddressHasShare("smb://Studio.local/Projects")).toBe(true);
    expect(networkAddressHasShare("smb://Studio.local")).toBe(false);
    expect(networkConnectionName("  Media   server ", "smb://nas/media")).toBe(
      "Media server",
    );
  });
});
