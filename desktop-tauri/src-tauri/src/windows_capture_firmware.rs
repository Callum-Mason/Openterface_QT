use hidapi::{HidApi, HidDevice};
use reqwest::redirect::Policy;
use std::time::Duration;

use crate::FirmwareUpdateCheck;

const FIRMWARE_INDEX_URL: &str =
    "https://assets.openterface.com/openterface/firmware/minikvm_latest_firmware2.txt";
const FIRMWARE_DIRECTORY_URL: &str = "https://assets.openterface.com/openterface/firmware/";
const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_FIRMWARE_BYTES: usize = 16 * 1024 * 1024;
const MAX_EEPROM_FIRMWARE_BYTES: usize = u16::MAX as usize + 1;

pub async fn check_for_update(
    chip: &str,
    current_version: &str,
) -> Result<(FirmwareUpdateCheck, Vec<u8>), String> {
    if !matches!(chip, "MS2109" | "MS2109S" | "MS2130S") {
        return Err(
            "Remote firmware updates are unavailable for this capture-chip mode".to_string(),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Could not prepare the firmware client: {error}"))?;

    let index_response = client
        .get(FIRMWARE_INDEX_URL)
        .header(
            reqwest::header::USER_AGENT,
            "OpenterfaceFirmwareChecker/1.0",
        )
        .send()
        .await
        .map_err(|error| format!("Could not reach the firmware index: {error}"))?;
    let index_bytes =
        read_limited_response(index_response, MAX_INDEX_BYTES, "firmware index").await?;
    let index = std::str::from_utf8(&index_bytes)
        .map_err(|_| "The firmware index is not valid UTF-8".to_string())?;
    let file_name = select_firmware_file(index, chip)?;

    let binary_url = format!("{FIRMWARE_DIRECTORY_URL}{file_name}");
    let binary_response = client
        .get(binary_url)
        .header(
            reqwest::header::USER_AGENT,
            "OpenterfaceFirmwareChecker/1.0",
        )
        .send()
        .await
        .map_err(|error| format!("Could not download the selected firmware package: {error}"))?;
    let bytes =
        read_limited_response(binary_response, MAX_FIRMWARE_BYTES, "firmware package").await?;
    if bytes.len() < 16 {
        return Err(
            "The selected firmware package is too short to contain a version header".to_string(),
        );
    }

    let latest_version = bytes[12..16]
        .iter()
        .map(|byte| format!("{byte:02}"))
        .collect::<String>();
    let current_key = version_key(current_version)
        .ok_or_else(|| "The capture device returned an invalid firmware version".to_string())?;
    let latest_key = version_key(&latest_version)
        .ok_or_else(|| "The selected firmware package contains an invalid version".to_string())?;

    let check = FirmwareUpdateCheck {
        chip: chip.to_string(),
        current_version: current_version.to_string(),
        latest_version,
        file_name,
        package_size_bytes: bytes.len(),
        update_available: latest_key > current_key,
    };
    Ok((check, bytes))
}

async fn read_limited_response(
    mut response: reqwest::Response,
    max_bytes: usize,
    description: &str,
) -> Result<Vec<u8>, String> {
    let status = response.status();
    if !status.is_success() {
        return Err(format!("The {description} request returned HTTP {status}"));
    }
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(format!("The {description} exceeds the size limit"));
    }

    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Could not read the {description}: {error}"))?
    {
        if body.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!("The {description} exceeds the size limit"));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn select_firmware_file(index: &str, chip: &str) -> Result<String, String> {
    let candidates = index
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let mut parts = line.split(',').map(str::trim);
            let version = parts.next()?;
            let (version, file_name) = match parts.next() {
                Some(file_name) => (version.to_string(), file_name.to_string()),
                None => ("0".to_string(), version.to_string()),
            };
            let chip_token = parts.next().unwrap_or("").to_ascii_lowercase();
            if !safe_firmware_file_name(&file_name) {
                return None;
            }
            Some((version, file_name, chip_token))
        })
        .collect::<Vec<_>>();

    let safe_candidates = candidates
        .iter()
        .filter(|(_, file_name, chip_token)| {
            !is_upgrade_image(file_name) && !is_upgrade_image(chip_token)
        })
        .collect::<Vec<_>>();
    let token_matches = safe_candidates
        .iter()
        .copied()
        .filter(|(_, _, chip_token)| token_matches_chip(chip_token, chip))
        .collect::<Vec<_>>();
    let chip_matches = if token_matches.is_empty() {
        safe_candidates
            .into_iter()
            .filter(|(_, file_name, _)| file_name_matches_chip(file_name, chip))
            .collect::<Vec<_>>()
    } else {
        token_matches
    };
    chip_matches
        .into_iter()
        .max_by_key(|(version, _, _)| version_key(version).unwrap_or(0))
        .map(|(_, file_name, _)| file_name.clone())
        .ok_or_else(|| {
            format!("No safe firmware package for {chip} was found in the firmware index")
        })
}

