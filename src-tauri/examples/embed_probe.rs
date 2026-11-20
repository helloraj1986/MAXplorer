//! Dev probe: proves libmpv embeds into an NSView on the **real main thread**.
//!
//! This exists because the test harness runs `#[test]`s on worker threads, where
//! AppKit aborts (`fatal runtime error: Rust cannot catch foreign exceptions`).
//! An example binary's `main` is the true main thread, so the full embedding
//! path — NSWindow → NSView → mpv `wid` → decode — can be exercised headlessly.
//!
//! Usage:
//!   cargo run --example embed_probe -- /path/to/video.mkv
//!   cargo run --example embed_probe -- http://127.0.0.1:18081/torrents/<hash>/stream/0

fn main() {
    let Some(target) = std::env::args().nth(1) else {
        eprintln!("usage: embed_probe <file-or-url> [seconds]");
        std::process::exit(2);
    };
    let seconds = std::env::args()
        .nth(2)
        .and_then(|value| value.parse().ok())
        .unwrap_or(20);

    match maxplorer_lib::player::dev_probe_embed(&target, seconds) {
        Ok(report) => println!("PROBE OK: {report}"),
        Err(error) => {
            eprintln!("PROBE FAILED: {error}");
            std::process::exit(1);
        }
    }
}
