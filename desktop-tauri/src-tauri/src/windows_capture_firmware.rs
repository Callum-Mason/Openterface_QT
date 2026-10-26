use hidapi::{HidApi, HidDevice};
use reqwest::redirect::Policy;
use std::time::Duration;

use crate::FirmwareUpdateCheck;

const FIRMWARE_INDEX_URL: &str =
    "https://assets.openterface.com/openterface/firmware/minikvm_latest_firmware2.txt";
const FIRMWARE_DIRECTORY_URL: &str = "https://assets.openterface.com/openterface/firmware/";
const MAX_INDEX_BYTES: usize = 1024 * 1024;
const MAX_FIRMWARE_BYTES: usize = 16 * 1024 * 1024;

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
