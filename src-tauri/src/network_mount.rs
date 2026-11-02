//! Mounting network volumes through macOS NetFS.
//!
//! Finder does not mount SMB shares itself: it calls the same NetFS framework
//! (through NetAuthAgent) that this module uses. NetFS handles name resolution,
//! SMB session setup, Keychain lookup, and the native authentication dialog.
//! Using it means MAXplorer can connect independently instead of shelling out to
//! `smbutil`, which cannot show a credential prompt when it has no terminal.

use crate::error::AppError;

/// Ask macOS to mount a network URL. When `username` or `password` is omitted
/// NetFS uses the Keychain and, if no saved credential exists, shows the same
/// authentication sheet Finder shows. Passwords are never written to disk here.
#[cfg(target_os = "macos")]
pub fn mount(
    address: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<Option<String>, AppError> {
    imp::mount(address, username, password)
}

#[cfg(not(target_os = "macos"))]
pub fn mount(
    _address: &str,
    _username: Option<&str>,
    _password: Option<&str>,
) -> Result<Option<String>, AppError> {
    Err(AppError::new(
        "not_supported",
        "Network mounting is only available in the macOS build.",
        None,
    ))
}

#[cfg(target_os = "macos")]
mod imp {
    use super::AppError;
    use core_foundation::array::{CFArray, CFArrayRef};
    use core_foundation::base::{kCFAllocatorDefault, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use core_foundation::url::{CFURL, CFURLRef};
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "NetFS", kind = "framework")]
    extern "C" {
        fn NetFSMountURLSync(
            url: CFURLRef,
            mountpath: CFURLRef,
            user: CFStringRef,
            passwd: CFStringRef,
            open_options: *const c_void,
            mount_options: *const c_void,
            mountpoints: *mut CFArrayRef,
        ) -> i32;
    }

    // core-foundation-sys does not expose this constructor, so declare it here.
    extern "C" {
        fn CFURLCreateWithString(
            allocator: core_foundation::base::CFAllocatorRef,
            url_string: CFStringRef,
            base_url: CFURLRef,
        ) -> CFURLRef;
    }

    fn status_error(status: i32, address: &str) -> AppError {
        // NetFS returns 0 on success, positive errno values, and negative
        // OSStatus values. Keep the common ones human-readable and preserve the
        // raw status for diagnostics.
        let (code, message) = match status {
            -128 => ("cancelled", "The connection was cancelled."),
            -6003 | -5998 => (
                "no_shares",
                "The server accepted the connection but did not offer any available shares.",
            ),
            -6004 => (
                "guest_not_supported",
                "The server does not allow guest access. Enter a username and password.",
            ),
            -5045 => (
                "password_expired",
                "The server requires you to change this account's password before signing in.",
            ),
            -5046 => (
                "password_rejected",
                "The server rejected the new password because it does not meet the password policy.",
            ),
            -5999 => (
                "account_restricted",
                "The server account is restricted or locked.",
            ),
            -5996 | -5997 => (
                "incompatible_server",
                "The server does not support an authentication or SMB version that macOS can use.",
            ),
            -6602 => (
                "connection_failed",
                "macOS could not mount the share. Check the server name, share name, and credentials. If the server is on your local network, also allow MAXplorer in System Settings > Privacy & Security > Local Network.",
            ),
            13 => (
                "permission_denied",
                "macOS denied permission to mount this network volume.",
            ),
            2 => (
                "not_found",
                "The server or share could not be found on the network.",
            ),
            60 | 65 | 51 => (
                "connection_failed",
                "The server could not be reached. If it is on your local network, allow MAXplorer in System Settings > Privacy & Security > Local Network.",
            ),
            _ => (
                "connection_failed",
                "macOS could not connect to the server.",
            ),
        };
        AppError::new(
            code,
            format!("{message} (NetFS status {status})"),
            Some(address.to_string()),
        )
    }

    pub fn mount(
        address: &str,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Option<String>, AppError> {
        let url_string = CFString::new(address);
        let url = unsafe {
            CFURLCreateWithString(
                kCFAllocatorDefault,
                url_string.as_concrete_TypeRef(),
                ptr::null(),
            )
        };
        if url.is_null() {
            return Err(AppError::invalid("The server address is not valid."));
        }
        let url = unsafe { CFURL::wrap_under_create_rule(url) };

        let user = username
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(CFString::new);
        let pass = password
            .filter(|value| !value.is_empty())
            .map(CFString::new);

        let user_ref = user
            .as_ref()
            .map(|value| value.as_concrete_TypeRef())
            .unwrap_or(ptr::null());
        let pass_ref = pass
            .as_ref()
            .map(|value| value.as_concrete_TypeRef())
            .unwrap_or(ptr::null());

        let mut mountpoints: CFArrayRef = ptr::null();
        // NULL open/mount options let NetFS use its normal defaults, including
        // showing the authentication sheet when a password is required.
        let status = unsafe {
            NetFSMountURLSync(
                url.as_concrete_TypeRef(),
                ptr::null(),
                user_ref,
                pass_ref,
                ptr::null(),
                ptr::null(),
                &mut mountpoints,
            )
        };

        if status != 0 {
            crate::logging::error(
                "network.mount",
                format!("NetFS status {status} for {address}"),
            );
            return Err(status_error(status, address));
        }

        if mountpoints.is_null() {
            crate::logging::info("network.mount", format!("mounted {address} without a path"));
            return Ok(None);
        }

        let mountpoints = unsafe { CFArray::<CFString>::wrap_under_create_rule(mountpoints) };
        let path = mountpoints
            .iter()
            .next()
            .map(|value| value.to_string())
            .filter(|value| !value.is_empty());
        crate::logging::info(
            "network.mount",
            format!(
                "NetFS mounted {address} at {}",
                path.as_deref().unwrap_or("an unknown path")
            ),
        );
        Ok(path)
    }
}
