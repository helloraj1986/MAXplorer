//! Bounded discovery of SMB computers and shares on the local network.
//!
//! Finder uses Bonjour and NetBIOS/SMB browsing for discovery, and NetFS for
//! mounting. MAXplorer uses the same concepts: `dns-sd` for Bonjour, a small
//! NetBIOS node-status probe for Windows PCs that do not advertise Bonjour, and
//! `smbutil` only for listing shares. Mounting itself goes through NetFS (see
//! `network_mount`) so macOS can present its normal credential sheet.

use crate::error::AppError;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkComputer {
    pub name: String,
    pub host: Option<String>,
    pub address: Option<String>,
}

fn run_bounded(mut command: Command, duration: Duration) -> String {
    command.stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return String::new(),
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => return String::new(),
    };
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    let deadline = Instant::now() + duration;
    let mut output = String::new();
    loop {
        let now = Instant::now();
        if now >= deadline {
            break;
        }
        match receiver.recv_timeout(deadline - now) {
            Ok(line) => {
                output.push_str(&line);
                output.push('\n');
            }
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    drop(receiver);
    let _ = reader.join();
    output
}

fn parse_instances(output: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in output.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.get(1).copied() != Some("Add") || !line.contains("_smb._tcp.") {
            continue;
        }
        if let Some(index) = line.find("_smb._tcp.") {
            let name = line[index + "_smb._tcp.".len()..].trim();
            if !name.is_empty() && !names.iter().any(|existing| existing == name) {
                names.push(name.to_string());
            }
        }
    }
    names
}

fn resolve_instance(name: String) -> NetworkComputer {
    let mut command = Command::new("/usr/bin/dns-sd");
    command.args(["-L", &name, "_smb._tcp", "local."]);
    let output = run_bounded(command, Duration::from_millis(1_800));
    for line in output.lines() {
        if let Some(index) = line.find("can be reached at ") {
            let rest = &line[index + "can be reached at ".len()..];
            let host = rest
                .split(':')
                .next()
                .unwrap_or("")
                .trim()
                .trim_end_matches('.')
                .to_string();
            if !host.is_empty() {
                return NetworkComputer {
                    name,
                    host: Some(host.clone()),
                    address: Some(format!("smb://{host}")),
                };
            }
        }
    }
    NetworkComputer {
        name,
        host: None,
        address: None,
    }
}

/// NetBIOS node-status request for the wildcard name (`*`). Windows PCs answer
/// this even when they do not advertise `_smb._tcp` over Bonjour, which is why
/// Finder can usually see them while a Bonjour-only browser cannot.
#[cfg(target_os = "macos")]
fn nbns_node_status_request(transaction_id: u16) -> Vec<u8> {
    let mut packet = Vec::with_capacity(50);
    packet.extend_from_slice(&transaction_id.to_be_bytes());
    packet.extend_from_slice(&[0x00, 0x00]); // standard query
    packet.extend_from_slice(&[0x00, 0x01]); // one question
    packet.extend_from_slice(&[0x00, 0x00]); // no answers
    packet.extend_from_slice(&[0x00, 0x00]); // no authority
    packet.extend_from_slice(&[0x00, 0x00]); // no additional
    packet.push(0x20); // encoded NetBIOS name length
    packet.extend_from_slice(b"CK"); // first nibble pair is 0x2a (`*`)
    for _ in 0..15 {
        packet.extend_from_slice(b"AA"); // remaining nibbles are zero
    }
    packet.push(0x00); // end of name
    packet.extend_from_slice(&[0x00, 0x21]); // NBSTAT
    packet.extend_from_slice(&[0x00, 0x01]); // IN
    packet
}

fn read_u16(packet: &[u8], index: usize) -> Option<u16> {
    Some(u16::from_be_bytes([
        *packet.get(index)?,
        *packet.get(index + 1)?,
    ]))
}

fn skip_nbns_name(packet: &[u8], mut index: usize) -> Option<usize> {
    loop {
        let length = *packet.get(index)? as usize;
        if length == 0 {
            return Some(index + 1);
        }
        if length & 0xc0 == 0xc0 {
            // Compression pointer: two bytes, no further name data.
            return Some(index + 2);
        }
        index = index.checked_add(1 + length)?;
        if index > packet.len() {
            return None;
        }
    }
}

