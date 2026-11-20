//! Minimal, runtime-loaded bindings to libmpv.
//!
//! MAXplorer embeds mpv as its playback engine so it can "run every file" the
//! way Stremio does — MKV containers, AC3/DTS/TrueHD audio, HEVC/HDR, and
//! anything else FFmpeg can demux. WKWebView's HTML5 `<video>` cannot: it
//! refuses the MKV container outright and has no AC3/DTS decoders, which is why
//! torrent rows reported "can't play".
//!
//! The library is `dlopen`ed rather than linked, for three reasons:
//!   1. the app must still start (Files mode) when mpv isn't installed;
//!   2. it lets us search several locations and report a clear error;
//!   3. it keeps the build free of a hard link-time dependency.
//!
//! Everything here is a thin, `unsafe` FFI shim; the safe wrapper lives in
//! `player.rs`. Function/struct layouts are taken verbatim from mpv's
//! `client.h` (client API version 2.6, mpv 0.42).

#![allow(non_snake_case)]

use std::ffi::{c_char, c_double, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::OnceLock;

/// Opaque libmpv handle.
pub type MpvHandle = *mut c_void;

// ── mpv_format ──────────────────────────────────────────────────────────────
pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_INT64: c_int = 4;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

// ── mpv_event_id ────────────────────────────────────────────────────────────
#[allow(dead_code)] // part of the documented libmpv event surface
pub const MPV_EVENT_NONE: c_int = 0;
#[allow(dead_code)]
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
#[allow(dead_code)]
pub const MPV_EVENT_LOG_MESSAGE: c_int = 2;
#[allow(dead_code)]
pub const MPV_EVENT_START_FILE: c_int = 6;
#[allow(dead_code)]
pub const MPV_EVENT_END_FILE: c_int = 7;
#[allow(dead_code)]
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
#[allow(dead_code)]
pub const MPV_EVENT_SEEK: c_int = 20;
#[allow(dead_code)]
pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
#[allow(dead_code)]
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;
#[allow(dead_code)]
pub const MPV_EVENT_VIDEO_RECONFIG: c_int = 17;

// ── mpv_end_file_reason ─────────────────────────────────────────────────────
pub const MPV_END_FILE_REASON_EOF: c_int = 0;
pub const MPV_END_FILE_REASON_STOP: c_int = 2;
pub const MPV_END_FILE_REASON_QUIT: c_int = 3;
pub const MPV_END_FILE_REASON_ERROR: c_int = 4;

/// `mpv_event` — valid only until the next `mpv_wait_event` call, so callers
/// must copy anything they keep.
#[repr(C)]
pub struct MpvEvent {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventProperty {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct MpvEventLogMessage {
    pub prefix: *const c_char,
    pub level: *const c_char,
    pub text: *const c_char,
    pub log_level: c_int,
}

#[repr(C)]
pub struct MpvEventEndFile {
    pub reason: c_int,
    pub error: c_int,
    pub playlist_entry_id: i64,
    pub playlist_insert_id: i64,
    pub playlist_insert_num_entries: c_int,
}

/// Resolved libmpv entry points (subset of client.h used by MAXplorer).
#[allow(dead_code)] // the struct mirrors client.h; not every symbol is used yet
pub struct MpvApi {
    pub mpv_client_api_version: unsafe extern "C" fn() -> u64,
    pub mpv_create: unsafe extern "C" fn() -> MpvHandle,
    pub mpv_initialize: unsafe extern "C" fn(MpvHandle) -> c_int,
    pub mpv_terminate_destroy: unsafe extern "C" fn(MpvHandle),
    pub mpv_set_option_string:
        unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    pub mpv_set_option:
        unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int,
    pub mpv_set_property_string:
        unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int,
    pub mpv_set_property:
        unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int,
    pub mpv_get_property:
        unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int,
    pub mpv_get_property_string:
        unsafe extern "C" fn(MpvHandle, *const c_char) -> *mut c_char,
    pub mpv_free: unsafe extern "C" fn(*mut c_void),
    pub mpv_command: unsafe extern "C" fn(MpvHandle, *const *const c_char) -> c_int,
    pub mpv_observe_property:
        unsafe extern "C" fn(MpvHandle, u64, *const c_char, c_int) -> c_int,
    pub mpv_wait_event: unsafe extern "C" fn(MpvHandle, c_double) -> *mut MpvEvent,
    pub mpv_request_log_messages: unsafe extern "C" fn(MpvHandle, *const c_char) -> c_int,
    pub mpv_error_string: unsafe extern "C" fn(c_int) -> *const c_char,
}

/// A loaded libmpv plus its resolved symbols. The `Library` is kept alive for
/// the process lifetime.
pub struct LibMpv {
    pub api: MpvApi,
    pub path: PathBuf,
    pub version: String,
    // Held only to keep the dlopen handle (and its code) alive.
    _library: libloading::Library,
}

// Safe: the resolved function pointers are immutable and libmpv's API is
// thread-safe; the handle is only ever used through the wrapper in `player.rs`.
unsafe impl Send for LibMpv {}
unsafe impl Sync for LibMpv {}

static LIBMPV: OnceLock<Result<LibMpv, String>> = OnceLock::new();

/// Load (once per process) and cache libmpv.
pub fn libmpv() -> Result<&'static LibMpv, String> {
    match LIBMPV.get_or_init(load_libmpv) {
        Ok(lib) => Ok(lib),
        Err(error) => Err(error.clone()),
    }
}

/// Candidate locations, most specific first. The env var lets the user point at
/// a custom build without rebuilding MAXplorer.
fn candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(explicit) = std::env::var("MAXPLORER_LIBMPV") {
        if !explicit.trim().is_empty() {
            paths.push(PathBuf::from(explicit));
        }
    }
    for prefix in [
        "/opt/homebrew/lib",  // Apple-silicon Homebrew
        "/usr/local/lib",     // Intel Homebrew
        "/opt/local/lib",     // MacPorts
    ] {
        paths.push(PathBuf::from(prefix).join("libmpv.dylib"));
    }
    paths.push(PathBuf::from("libmpv.dylib")); // whatever dyld finds
    paths
}

fn load_libmpv() -> Result<LibMpv, String> {
    // Collect every attempt so a failure names each path and its real reason —
    // macOS reports different errors per path (missing file, wrong arch, or the
    // hardened runtime's library-validation refusal), and the last one alone is
    // misleading when an earlier path exists but is blocked.
    let mut attempts: Vec<String> = Vec::new();
    for path in candidate_paths() {
        let library = match unsafe { libloading::Library::new(&path) } {
            Ok(library) => library,
            Err(error) => {
                attempts.push(format!("{}: {error}", path.display()));
                continue;
            }
        };

        // Resolve each symbol under its real type; a missing one is fatal for
        // this candidate so we can try the next.
        let resolved = (|| -> Result<MpvApi, libloading::Error> {
            unsafe {
                Ok(MpvApi {
                    mpv_client_api_version: *library.get(b"mpv_client_api_version\0")?,
                    mpv_create: *library.get(b"mpv_create\0")?,
                    mpv_initialize: *library.get(b"mpv_initialize\0")?,
                    mpv_terminate_destroy: *library.get(b"mpv_terminate_destroy\0")?,
                    mpv_set_option_string: *library.get(b"mpv_set_option_string\0")?,
                    mpv_set_option: *library.get(b"mpv_set_option\0")?,
                    mpv_set_property_string: *library.get(b"mpv_set_property_string\0")?,
                    mpv_set_property: *library.get(b"mpv_set_property\0")?,
                    mpv_get_property: *library.get(b"mpv_get_property\0")?,
                    mpv_get_property_string: *library.get(b"mpv_get_property_string\0")?,
                    mpv_free: *library.get(b"mpv_free\0")?,
                    mpv_command: *library.get(b"mpv_command\0")?,
                    mpv_observe_property: *library.get(b"mpv_observe_property\0")?,
                    mpv_wait_event: *library.get(b"mpv_wait_event\0")?,
                    mpv_request_log_messages: *library.get(b"mpv_request_log_messages\0")?,
                    mpv_error_string: *library.get(b"mpv_error_string\0")?,
                })
            }
        })();

        match resolved {
            Ok(api) => {
                let raw = unsafe { (api.mpv_client_api_version)() };
                let version = format!("{}.{}", raw >> 16, raw & 0xffff);
                return Ok(LibMpv {
                    api,
                    path: path.clone(),
                    version,
                    _library: library,
                });
            }
            Err(error) => {
                attempts.push(format!("{}: {error}", path.display()));
            }
        }
    }
    Err(format!(
        "libmpv could not be loaded. Tried:\n  {}\n\
         If a path exists but was refused, the app's hardened runtime is \
         blocking it (needs com.apple.security.cs.disable-library-validation).",
        attempts.join("\n  ")
    ))
}

/// Human-readable description of a libmpv error code.
pub fn error_string(api: &MpvApi, code: c_int) -> String {
    if code >= 0 {
        return format!("ok ({code})");
    }
    unsafe {
        let ptr = (api.mpv_error_string)(code);
        if ptr.is_null() {
            format!("error {code}")
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live check that libmpv is discoverable and reports a usable API version.
    /// Ignored by default: needs mpv installed on this machine.
    #[test]
    #[ignore = "live: requires libmpv on this machine"]
    fn libmpv_loads_and_reports_api_version() {
        let lib = libmpv().expect("libmpv should load");
        assert!(!lib.version.is_empty());
        assert!(
            lib.version.starts_with("2."),
            "unexpected client API version {}",
            lib.version
        );
    }

    #[test]
    fn error_string_describes_known_and_unknown_codes() {
        let Ok(lib) = libmpv() else {
            return; // no libmpv installed: nothing to assert
        };
        assert!(error_string(&lib.api, 0).contains("ok"));
        assert!(!error_string(&lib.api, -9).is_empty());
    }
}
