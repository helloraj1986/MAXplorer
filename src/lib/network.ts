/**
 * Network connection metadata helpers.
 *
 * MAXplorer stores only the server address and a friendly name. Credentials
 * stay with the operating system's credential store; passwords are stripped
 * before an address is saved.
 */

export const NETWORK_PROTOCOLS = ["smb", "cifs", "afp", "nfs", "ftp"] as const;

export type NetworkProtocol = (typeof NETWORK_PROTOCOLS)[number];

const ADDRESS_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

export function normalizeNetworkAddress(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = ADDRESS_PATTERN.test(trimmed) ? trimmed : `smb://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  const protocol = url.protocol.replace(/:$/, "").toLowerCase();
  if (!NETWORK_PROTOCOLS.includes(protocol as NetworkProtocol)) return null;
  if (!url.hostname) return null;
  // Keep a username for servers that use per-user shares, but never persist a
  // password in the workspace snapshot.
  const user = url.username ? `${url.username}@` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${protocol}://${user}${url.host}${path}`;
}

/** Username embedded in a saved server address, if any. */
export function networkAddressUsername(address: string): string {
  try {
    return decodeURIComponent(new URL(address).username);
  } catch {
    return "";
  }
}

/** Return an address carrying the supplied username (empty clears it). */
export function withNetworkUsername(address: string, username: string): string {
  const normalized = normalizeNetworkAddress(address);
  if (!normalized) return address;
  try {
    const url = new URL(normalized);
    const clean = username.trim();
    url.username = clean;
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol.replace(/:$/, "")}://${url.username ? `${url.username}@` : ""}${url.host}${path}`;
  } catch {
    return normalized;
  }
}

export function networkAddressHost(address: string): string {
  const normalized = normalizeNetworkAddress(address) ?? address;
  try {
    const url = new URL(normalized);
    return url.hostname.replace(/\.local$/i, "");
  } catch {
    return normalized;
  }
}

/** Default label when the user leaves the name field blank. */
export function networkDisplayName(address: string): string {
  const normalized = normalizeNetworkAddress(address) ?? address;
  try {
    const url = new URL(normalized);
    const parts = url.pathname.split("/").filter(Boolean);
    const share = parts.length ? decodeURIComponent(parts[parts.length - 1]) : "";
    return share || networkAddressHost(normalized);
  } catch {
    return networkAddressHost(normalized);
  }
}

export function networkAddressHasShare(address: string): boolean {
  const normalized = normalizeNetworkAddress(address);
  if (!normalized) return false;
  try {
    return new URL(normalized).pathname.split("/").filter(Boolean).length > 0;
  } catch {
    return false;
  }
}

export function networkConnectionName(name: string, address: string): string {
  const clean = name.trim().replace(/\s+/g, " ").slice(0, 60);
  return clean || networkDisplayName(address);
}

let counter = 0;

export function createNetworkConnectionId(now: number = Date.now()): string {
  counter += 1;
  return `net-${now.toString(36)}-${counter.toString(36)}`;
}