fn trim_netbios_name(bytes: &[u8]) -> String {
    let end = bytes
        .iter()
        .position(|value| *value == 0 || *value == b' ')
        .unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).trim().to_string()
}

/// Extract the workstation (suffix 0x00) or file-server (0x20) name from a
/// NetBIOS node-status response. Group names and domain/workgroup entries are
/// ignored so the result is the PC's own name.
fn parse_nbns_response(packet: &[u8]) -> Option<String> {
    if packet.len() < 12 {
        return None;
    }
    let questions = read_u16(packet, 4)? as usize;
    let answers = read_u16(packet, 6)? as usize;
    let authority = read_u16(packet, 8)? as usize;
    let additional = read_u16(packet, 10)? as usize;

    let mut index = 12usize;
    for _ in 0..questions {
        index = skip_nbns_name(packet, index)?;
        index = index.checked_add(4)?; // type + class
        if index > packet.len() {
            return None;
        }
    }

    let mut workstation = None;
    let mut file_server = None;
    for _ in 0..(answers + authority + additional) {
        index = skip_nbns_name(packet, index)?;
        let rdtype = read_u16(packet, index)?;
        let rdlength = read_u16(packet, index + 8)? as usize;
        let data_start = index.checked_add(10)?;
        let data_end = data_start.checked_add(rdlength)?;
        if data_end > packet.len() {
            return None;
        }
        if rdtype == 0x0021 && rdlength > 0 {
            let count = packet[data_start] as usize;
            let mut offset = data_start + 1;
            for _ in 0..count {
                if offset + 18 > data_end {
                    break;
                }
                let name = trim_netbios_name(&packet[offset..offset + 15]);
                let suffix = packet[offset + 15];
                let flags = read_u16(packet, offset + 16)?;
                // The high bit marks a group/domain name rather than this host.
                if !name.is_empty() && flags & 0x8000 == 0 {
                    match suffix {
                        0x00 => workstation = Some(name),
                        0x20 => file_server = Some(name),
                        _ => {}
                    }
                }
                offset += 18;
            }
        }
        index = data_end;
    }
    workstation.or(file_server)
}

/// WS-Discovery probe used by Windows network browsing (and by Finder's
/// Nearby Computers list). It is multicast UDP, so it does not depend on the
/// server advertising Bonjour or answering NetBIOS broadcasts.
#[cfg(target_os = "macos")]
fn wsd_probe_message() -> String {
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos() as u64)
        .unwrap_or(1);
    let suffix = seed & 0x0000_ffff_ffff_ffff;
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<soap:Envelope xmlns:soap=\"http://www.w3.org/2003/05/soap-envelope\" \
xmlns:wsa=\"http://schemas.xmlsoap.org/ws/2004/08/addressing\" \
xmlns:wsd=\"http://schemas.xmlsoap.org/ws/2005/04/discovery\">\
<soap:Header><wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>\
<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>\
<wsa:MessageID>urn:uuid:6ba7b810-9dad-11d1-80b4-{suffix:012x}</wsa:MessageID>\
</soap:Header><soap:Body><wsd:Probe/></soap:Body></soap:Envelope>"
    )
}