fn safe_firmware_file_name(file_name: &str) -> bool {
    !file_name.is_empty()
        && file_name.to_ascii_lowercase().ends_with(".bin")
        && !file_name.contains("..")
        && file_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn token_matches_chip(token: &str, chip: &str) -> bool {
    match chip {
        "MS2109" => token.contains("2109") && !token.contains('s'),
        "MS2109S" => token.contains("2109s") || (token.contains("2109") && token.contains('s')),
        "MS2130S" => token.contains("2130"),
        _ => false,
    }
}

fn file_name_matches_chip(file_name: &str, chip: &str) -> bool {
    let file_name = file_name.to_ascii_lowercase();
    match chip {
        "MS2109" => {
            file_name.contains("2109")
                && !file_name.contains("2109s")
                && !file_name.contains("2109_s")
        }
        "MS2109S" => file_name.contains("2109s") || file_name.contains("2109_s"),
        "MS2130S" => file_name.contains("2130"),
        _ => false,
    }
}

fn is_upgrade_image(value: &str) -> bool {
    let value = value.to_ascii_lowercase();
    ["upg", "upgrade", "boot", "loader", "hidonly", "tool", "ram"]
        .iter()
        .any(|marker| value.contains(marker))
}

fn version_key(version: &str) -> Option<u64> {
    let digits = version
        .chars()
        .filter(char::is_ascii_digit)
        .collect::<String>();
    (!digits.is_empty()).then(|| digits.parse().ok()).flatten()
}

pub fn write_capture_firmware(
    chip: &str,
    instance_ids: &[String],
    bytes: &[u8],
) -> Result<(), String> {
    if chip == "MS2130S" {
        return write_ms2130s_firmware(instance_ids, bytes);
    }
    if !matches!(chip, "MS2109" | "MS2109S") {
        return Err(format!(
            "Firmware writing for {chip} is not available in this Tauri release"
        ));
    }
    if bytes.len() < 16 || bytes.len() > MAX_EEPROM_FIRMWARE_BYTES {
        return Err("The firmware image size is outside the supported EEPROM range".to_string());
    }
    let declared_size = u16::from_be_bytes([bytes[2], bytes[3]]) as usize + 52;
    if declared_size > bytes.len() {
        return Err(
            "The firmware image header declares data beyond the end of the package".to_string(),
        );
    }

    let (vendor_id, product_id) = match chip {
        "MS2109" => (0x534d, 0x2109),
        "MS2109S" => (0x345f, 0x2109),
        _ => unreachable!(),
    };
    let api = HidApi::new()
        .map_err(|error| format!("Could not initialize Windows HID access: {error}"))?;
    let mut matches = api
        .device_list()
        .filter(|device| device.vendor_id() == vendor_id && device.product_id() == product_id)
        .filter(|device| {
            let path = device.path().to_string_lossy();
            instance_ids
                .iter()
                .any(|instance_id| hid_path_matches_instance(&path, instance_id))
        });
    let info = matches.next().ok_or_else(|| {
        "Windows could not match the capture-chip HID path to the selected controller".to_string()
    })?;
    if matches.next().is_some() {
        return Err("More than one capture-chip HID interface matched this controller".to_string());
    }
    let device = info
        .open_device(&api)
        .map_err(|error| format!("Could not open the capture-chip HID interface: {error}"))?;

    for (index, byte) in bytes.iter().copied().enumerate() {
        let address = u16::try_from(index)
            .map_err(|_| "The firmware image exceeds the EEPROM address space".to_string())?;
        let mut report = [0u8; 9];
        report[1] = 0xe6;
        report[2] = (address >> 8) as u8;
        report[3] = address as u8;
        report[4] = byte;
        let mut sent = false;
        let mut last_error = String::new();
        for attempt in 0..3 {
            match device.send_feature_report(&report) {
                Ok(()) => {
                    sent = true;
                    break;
                }
                Err(error) => {
                    last_error = error.to_string();
                    if attempt < 2 {
                        std::thread::sleep(Duration::from_millis(15));
                    }
                }
            }
        }
        if !sent {
            return Err(format!(
                "Firmware writing stopped at byte {index}: {last_error}"
            ));
        }
        if (index + 1) % 16 == 0 {
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    Ok(())
}

fn write_ms2130s_firmware(instance_ids: &[String], bytes: &[u8]) -> Result<(), String> {
    const SECTOR_SIZE: usize = 4096;
    const VERIFY_SIZE: usize = 4095;
    const MAX_BURST: usize = 60 * 1024;

    if bytes.len() < VERIFY_SIZE || bytes.len() > MAX_FIRMWARE_BYTES {
        return Err("The MS2130S firmware image is outside the supported flash range".to_string());
    }
    let declared_size = u16::from_be_bytes([bytes[2], bytes[3]]) as usize + 52;
    if declared_size > bytes.len() {
        return Err(
            "The firmware image header declares data beyond the end of the package".to_string(),
        );
    }

    let api = HidApi::new()
        .map_err(|error| format!("Could not initialize Windows HID access: {error}"))?;
    let mut matches = api
        .device_list()
        .filter(|device| device.vendor_id() == 0x345f && device.product_id() == 0x2132)
        .filter(|device| {
            let path = device.path().to_string_lossy();
            instance_ids
                .iter()
                .any(|instance_id| hid_path_matches_instance(&path, instance_id))
        });
    let info = matches.next().ok_or_else(|| {
        "Windows could not match the MS2130S HID path to the selected controller".to_string()
    })?;
    if matches.next().is_some() {
        return Err("More than one MS2130S HID interface matched this controller".to_string());
    }
    let device = info
        .open_device(&api)
        .map_err(|error| format!("Could not open the MS2130S HID interface: {error}"))?;

    let mode = detect_ms2130s_mode(&device)?;
    if mode == 1 {
        return Err(
            "MS2130S connection mode V1 is not supported by this firmware writer".to_string(),
        );
    }
    initialize_ms2130s_gpio(&device, mode)?;

    let mut size_report = [0u8; 9];
    size_report[0] = 1;
    size_report[1] = 0xf4;
    device
        .send_feature_report(&size_report)
        .map_err(|error| format!("Could not enter MS2130S flash mode: {error}"))?;
    let mut size_response = [0u8; 9];
    size_response[0] = 1;
    let size_response_len = device
        .get_feature_report(&mut size_response)
        .map_err(|error| format!("Could not read MS2130S flash capacity: {error}"))?;
    if size_response_len < 8 {
        return Err("The MS2130S flash capacity response was too short".to_string());
    }
    let flash_size = u32::from_be_bytes([
        size_response[4],
        size_response[5],
        size_response[6],
        size_response[7],
    ]) as usize;
    if flash_size == 0 || bytes.len() > flash_size {
        return Err(format!(
            "The firmware image ({} bytes) does not fit the detected MS2130S flash ({} bytes)",
            bytes.len(),
            flash_size
        ));
    }

    let sector_count = bytes.len().div_ceil(SECTOR_SIZE);
    for sector in 0..sector_count {
        let address = sector * SECTOR_SIZE;
        erase_ms2130s_sector(&device, address)?;
    }
    if sector_count <= 15 && 15 * SECTOR_SIZE < flash_size {
        erase_ms2130s_sector(&device, 15 * SECTOR_SIZE)?;
    }

    for (chunk_index, chunk) in bytes.chunks(MAX_BURST).enumerate() {
        let address = chunk_index * MAX_BURST;
        write_ms2130s_burst(&device, address, chunk)?;
    }
    std::thread::sleep(Duration::from_millis(100));
    let readback = read_ms2130s_burst(&device, 0, VERIFY_SIZE)?;
    if readback.as_slice() != &bytes[..VERIFY_SIZE] {
        return Err("MS2130S flash verification failed; power-cycle the device and inspect its firmware before retrying".to_string());
    }
    Ok(())
}

fn detect_ms2130s_mode(device: &HidDevice) -> Result<u8, String> {
    let mut probe = [0u8; 9];
    probe[1] = 0xb5;
    probe[2] = 0xff;
    probe[3] = 0x01;
    if device.send_feature_report(&probe).is_ok() {
        probe[1] = 0xfc;
        probe[2] = 0x01;
        if device.send_feature_report(&probe).is_ok() {
            std::thread::sleep(Duration::from_millis(100));
            probe[1] = 0xb5;
            probe[2] = 0xff;
            probe[3] = 0x01;
            if device.send_feature_report(&probe).is_ok() {
                let mut response = [0u8; 9];
                if device.get_feature_report(&mut response).is_ok() && response[4] == 0x13 {
                    return Ok(1);
                }
            }
        }
    }

    let mut probe = [0u8; 9];
    probe[0] = 1;
    probe[1] = 0xb5;
    probe[2] = 0xff;
    probe[3] = 0x01;
    device
        .send_feature_report(&probe)
        .map_err(|error| format!("Could not determine MS2130S connection mode: {error}"))?;
    let mut response = [0u8; 9];
    response[0] = 1;
    device
        .get_feature_report(&mut response)
        .map_err(|error| format!("Could not determine MS2130S connection mode: {error}"))?;
    Ok(if response[..4] == probe[..4] { 3 } else { 2 })
}

fn initialize_ms2130s_gpio(device: &HidDevice, mode: u8) -> Result<(), String> {
    let report_id = if mode == 1 { 0 } else { 1 };
    let read8_offset = if mode == 2 { 2 } else { 3 };
    let read16_offset = if mode == 2 { 3 } else { 4 };
    let write8 = |address: u8, value: u8| -> Result<(), String> {
        let mut report = [0u8; 9];
        report[0] = report_id;
        report[1] = 0xc6;
        report[2] = address;
        report[3] = value;
        device
            .send_feature_report(&report)
            .map(|_| ())
            .map_err(|error| {
                format!("Could not initialize MS2130S GPIO register 0x{address:02x}: {error}")
            })
    };
    let read8 = |address: u8| -> Result<u8, String> {
        let mut request = [0u8; 9];
        request[0] = report_id;
        request[1] = 0xc5;
        request[2] = address;
        device.send_feature_report(&request).map_err(|error| {
            format!("Could not read MS2130S GPIO register 0x{address:02x}: {error}")
        })?;
        let mut response = [0u8; 9];
        response[0] = report_id;
        device.get_feature_report(&mut response).map_err(|error| {
            format!("Could not read MS2130S GPIO register 0x{address:02x}: {error}")
        })?;
        Ok(response[read8_offset])
    };
    let write16 = |address: u16, value: u8| -> Result<(), String> {
        let mut report = [0u8; 9];
        report[0] = report_id;
        report[1] = 0xb6;
        report[2] = (address >> 8) as u8;
        report[3] = address as u8;
        report[4] = value;
        device
            .send_feature_report(&report)
            .map(|_| ())
            .map_err(|error| {
                format!("Could not initialize MS2130S GPIO register 0x{address:04x}: {error}")
            })
    };
    let read16 = |address: u16| -> Result<u8, String> {
        let mut request = [0u8; 9];
        request[0] = report_id;
        request[1] = 0xb5;
        request[2] = (address >> 8) as u8;
        request[3] = address as u8;
        device.send_feature_report(&request).map_err(|error| {
            format!("Could not read MS2130S GPIO register 0x{address:04x}: {error}")
        })?;
        let mut response = [0u8; 9];
        response[0] = report_id;
        device.get_feature_report(&mut response).map_err(|error| {
            format!("Could not read MS2130S GPIO register 0x{address:04x}: {error}")
        })?;
        Ok(response[read16_offset])
    };

    let b0 = read8(0xb0)?;
    write8(0xb0, b0 & !0x04)?;
    let a0 = read8(0xa0)?;
    write8(0xa0, a0 | 0x04)?;
    let _ = read8(0xc7);
    write8(0xc7, 0xd1)?;
    let _ = read8(0xc8);
    write8(0xc8, 0xc0)?;
    let _ = read8(0xca);
    write8(0xca, 0x00)?;
    let f01f = read16(0xf01f)?;
    write16(0xf01f, (f01f | 0x10) & !0x80)?;
    Ok(())
}

fn erase_ms2130s_sector(device: &HidDevice, address: usize) -> Result<(), String> {
    let address = u32::try_from(address)
        .map_err(|_| "The MS2130S flash address is out of range".to_string())?;
    let mut report = [0u8; 9];
    report[0] = 1;
    report[1] = 0xfb;
    report[2] = (address >> 16) as u8;
    report[3] = (address >> 8) as u8;
    report[4] = address as u8;
    device
        .send_feature_report(&report)
        .map(|_| ())
        .map_err(|error| format!("MS2130S sector erase failed at 0x{address:06x}: {error}"))
}

fn write_ms2130s_burst(device: &HidDevice, address: usize, bytes: &[u8]) -> Result<(), String> {
    let address = u32::try_from(address)
        .map_err(|_| "The MS2130S firmware address is out of range".to_string())?;
    let length = u16::try_from(bytes.len())
        .map_err(|_| "An MS2130S write burst exceeds the protocol limit".to_string())?;
    let mut start = [0u8; 9];
    start[0] = 1;
    start[1] = 0xe7;
    start[2] = (address >> 24) as u8;
    start[3] = (address >> 16) as u8;
    start[4] = (address >> 8) as u8;
    start[5] = address as u8;
    start[6] = (length >> 8) as u8;
    start[7] = length as u8;
    device.send_feature_report(&start).map_err(|error| {
        format!("Could not begin MS2130S flash write at 0x{address:08x}: {error}")
    })?;

    for chunk in bytes.chunks(4095) {
        let mut packet = vec![0u8; 4096];
        packet[0] = 0x03;
        packet[1..1 + chunk.len()].copy_from_slice(chunk);
        device
            .send_feature_report(&packet)
            .map_err(|error| format!("MS2130S flash write failed at 0x{address:08x}: {error}"))?;
    }
    Ok(())
}

fn read_ms2130s_burst(
    device: &HidDevice,
    address: usize,
    length: usize,
) -> Result<Vec<u8>, String> {
    let address = u32::try_from(address)
        .map_err(|_| "The MS2130S firmware address is out of range".to_string())?;
    let length = u16::try_from(length)
        .map_err(|_| "An MS2130S read burst exceeds the protocol limit".to_string())?;
    let mut start = [0u8; 9];
    start[0] = 1;
    start[1] = 0xe7;
    start[2] = (address >> 24) as u8;
    start[3] = (address >> 16) as u8;
    start[4] = (address >> 8) as u8;
    start[5] = address as u8;
    start[6] = (length >> 8) as u8;
    start[7] = length as u8;
    device
        .send_feature_report(&start)
        .map_err(|error| format!("Could not begin MS2130S flash verification: {error}"))?;
    let mut packet = vec![0u8; 4096];
    packet[0] = 0x03;
    device
        .get_feature_report(&mut packet)
        .map_err(|error| format!("Could not read back MS2130S flash: {error}"))?;
    Ok(packet[1..1 + length as usize].to_vec())
}

pub fn read_eeprom_firmware(chip: &str, instance_ids: &[String]) -> Result<Vec<u8>, String> {
    if !matches!(chip, "MS2109" | "MS2109S") {
        return Err(format!(
            "Firmware backup for {chip} is not available in this Tauri release"
        ));
    }
    let (vendor_id, product_id) = match chip {
        "MS2109" => (0x534d, 0x2109),
        "MS2109S" => (0x345f, 0x2109),
        _ => unreachable!(),
    };
    let api = HidApi::new()
        .map_err(|error| format!("Could not initialize Windows HID access: {error}"))?;
    let mut matches = api
        .device_list()
        .filter(|device| device.vendor_id() == vendor_id && device.product_id() == product_id)
        .filter(|device| {
            let path = device.path().to_string_lossy();
            instance_ids
                .iter()
                .any(|instance_id| hid_path_matches_instance(&path, instance_id))
        });
    let info = matches.next().ok_or_else(|| {
        "Windows could not match the capture-chip HID path to the selected controller".to_string()
    })?;
    if matches.next().is_some() {
        return Err("More than one capture-chip HID interface matched this controller".to_string());
    }
    let device = info
        .open_device(&api)
        .map_err(|error| format!("Could not open the capture-chip HID interface: {error}"))?;

    let mut header = Vec::with_capacity(4);
    for address in 0..4 {
        header.push(read_eeprom_byte(&device, address)?);
    }
    let size = u16::from_be_bytes([header[2], header[3]]) as usize + 52;
    if !(52..=MAX_EEPROM_FIRMWARE_BYTES).contains(&size) {
        return Err("The capture firmware header declares an unsupported image size".to_string());
    }

    let mut firmware = Vec::with_capacity(size);
    for address in 0..size {
        firmware.push(read_eeprom_byte(&device, address)?);
        std::thread::sleep(Duration::from_millis(5));
    }
    Ok(firmware)
}

fn read_eeprom_byte(device: &HidDevice, address: usize) -> Result<u8, String> {
    let address = u16::try_from(address)
        .map_err(|_| "The firmware image exceeds the EEPROM address space".to_string())?;
    let mut request = [0u8; 9];
    request[1] = 0xe5;
    request[2] = (address >> 8) as u8;
    request[3] = address as u8;

    let mut last_error = "the HID device rejected the read report".to_string();
    for attempt in 0..3 {
        match device.send_feature_report(&request) {
            Ok(_) => {
                let mut response = [0u8; 9];
                match device.get_feature_report(&mut response) {
                    Ok(length) if length > 4 => return Ok(response[4]),
                    Ok(_) => last_error = "the HID response was shorter than expected".to_string(),
                    Err(error) => last_error = error.to_string(),
                }
            }
            Err(error) => last_error = error.to_string(),
        }
        if attempt < 2 {
            std::thread::sleep(Duration::from_millis(15));
        }
    }
    Err(format!(
        "Could not read EEPROM byte at 0x{address:04x}: {last_error}"
    ))
}

pub fn read_version(chip: &str, instance_ids: &[String]) -> Result<String, String> {
    let (vendor_id, product_id, report_attempts, addresses) = match chip {
        "MS2109" => (0x534d, 0x2109, &[(0, 9)][..], 0xcbdc),
        "MS2109S" => (0x345f, 0x2109, &[(0, 11), (1, 11), (0, 65)][..], 0xcbdc),
        "MS2130S" => (0x345f, 0x2132, &[(1, 11), (0, 11), (0, 65)][..], 0x1fdc),
        "MS2130S recovery" => {
            return Err("The capture chip is in recovery mode; firmware recovery is not available in this Tauri release".to_string());
        }
        _ => {
            return Err(
                "The associated capture-chip family is not supported for firmware reads"
                    .to_string(),
            )
        }
    };

    let api = HidApi::new()
        .map_err(|error| format!("Could not initialize Windows HID access: {error}"))?;
    let mut matches = api
        .device_list()
        .filter(|device| device.vendor_id() == vendor_id && device.product_id() == product_id)
        .filter(|device| {
            let path = device.path().to_string_lossy();
            instance_ids
                .iter()
                .any(|instance_id| hid_path_matches_instance(&path, instance_id))
        });
    let info = matches.next().ok_or_else(|| {
        "Windows could not match the capture-chip HID path to the selected controller".to_string()
    })?;
    if matches.next().is_some() {
        return Err("More than one capture-chip HID interface matched this controller".to_string());
    }
    let device = info
        .open_device(&api)
        .map_err(|error| format!("Could not open the capture-chip HID interface: {error}"))?;

    let mut version = [0u8; 4];
    for (index, address) in (addresses..addresses + 4).enumerate() {
        version[index] = read_register(&device, address, report_attempts).map_err(|error| {
            format!(
                "Could not read capture firmware version byte {}: {error}",
                index + 1
            )
        })?;
    }
    Ok(version.iter().map(|byte| format!("{byte:02}")).collect())
}

fn hid_path_matches_instance(path: &str, instance_id: &str) -> bool {
    fn normalize(value: &str) -> String {
        let lower = value.to_ascii_lowercase();
        let without_prefix = lower.strip_prefix(r"\\?\").unwrap_or(&lower);
        let separators = without_prefix.replace('\\', "#");
        let without_hid_class = separators.strip_prefix("hid#").unwrap_or(&separators);
        without_hid_class
            .split("#{")
            .next()
            .unwrap_or(without_hid_class)
            .to_string()
    }

    normalize(path) == normalize(instance_id)
}

fn read_register(
    device: &HidDevice,
    address: u16,
    report_attempts: &[(u8, usize)],
) -> Result<u8, String> {
    let mut last_error = "the HID device did not accept a supported feature report".to_string();
    for &(report_id, report_length) in report_attempts {
        let mut request = vec![0u8; report_length];
        request[0] = report_id;
        request[1] = 0xb5;
        request[2] = (address >> 8) as u8;
        request[3] = address as u8;
        if let Err(error) = device.send_feature_report(&request) {
            last_error = error.to_string();
            continue;
        }

        let mut response = vec![0u8; report_length];
        response[0] = report_id;
        match device.get_feature_report(&mut response) {
            Ok(length) if length > 4 => return Ok(response[4]),
            Ok(_) => last_error = "the HID feature report was shorter than expected".to_string(),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(last_error)
}

pub fn set_usb_route(chip: &str, instance_ids: &[String], to_target: bool) -> Result<(), String> {
    if chip != "MS2109" {
        return Err(format!(
            "The {chip} capture chip does not support CH9329 USB route switching"
        ));
    }

    let api = HidApi::new()
        .map_err(|error| format!("Could not initialize Windows HID access: {error}"))?;
    let mut matches = api
        .device_list()
        .filter(|device| device.vendor_id() == 0x534d && device.product_id() == 0x2109)
        .filter(|device| {
            let path = device.path().to_string_lossy();
            instance_ids
                .iter()
                .any(|instance_id| hid_path_matches_instance(&path, instance_id))
        });
    let info = matches.next().ok_or_else(|| {
        "Windows could not match the capture-chip HID path to the selected controller".to_string()
    })?;
    if matches.next().is_some() {
        return Err("More than one capture-chip HID interface matched this controller".to_string());
    }
    let device = info
        .open_device(&api)
        .map_err(|error| format!("Could not open the capture-chip HID interface: {error}"))?;

    let version = (0xcbdc..=0xcbdf)
        .filter_map(|address| read_register(&device, address, &[(0, 9)]).ok())
        .map(|byte| format!("{byte:02}"))
        .collect::<String>();
    let route_bit = if version.len() == 8 && version.as_str() >= "24081309" {
        0x01
    } else {
        // Older MS2109 firmware stores the switch state in bit 4.
        0x10
    };

    let current = read_register(&device, 0xdf01, &[(0, 9)])?;
    let mut updated = current & !0x11;
    if to_target {
        updated |= route_bit;
    }

    let mut report = [0u8; 9];
    report[1] = 0xb6;
    report[2] = 0xdf;
    report[3] = 0x01;
    report[4] = updated;
    device
        .send_feature_report(&report)
        .map_err(|error| format!("Could not write the capture-chip USB route: {error}"))?;

    let actual = read_register(&device, 0xdf01, &[(0, 9)])?;
    if actual != updated {
        return Err(format!(
            "The capture-chip USB route did not verify (wanted 0x{updated:02x}, read 0x{actual:02x})"
        ));
    }
    Ok(())
}
