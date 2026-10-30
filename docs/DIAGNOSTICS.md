# Diagnostics and crash logs

MAXplorer writes a local, rotating diagnostic log and installs a panic hook in the Rust
process. Logging is local-only; nothing is uploaded.

## Where the log is

macOS:

```
~/Library/Application Support/com.replica.win11explorer/logs/maxplorer.log
```

Windows:

```
%APPDATA%\com.replica.win11explorer\logs\maxplorer.log
```

Linux:

```
${XDG_DATA_HOME:-~/.local/share}/com.replica.win11explorer/logs/maxplorer.log
```

If the application data directory is unavailable, setup uses a temporary fallback. The log
path is written into the log itself at startup.

Debug lines are enabled automatically in development builds. Set
`MAXPLORER_LOG=debug` before launching a release build to include them.

## How to read it

```bash
npm run logs
npm run logs -- --tail 500
```

The script prints the resolved log path, file size, and the last 300 lines by default.

Inside the app: **Settings menu → Reveal diagnostic log**. If the React interface hits an
error, the fallback screen also shows the log path and a **Reveal log** button.

## What is recorded

- App startup, version, OS, architecture, and log path.
- Search-index initialization failures.
- Storage Analyzer volume discovery, scan start/completion, scan cancellation, duplicate
  scanning, cleanup start/completion/cancellation, and cleanup counts.
- Frontend global `error` events, unhandled promise rejections, React error-boundary
  failures, and Storage Analyzer API failures.
- Any Rust panic: thread name, panic message, source location, and a forced backtrace.

Filenames and full paths can appear in storage error messages. Treat the log as private.
It is never transmitted by MAXplorer.

## Panic containment

Storage volumes, scans, duplicate detection, and cleanup are wrapped with
`logging::catch`. A panic is written with a backtrace and converted into a normal command
error, so the window can remain open and show the log location instead of disappearing
silently.

The first diagnostic run found a pre-existing crash in PDF content extraction: a UTF-8
string was truncated at a non-character boundary inside the background indexer. That code now
truncates at a valid character boundary, records extraction panics per file without stopping
the indexer, and has a regression test. The release profile uses `panic = "unwind"` so the
panic hook and containment guards remain effective in packaged builds.

## Log rotation

The active file is rotated to `maxplorer.log.1` when it reaches 8 MB. Only the current log and
one rotated file are kept.

## Reporting a crash

1. Reproduce the crash.
2. Run `npm run logs -- --tail 500`.
3. Include the complete panic/backtrace section and the last storage-scan/cleanup entries.
4. Remove any filenames or paths you do not want to share.

## Tests

Rust tests exercise the logging level functions and panic-catch wrapper without requiring a
log file. The TypeScript error boundary and global diagnostics installer are covered by the
production build/typecheck; the existing Storage Analyzer component tests continue to pass.