fn host_from_wsd_endpoint(url: &str) -> Option<String> {
    let rest = url.split("://").nth(1)?;
    let authority = rest.split('/').next()?.trim();
    if let Some(rest) = authority.strip_prefix('[') {
        return rest.split(']').next().map(str::to_string);
    }
    let host = authority.split(':').next()?.trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn parse_wsd_endpoints(message: &str) -> Vec<String> {
    let mut hosts = Vec::new();
    let mut rest = message;
    while let Some(index) = rest.find("XAddrs>") {
        rest = &rest[index + "XAddrs>".len()..];
        let Some(end) = rest.find('<') else {
            break;
        };
        for endpoint in rest[..end].split_whitespace() {
            if let Some(host) = host_from_wsd_endpoint(endpoint) {
                if !hosts.iter().any(|existing| existing == &host) {
                    hosts.push(host);
                }
            }
        }
        rest = &rest[end..];
    }
    hosts
}

#[cfg(target_os = "macos")]
fn nbns_lookup(host: &str, duration: Duration) -> Option<String> {
    use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.set_read_timeout(Some(duration)).ok()?;
    let request = nbns_node_status_request(0x4d59);
    socket
        .send_to(&request, SocketAddrV4::new(host.parse().ok()?, 137))
        .ok()?;
    let mut buffer = [0u8; 2048];
    let (size, _) = socket.recv_from(&mut buffer).ok()?;
    parse_nbns_response(&buffer[..size])
}

#[cfg(target_os = "macos")]
fn discover_wsd(duration: Duration) -> Vec<String> {
    use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

    let socket = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(socket) => socket,
        Err(_) => return Vec::new(),
    };
    let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));
    let _ = socket.set_multicast_ttl_v4(2);
    if socket
        .send_to(
            wsd_probe_message().as_bytes(),
            SocketAddrV4::new(Ipv4Addr::new(239, 255, 255, 250), 3702),
        )
        .is_err()
    {
        return Vec::new();
    }

    let mut hosts: Vec<String> = Vec::new();
    let mut buffer = [0u8; 8192];
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        match socket.recv_from(&mut buffer) {
            Ok((size, source)) => {
                let message = String::from_utf8_lossy(&buffer[..size]);
                // Only include Windows Computer endpoints, not printers/scanners.
                if !message.contains("pub:Computer") {
                    continue;
                }
                let mut candidates = parse_wsd_endpoints(&message);
                if candidates.is_empty() {
                    candidates.push(source.ip().to_string());
                }
                for host in candidates {
                    if !hosts.iter().any(|existing| existing == &host) {
                        hosts.push(host);
                    }
                }
            }
            Err(_) => continue,
        }
    }
    hosts
}

#[cfg(target_os = "macos")]
fn discover_netbios(duration: Duration) -> Vec<NetworkComputer> {
    use std::net::{Ipv4Addr, SocketAddrV4, UdpSocket};

    let socket = match UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)) {
        Ok(socket) => socket,
        Err(_) => return Vec::new(),
    };
    let _ = socket.set_broadcast(true);
    let _ = socket.set_read_timeout(Some(Duration::from_millis(250)));
    let request = nbns_node_status_request(0x4d58);
    if socket
        .send_to(&request, SocketAddrV4::new(Ipv4Addr::BROADCAST, 137))
        .is_err()
    {
        return Vec::new();
    }

    let mut computers: Vec<NetworkComputer> = Vec::new();
    let mut buffer = [0u8; 2048];
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        match socket.recv_from(&mut buffer) {
            Ok((size, source)) => {
                let Some(name) = parse_nbns_response(&buffer[..size]) else {
                    continue;
                };
                let ip = source.ip().to_string();
                if computers
                    .iter()
                    .any(|computer| computer.host.as_deref() == Some(ip.as_str()))
                {
                    continue;
                }
                let address = smb_address_for(&name, &ip);
                computers.push(NetworkComputer {
                    name,
                    host: Some(ip),
                    address: Some(address),
                });
            }
            Err(_) => continue,
        }
    }
    computers
}

#[cfg(not(target_os = "macos"))]
fn discover_netbios(_duration: Duration) -> Vec<NetworkComputer> {
    Vec::new()
}

