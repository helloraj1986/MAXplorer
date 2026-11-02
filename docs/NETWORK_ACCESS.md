# Network access, SMB authentication, and macOS permissions

MAXplorer connects to SMB/network shares through macOS the same way Finder does:
**NetFS**, the framework behind Finder's *Connect to Server*. It does not bundle
its own SMB client, and it is **not sandboxed** in the current build, so
security-scoped bookmarks and App Sandbox file entitlements are not what control
access here.

This document explains the root causes that were fixed, the remaining macOS
privacy controls, and how to verify a build.

## What was wrong

### 1. Network volumes were never detected as network volumes

`is_network_mount()` used `stat -f "%T"`. On macOS `%T` is not the filesystem
type; it prints `/` for ordinary paths and network mounts alike. As a result:

- `/Volumes/RKM_MEDIA` (an `smbfs` mount) was classified as a local drive.
- `network_mount_paths()` always returned an empty list.
- After a successful mount, MAXplorer could not find the new mount path, so it
  reported "Finish connecting in macOS" and did not navigate to the share.
- Eject fell through to the disk error path instead of unmounting the share.
- The Network workspace never listed mounted servers as connected.

The fix asks the kernel with `statfs(2)` and reads `f_fstypename`
(`smbfs`, `cifs`, `afpfs`, `nfs`, `webdav`, ...).

### 2. Authentication never prompted

`smbutil view` was always run with `-g` (guest only) or `-N` (never prompt).
When no Keychain entry existed yet, both paths failed silently: the app could
not show a password prompt because `smbutil` had no terminal, and the connection
was never attempted with credentials. That is why connecting through Finder
first "fixed" it: Finder created the Keychain entry that `smbutil -N` then used.

Mounting was delegated to AppleScript's `mount volume`, which is not reliable
when the app is not frontmost and gives no way to pass a username.

The fix mounts through `NetFSMountURLSync`:

- macOS shows its normal NetAuth sign-in sheet when a password is needed.
- Keychain credentials are used automatically when present.
- Optional username/password fields exist for pre-authenticating, and are only
  held in memory; passwords are never written to workspace data.
- The function returns the actual mounted path, so MAXplorer does not have to
  guess which `/Volumes` entry appeared.

### Credential reuse: why no password prompt appeared

A successful NetFS mount does not always mean the user typed a password. macOS
first checks the login Keychain for an Internet Password whose protocol is `smb`
and whose server matches the requested host. Finder stores that item when the
user selects **Remember this password in my keychain**, so a later MAXplorer
connection can mount silently:

```bash
security find-internet-password -s rkm-hp 2>&1 |
  grep -E '"acct"|"srvr"|"ptcl"|"cdat"'
# "acct" = rajeev.mohanty@live.com
# "srvr" = rkm-hp
# "ptcl" = smb
```

An already-mounted share or a live SMB session can also be reused. Aliases such
as the LAN IP or `host.local` may resolve to the same canonical server name, so
they can reuse the same Keychain item too. This is normal macOS behavior, not a
missing authentication step in MAXplorer.

MAXplorer writes `network.connect` and `network.mount` entries to
`maxplorer.log`. They record whether a username/password was supplied and the
NetFS status, never the password itself.

To test a genuinely fresh authentication prompt, use one of these methods:

1. **Temporary Keychain removal (definitive).** Unmount the share, quit
   MAXplorer, delete the `Network Password` item for the server in Keychain
   Access, relaunch MAXplorer, and connect again. macOS should show its sign-in
   sheet. Re-save the password afterwards if desired.
2. **A separate macOS user account.** Its Keychain is empty, so the same test
   does not touch your main credentials.
3. **A server/share with no saved credential.** This proves discovery and
   mounting independently of Finder, although an existing Keychain item may still
   suppress the prompt.

### 3. Discovery only used Bonjour

Windows PCs frequently do not advertise `_smb._tcp` over Bonjour, even though
Finder can see them through Windows network discovery. MAXplorer now combines:

- Bonjour `_smb._tcp` discovery through `dns-sd`.
- WS-Discovery (`pub:Computer` probes on UDP multicast 239.255.255.250:3702),
  which is what modern Windows network browsing uses.
- A unicast NetBIOS node-status lookup to turn each WS-Discovery address into
  the PC's real name (for example `RKM-HP`), plus a broadcast NBNS fallback for
  PCs that do not implement WS-Discovery.

Manual `smb://host/share` addresses remain supported and do not depend on
discovery.

### 4. macOS Local Network privacy was not declared

