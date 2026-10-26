use hidapi::{HidApi, HidDevice};

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