#[cfg(target_os = "macos")]
pub fn discover_computers() -> Vec<NetworkComputer> {
    let mut command = Command::new("/usr/bin/dns-sd");
    command.args(["-B", "_smb._tcp", "local."]);
    let output = run_bounded(command, Duration::from_millis(2_500));
    let names = parse_instances(&output);
    let handles: Vec<_> = names
        .into_iter()
        .take(12)
        .map(|name| std::thread::spawn(move || resolve_instance(name)))
        .collect();
    let mut computers: Vec<NetworkComputer> = handles
        .into_iter()
        .filter_map(|handle| handle.join().ok())
        .collect();

    // Windows network discovery is not always advertised over Bonjour. Finder
    // uses WS-Discovery for Nearby Computers; ask the same endpoints and then
    // resolve each PC's NetBIOS name over unicast (broadcast is often blocked).
    let wsd_hosts = discover_wsd(Duration::from_millis(1_200));
    let wsd_handles: Vec<_> = wsd_hosts
        .into_iter()
        .take(16)
        .map(|host| {
            std::thread::spawn(move || {
                let name = nbns_lookup(&host, Duration::from_millis(700))
                    .unwrap_or_else(|| host.clone());
                let address = smb_address_for(&name, &host);
                NetworkComputer {
                    name,
                    host: Some(host),
                    address: Some(address),
                }
            })
        })
        .collect();
    for handle in wsd_handles {
        if let Ok(computer) = handle.join() {
            push_unique(&mut computers, computer);
        }
    }

    // Keep the broadcast probe as a fallback for PCs that answer NBNS but do
    // not implement WS-Discovery.
    for computer in discover_netbios(Duration::from_millis(800)) {
        push_unique(&mut computers, computer);
    }

    computers.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    computers
}

#[cfg(target_os = "macos")]
fn smb_address_for(name: &str, host: &str) -> String {
    let safe_name = !name.is_empty()
        && name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-' | '_'));
    let target = if safe_name { name } else { host };
    if target.contains(':') {
        format!("smb://[{target}]")
    } else {
        format!("smb://{target}")
    }
}

#[cfg(target_os = "macos")]
fn push_unique(computers: &mut Vec<NetworkComputer>, computer: NetworkComputer) {
    if computers.iter().any(|existing| {
        existing.name.eq_ignore_ascii_case(&computer.name) || existing.host == computer.host
    }) {
        return;
    }
    computers.push(computer);
}

#[cfg(not(target_os = "macos"))]
pub fn discover_computers() -> Vec<NetworkComputer> {
    Vec::new()
}

#[cfg(target_os = "macos")]
fn read_shares(
    host: &str,
    username: Option<&str>,
    password: Option<&str>,
    guest: bool,
) -> Vec<String> {
    let target = match (username, password) {
        (Some(user), Some(pass)) => format!("//{user}:{pass}@{host}"),
        (Some(user), None) => format!("//{user}@{host}"),
        _ => format!("//{host}"),
    };
    let mut command = Command::new("/usr/bin/smbutil");
    if guest {
        command.args(["view", "-g", &target]);
    } else {
        // -N never prompts on a terminal. With explicit credentials it simply
        // uses them; otherwise it only succeeds when the Keychain already has
        // credentials for this server (as Finder leaves behind after a login).
        command.args(["view", "-N", &target]);
    }
    let output = run_bounded(command, Duration::from_millis(6_000));
    let mut shares = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with("Share ")
            || trimmed.starts_with("---")
            || trimmed.contains("shares listed")
        {
            continue;
        }
        if let Some(name) = trimmed.split("  ").next().map(str::trim) {
            if name == "IPC$" || name.is_empty() {
                continue;
            }
            if !shares.iter().any(|existing| existing == name) {
                shares.push(name.to_string());
            }
        }
    }
    shares
}