macOS 15 and later require **Local Network** approval for apps that discover or
connect to devices on the LAN. The bundle had no
`NSLocalNetworkUsageDescription` or `NSBonjourServices`, so the prompt could not
be presented correctly and connections could fail before SMB authentication was
ever reached. Both keys are now in `src-tauri/Info.plist`.

The app also has the `com.apple.security.network.client` entitlement in
`src-tauri/entitlements.plist`. It has no effect while the app is unsandboxed,
but it keeps a future App Sandbox build explicit.

### 5. Full Disk Access is not the same control

There are three different macOS controls involved:

| Control | What it covers | Why it is not enough by itself |
| --- | --- | --- |
| **Full Disk Access** | Broad file access, including protected locations | Does not grant **Local Network** access, and its TCC grant is tied to the app's exact code identity |
| **Files and Folders → Network Volumes** | Reading mounted network volumes | A separate TCC service. Full Disk Access normally covers it, but only for the exact signed app identity; an ad-hoc rebuild invalidates the grant |
| **Privacy & Security → Local Network** | Discovery and TCP/UDP connections to LAN devices | Required before SMB can even negotiate credentials |

`muCommander` appears in a network privacy list because it has requested that
access and has a stable code identity. MAXplorer could not show the same entry
until it declared the Local Network usage string and actually attempted
local-network access. (muCommander also talks SMB directly rather than browsing a
macOS-mounted `/Volumes` path, so it avoids part of the network-volume TCC layer.)

#### The ad-hoc signing trap

The development build uses `"signingIdentity": "-"` (ad-hoc signing). Its
designated requirement is a **cdhash-only** requirement:

```bash
codesign -d -r- /Applications/MAXplorer.app
# designated => cdhash H"..." or cdhash H"..."
```

TCC stores that requirement when a permission is granted. Rebuilding or
reinstalling changes the cdhash, so the old grant no longer matches. The toggle
in System Settings can still look enabled while macOS denies the current binary.
Finder and muCommander are signed with stable identities, so their grants survive
updates.

For local development, remove MAXplorer from the relevant Privacy & Security
lists after installing a new build, then add the current app again. For
distribution, sign with a Developer ID Application certificate and notarize; that
gives TCC a stable identity and avoids the repeated re-approval.

## User checklist after installing a new build

1. Open **System Settings → Privacy & Security → Local Network** and enable
   MAXplorer. If it is not listed, open MAXplorer's Network workspace and press
   **Refresh** once so it performs a discovery attempt.
2. Open **Privacy & Security → Files and Folders** and enable **Network Volumes**
   for MAXplorer if it is listed. Full Disk Access can also be enabled, but it is
   not a substitute for Local Network.
3. In MAXplorer, use **Network → Connect to Server...**, enter
   `smb://server/share`, and choose **Connect**. On builds whose dialog only has
   **Save Server**, save first and then click the saved server row. Leave the
   password blank to get the macOS sign-in sheet, or enter a username/password to
   authenticate explicitly.
4. If MAXplorer mounts without a prompt, that usually means macOS Keychain
   supplied the credential. See *Credential reuse* above for how to verify a
   fresh authentication prompt.
5. Because the development build is ad-hoc signed, after replacing the app:
   remove MAXplorer from the privacy lists, relaunch, and grant access again. Or
   use a Developer ID-signed build.

Useful reset command for a local build (this clears all TCC grants for the
bundle):

```bash
tccutil reset All com.replica.win11explorer
```

## Verification

```bash
# Is the share mounted, and with which filesystem?
mount | grep smbfs
smbutil statshares -a

# Is a saved SMB credential suppressing the prompt?
security find-internet-password -s rkm-hp 2>&1 |
  grep -E '"acct"|"srvr"|"ptcl"'

# What did MAXplorer's NetFS layer report?
grep -E 'network\.(connect|mount)' \
  "$HOME/Library/Application Support/com.replica.win11explorer/logs/maxplorer.log"

# What identity does TCC see?
codesign -dv --verbose=4 /Applications/MAXplorer.app
codesign -d -r- /Applications/MAXplorer.app

# Does the app declare local-network and network-volume usage?
/usr/libexec/PlistBuddy -c 'Print :NSLocalNetworkUsageDescription' \
  /Applications/MAXplorer.app/Contents/Info.plist
/usr/libexec/PlistBuddy -c 'Print :NSNetworkVolumesUsageDescription' \
  /Applications/MAXplorer.app/Contents/Info.plist
```

If the share is mounted and readable in Terminal but MAXplorer reports a network
permission error, the cause is TCC/code identity, not POSIX file permissions.
Rebuild with a stable signing identity or re-grant the current binary.
