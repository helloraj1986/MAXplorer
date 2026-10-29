# Building the macOS DMG

A real macOS `.app` and `.dmg` **must be produced on macOS**. The Tauri macOS bundler
needs Apple's toolchain (`xcrun`, `codesign`, `hdiutil`, the macOS SDK) and must compile
the Rust backend for a macOS target.

A universal DMG was produced for the pre-rebrand 0.1.0 project on a macOS 14 GitHub
Actions runner:

- Run: https://github.com/helloraj1986/win11-explorer-macos/actions/runs/40490663104
- Release: https://github.com/helloraj1986/win11-explorer-macos/releases/tag/v0.1.0
- Local copy: `dist-macos/Windows 11 Explorer_0.1.0_universal.dmg`
- SHA-256: `AE6A6758D2007DDD954E39DAB7B1665CBED8FB3BC49A026F738F4ACC20B845CA`

It is universal (arm64 + x86_64), ad-hoc signed, and not notarized.

The DMG was mounted, launched, and screenshotted on macOS 14 CI in run
`40492290652`; evidence is in `docs/screenshots/macos-smoke.png`.

There are two supported ways to produce it. Both use the project already in this folder.

---

## Option A — Build on a Mac (fastest)

**Requirements**

- macOS 12 or later
- Xcode Command Line Tools: `xcode-select --install`
- Node.js 22 or 24 + npm
- Rust stable (`rustup`) with `cargo`

**One command**

```bash
cd /path/to/fileExplorer
bash scripts/build-macos-dmg.sh
```

The script:

1. verifies it is running on macOS and that Xcode tools exist;
2. runs `npm ci`, typecheck, frontend tests, and Rust tests;
3. adds both Apple Rust targets;
4. builds a **universal** (Apple Silicon + Intel) app and DMG;
5. verifies the DMG with `hdiutil verify`;
6. writes a SHA-256 checksum next to the DMG.

**Manual equivalent**

```bash
cd /path/to/fileExplorer
npm ci
npm run typecheck
npm test
npm run test:cargo

rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

For a native-only build on the current Mac:

```bash
npm run tauri build
# or just the installer:
npm run tauri build -- --bundles dmg
```

**Output**

Universal build:

```
src-tauri/target/universal-apple-darwin/release/bundle/macos/MAXplorer.app
src-tauri/target/universal-apple-darwin/release/bundle/dmg/MAXplorer_0.1.0_universal.dmg
```

Native build:

```
src-tauri/target/release/bundle/macos/MAXplorer.app
src-tauri/target/release/bundle/dmg/MAXplorer_0.1.0_<arch>.dmg
```

The DMG uses a 660×400 installer window with the app icon at `(180,220)` and the
Applications folder at `(480,220)`; see `src-tauri/tauri.conf.json`.

---

## Option B — GitHub Actions (no Mac required)

The repository includes `.github/workflows/macos-build.yml`. It runs on a `macos-14`
GitHub-hosted runner, builds the universal app + DMG, and uploads:

- `maxplorer-macos` (DMG)
- `maxplorer-app` (`.app` bundle)

**Use it**

1. Create a GitHub repository and push this project:

   ```bash
   git init
   git add .
   git commit -m "MAXplorer for macOS"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```

2. Open **Actions → macOS build → Run workflow**.
3. Download the `maxplorer-macos` artifact when the run completes.
4. The artifact is a zip containing the `.dmg`; unzip and distribute it.

The workflow is unsigned by default. Unsigned builds are blocked/warned by Gatekeeper
when downloaded. For distribution, configure signing and notarization secrets (below).

If you want me to trigger this for you, provide a macOS runner or a GitHub repository
where this project can be pushed. There is no `gh` CLI or authenticated GitHub session in
this environment, so I cannot create/push a repository here.

---

## Option C — Another macOS CI provider

Any macOS CI service that can run shell commands (Codemagic, MacStadium, AWS EC2 Mac,
CircleCI macOS, Buildkite macOS) works. Use the same commands as Option A, with Xcode
Command Line Tools installed.

---

## Signing and notarization

The checked-in configuration uses `"signingIdentity": "-"` so CI produces an **ad-hoc
signed** app. It launches on Apple Silicon after the usual Gatekeeper approval, but it is
not a Developer ID distribution build.

Ad-hoc signing is fine for local testing but not for normal distribution. For a Developer
ID build, set the identity in `src-tauri/tauri.conf.json` or via
`APPLE_SIGNING_IDENTITY`.

### Local signing

1. Install a **Developer ID Application** certificate in the login keychain.
2. Find its identity:

   ```bash
   security find-identity -v -p codesigning
   ```

3. Build with the identity:

   ```bash
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
   npm run tauri build -- --target universal-apple-darwin
   ```

For an ad-hoc signature (useful on Apple Silicon, still triggers Gatekeeper prompts):

```json
"bundle": { "macOS": { "signingIdentity": "-" } }
```

### Notarization

Tauri supports notarization credentials through environment variables.

Using Apple ID:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run tauri build -- --target universal-apple-darwin --bundles dmg
```

Using App Store Connect API key:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_ISSUER="issuer-uuid"
export APPLE_API_KEY="KEYID"
export APPLE_API_KEY_PATH="/absolute/path/AuthKey_KEYID.p8"
npm run tauri build -- --target universal-apple-darwin --bundles dmg
```

GitHub Actions secrets for signed builds:

| Secret | Meaning |
| --- | --- |
| `APPLE_CERTIFICATE` | base64-encoded `.p12` Developer ID certificate |
| `APPLE_CERTIFICATE_PASSWORD` | `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | app-specific password |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` | alternative App Store Connect API auth |

The current workflow does not consume these secrets. Add them as `env:` entries if you
want signed CI artifacts.

### Gatekeeper

Unsigned or un-notarized downloads show **“Apple cannot check it for malicious software”**
or **“is damaged”**. For local testing, either:

- right-click the app → **Open** → **Open**, or
- remove the quarantine attribute:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/MAXplorer.app"
  ```

For real distribution, sign and notarize instead of telling users to bypass Gatekeeper.

---

## Verify the DMG

```bash
hdiutil verify "path/to/MAXplorer.dmg"
hdiutil attach "path/to/MAXplorer.dmg"
open "/Volumes/MAXplorer"
# drag the app to Applications, then:
hdiutil detach "/Volumes/MAXplorer"
```

Check the binary architectures:

```bash
lipo -info "MAXplorer.app/Contents/MacOS/maxplorer"
```

Expected universal output includes `arm64 x86_64`.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `xcrun: error: invalid active developer path` | `xcode-select --install` |
| `cargo: command not found` | Install Rust via `rustup`, then open a new terminal |
| `npm ci` fails engine check | Use Node 22.23.4+ or Node 24.22.1+ |
| `failed to run custom build command for objc2...` | Build on macOS with Xcode tools; cross-compiling from Windows is unsupported |
| `hdiutil: create failed` | Ensure the app bundle built first and no DMG with the same name is mounted |
| DMG artifact absent in CI | Check the workflow log; run `npm run tauri build -- --bundles dmg` locally |
| Icon positions differ on CI | Known Tauri DMG CI limitation; layout is cosmetic |
| Gatekeeper blocks the app | Sign/notarize, or right-click → Open for local testing |