#[cfg(not(target_os = "macos"))]
fn read_shares(
    _host: &str,
    _username: Option<&str>,
    _password: Option<&str>,
    _guest: bool,
) -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_smb_browse_instances_and_deduplicates() {
        let output = "\
Browsing for _smb._tcp.local.
Timestamp     A/R    Flags  if Domain               Service Type         Instance Name
 8:09:07.730  Add        3   1 local.               _smb._tcp.           Studio PC
 8:09:07.731  Add        3   1 local.               _smb._tcp.           Studio PC
 8:09:07.732  Add        2  14 local.               _smb._tcp.           NAS
";
        assert_eq!(parse_instances(output), vec!["Studio PC", "NAS"]);
    }

    #[test]
    fn parses_netbios_node_status_response() {
        let mut packet = Vec::new();
        packet.extend_from_slice(&[0x12, 0x34]); // transaction id
        packet.extend_from_slice(&[0x84, 0x00]); // response
        packet.extend_from_slice(&[0x00, 0x00]); // questions
        packet.extend_from_slice(&[0x00, 0x01]); // answers
        packet.extend_from_slice(&[0x00, 0x00]); // authority
        packet.extend_from_slice(&[0x00, 0x00]); // additional
        packet.extend_from_slice(&[0xc0, 0x0c]); // compressed name pointer
        packet.extend_from_slice(&[0x00, 0x21]); // NBSTAT
        packet.extend_from_slice(&[0x00, 0x01]); // IN
        packet.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // TTL
        packet.extend_from_slice(&[0x00, 0x25]); // RDLENGTH (1 + 2 * 18)
        packet.push(2); // two names

        let mut entry = vec![b' '; 16];
        entry[..6].copy_from_slice(b"RKM-HP");
        entry[15] = 0x00;
        packet.extend_from_slice(&entry);
        packet.extend_from_slice(&[0x04, 0x00]); // unique workstation

        let mut group = vec![b' '; 16];
        group[..8].copy_from_slice(b"WORKGROU");
        group[15] = 0x00;
        packet.extend_from_slice(&group);
        packet.extend_from_slice(&[0x84, 0x00]); // group flag

        assert_eq!(parse_nbns_response(&packet).as_deref(), Some("RKM-HP"));
    }

    #[test]
    fn parses_ws_discovery_computer_endpoints() {
        let message = r#"<wsd:Types>wsdp:Device pub:Computer</wsd:Types>
<wsd:XAddrs>http://192.168.0.155:5357/endpoint/ http://[fe80::1]:5357/endpoint/</wsd:XAddrs>"#;
        assert_eq!(
            parse_wsd_endpoints(message),
            vec!["192.168.0.155", "fe80::1"]
        );
    }

    #[test]
    fn splits_server_userinfo_from_share_addresses() {
        assert_eq!(
            split_server_address("smb://RKM-HP/RKM_MEDIA").unwrap(),
            ("RKM-HP".to_string(), None)
        );
        assert_eq!(
            split_server_address("smb://rajeev.mohanty@RKM-HP/RKM_MEDIA").unwrap(),
            (
                "RKM-HP".to_string(),
                Some("rajeev.mohanty".to_string())
            )
        );
        assert!(split_server_address("smb://").is_err());
        assert!(split_server_address("smb://host\\name/share").is_err());
    }
}

fn split_server_address(address: &str) -> Result<(String, Option<String>), AppError> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Err(AppError::invalid("Enter a server address."));
    }
    let authority = trimmed
        .split("://")
        .nth(1)
        .unwrap_or(trimmed)
        .split('/')
        .next()
        .unwrap_or("")
        .trim();
    if authority.is_empty() {
        return Err(AppError::invalid("Enter a server address."));
    }
    if authority
        .chars()
        .any(|character| character.is_control() || character == '"' || character == '\\')
    {
        return Err(AppError::invalid("The server address contains invalid characters."));
    }
    let (user, host) = match authority.rsplit_once('@') {
        Some((user, host)) => (Some(user.to_string()), host),
        None => (None, authority),
    };
    if host.is_empty() {
        return Err(AppError::invalid("Enter a server address."));
    }
    Ok((host.to_string(), user))
}

pub fn list_shares(
    address: &str,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<Vec<String>, AppError> {
    let (host, address_user) = split_server_address(address)?;
    let explicit_user = username
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(address_user);
    let explicit_password = password.filter(|value| !value.is_empty());

    let mut shares = if explicit_user.is_some() || explicit_password.is_some() {
        read_shares(
            &host,
            explicit_user.as_deref(),
            explicit_password,
            false,
        )
    } else {
        // First use the Keychain entry Finder would have created, then fall
        // back to guest access only when no credential is available.
        let saved = read_shares(&host, None, None, false);
        if saved.is_empty() {
            read_shares(&host, None, None, true)
        } else {
            saved
        }
    };

    if shares.is_empty() && (explicit_user.is_some() || explicit_password.is_some()) {
        return Err(AppError::new(
            "authentication_failed",
            "The server did not return any shares for those credentials. Check the username and password, or enter the share name directly.",
            Some(address.to_string()),
        ));
    }

    shares.sort_by(|left, right| left.to_lowercase().cmp(&right.to_lowercase()));
    Ok(shares)
}
