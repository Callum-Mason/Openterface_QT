use serde::{Deserialize, Serialize};
use serialport::SerialPort;
#[cfg(not(windows))]
use serialport::SerialPortType;
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::Emitter;
use tauri::{Manager, State};

const MAX_PASTE_CHARACTERS: usize = 12_000;

const KEYBOARD_LAYOUTS: &[(&str, &str)] = &[
    (
        "azerty_be",
        include_str!("../../../config/keyboards/azerty_be.json"),
    ),
    (
        "azerty_ch_fr",
        include_str!("../../../config/keyboards/azerty_ch_fr.json"),
    ),
    (
        "azerty_fr",
        include_str!("../../../config/keyboards/azerty_fr.json"),
    ),
    (
        "japanese",
        include_str!("../../../config/keyboards/japanese.json"),
    ),
    (
        "qwerty_dk",
        include_str!("../../../config/keyboards/qwerty_dk.json"),
    ),
    (
        "qwerty_es",
        include_str!("../../../config/keyboards/qwerty_es.json"),
    ),
    (
        "qwerty_fi",
        include_str!("../../../config/keyboards/qwerty_fi.json"),
    ),
    (
        "qwerty_it",
        include_str!("../../../config/keyboards/qwerty_it.json"),
    ),
    (
        "qwerty_no",
        include_str!("../../../config/keyboards/qwerty_no.json"),
    ),
    (
        "qwerty_se",
        include_str!("../../../config/keyboards/qwerty_se.json"),
    ),
    (
        "qwerty_uk",
        include_str!("../../../config/keyboards/qwerty_uk.json"),
    ),
    (
        "qwerty_us",
        include_str!("../../../config/keyboards/qwerty_us.json"),
    ),
    (
        "qwertz_ch",
        include_str!("../../../config/keyboards/qwertz_ch.json"),
    ),
    (
        "qwertz_de",
        include_str!("../../../config/keyboards/qwertz_de.json"),
    ),
];

#[cfg(windows)]
mod windows_capture_firmware;
#[cfg(windows)]
mod windows_devices;
#[cfg(windows)]
mod windows_keys;
#[cfg(windows)]
mod windows_power;

struct AppState {
    serial: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    connection_id: Arc<AtomicU64>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ControllerStatus {
    target_connected: bool,
    num_lock: bool,
    caps_lock: bool,
    scroll_lock: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KvmDevice {
    port_name: String,
    manufacturer: Option<String>,
    product: Option<String>,
    serial_number: Option<String>,
    vendor_id: Option<u16>,
    product_id: Option<u16>,
    controller: Option<&'static str>,
    generation: Option<&'static str>,
    capture_chip: Option<&'static str>,
    camera_name: Option<String>,
    has_hid: bool,
    has_camera: bool,
    has_audio: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct AppPreferences {
    language: String,
    preferred_controller_port: String,
    preferred_video_device: String,
    preferred_audio_device: String,
    audio_volume: u8,
    include_audio_in_recordings: bool,
    recording_video_bitrate: u32,
    recording_audio_bitrate: u32,
    recording_audio_sample_rate: u32,
    recording_output_path: String,
    capture_quality: String,
    capture_system_shortcuts: bool,
    inhibit_screen_saver: bool,
    controller_mode: u8,
    mouse_mode: String,
    mouse_auto_hide: bool,
    keyboard_layout: String,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            preferred_controller_port: String::new(),
            preferred_video_device: String::new(),
            preferred_audio_device: String::new(),
            audio_volume: 80,
            include_audio_in_recordings: false,
            recording_video_bitrate: 8_000_000,
            recording_audio_bitrate: 128_000,
            recording_audio_sample_rate: 44_100,
            recording_output_path: String::new(),
            capture_quality: "1080p60".to_string(),
            capture_system_shortcuts: false,
            inhibit_screen_saver: false,
            controller_mode: 2,
            mouse_mode: "absolute".to_string(),
            mouse_auto_hide: true,
            keyboard_layout: "qwerty_us".to_string(),
        }
    }
}

fn preferences_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not locate the app settings folder: {error}"))?;
    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("Could not create the app settings folder: {error}"))?;
    Ok(config_dir.join("preferences.json"))
}

#[tauri::command]
fn load_preferences(app: tauri::AppHandle) -> Result<Option<AppPreferences>, String> {
    let path = preferences_path(&app)?;
    match fs::read(path) {
        Ok(contents) => serde_json::from_slice(&contents)
            .map(Some)
            .map_err(|error| format!("Could not read saved preferences: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read saved preferences: {error}")),
    }
}

#[tauri::command]
fn save_preferences(preferences: AppPreferences, app: tauri::AppHandle) -> Result<(), String> {
    if preferences.preferred_controller_port.len() > 128
        || !matches!(
            preferences.language.as_str(),
            "en" | "fr"
                | "de"
                | "da"
                | "ja"
                | "se"
                | "zh"
                | "es"
                | "it"
                | "ko"
                | "pt"
                | "ro"
                | "ru"
        )
        || preferences.preferred_video_device.len() > 512
        || preferences.preferred_audio_device.len() > 512
        || preferences.recording_output_path.len() > 2048
        || preferences.audio_volume > 100
        || !(500_000..=20_000_000).contains(&preferences.recording_video_bitrate)
        || !(32_000..=512_000).contains(&preferences.recording_audio_bitrate)
        || !matches!(
            preferences.recording_audio_sample_rate,
            22_050 | 44_100 | 48_000 | 96_000
        )
        || preferences.controller_mode > 3
        || !matches!(preferences.mouse_mode.as_str(), "absolute" | "relative")
        || !KEYBOARD_LAYOUTS
            .iter()
            .any(|(id, _)| *id == preferences.keyboard_layout)
        || !matches!(
            preferences.capture_quality.as_str(),
            "720p30" | "1080p30" | "1080p60"
        )
    {
        return Err("The supplied preferences are invalid".to_string());
    }

    let path = preferences_path(&app)?;
    let temporary_path = path.with_extension("json.tmp");
    let contents = serde_json::to_vec_pretty(&preferences)
        .map_err(|error| format!("Could not encode app preferences: {error}"))?;
    fs::write(&temporary_path, contents)
        .map_err(|error| format!("Could not save app preferences: {error}"))?;
    fs::rename(&temporary_path, &path)
        .map_err(|error| format!("Could not update app preferences: {error}"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyboardLayoutInfo {
    id: &'static str,
    name: String,
}

#[derive(Debug, Deserialize)]
struct KeyboardLayout {
    name: String,
    key_map: std::collections::HashMap<String, String>,
    char_mapping: std::collections::HashMap<String, String>,
    #[serde(default)]
    need_shift_keys: Vec<String>,
    #[serde(default)]
    need_altgr_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PasteResult {
    sent: usize,
    skipped: usize,
}

#[tauri::command]
fn list_keyboard_layouts() -> Result<Vec<KeyboardLayoutInfo>, String> {
    KEYBOARD_LAYOUTS
        .iter()
        .map(|(id, contents)| {
            let layout: KeyboardLayout = serde_json::from_str(contents)
                .map_err(|error| format!("Could not load keyboard layout {id}: {error}"))?;
            Ok(KeyboardLayoutInfo {
                id,
                name: layout.name,
            })
        })
        .collect()
}

#[cfg(windows)]
fn read_clipboard_text() -> Result<String, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    unsafe {
        if OpenClipboard(null_mut()) == 0 {
            return Err("Windows could not open the clipboard".to_string());
        }
        let result = (|| {
            let handle = GetClipboardData(13);
            if handle.is_null() {
                return Err("The clipboard does not contain text".to_string());
            }
            let byte_len = GlobalSize(handle);
            let pointer = GlobalLock(handle) as *const u16;
            if pointer.is_null() {
                return Err("Windows could not read clipboard text".to_string());
            }
            let max_units = (byte_len / std::mem::size_of::<u16>()).min(MAX_PASTE_CHARACTERS + 1);
            let units = std::slice::from_raw_parts(pointer, max_units);
            let end = units
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(units.len());
            let text = String::from_utf16_lossy(&units[..end]);
            let _ = GlobalUnlock(handle);
            if text.chars().count() > MAX_PASTE_CHARACTERS {
                return Err(format!("Clipboard text is longer than the {MAX_PASTE_CHARACTERS}-character paste limit"));
            }
            Ok(text)
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(not(windows))]
fn read_clipboard_text() -> Result<String, String> {
    Err("Clipboard paste is currently available in Windows builds only".to_string())
}

#[tauri::command]
fn paste_clipboard_to_target(
    layout_id: String,
    state: State<'_, AppState>,
) -> Result<PasteResult, String> {
    let contents = read_clipboard_text()?;
    if contents.is_empty() {
        return Err("The clipboard is empty".to_string());
    }
    let (_, layout_json) = KEYBOARD_LAYOUTS
        .iter()
        .find(|(id, _)| *id == layout_id)
        .ok_or_else(|| "Choose a supported keyboard layout before pasting".to_string())?;
    let layout: KeyboardLayout = serde_json::from_str(layout_json)
        .map_err(|error| format!("Could not load keyboard layout: {error}"))?;
    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let port = serial
        .as_mut()
        .ok_or_else(|| "Connect an Openterface controller before pasting".to_string())?;

    std::thread::sleep(Duration::from_millis(50));
    let mut sent = 0;
    let mut skipped = 0;
    for character in contents.chars() {
        let char_key = character.to_string();
        let Some(key_name) = layout.char_mapping.get(&char_key) else {
            skipped += 1;
            continue;
        };
        let Some(usage_text) = layout.key_map.get(key_name) else {
            skipped += 1;
            continue;
        };
        let usage = u8::from_str_radix(usage_text.trim_start_matches("0x"), 16).map_err(|_| {
            format!("Keyboard layout contains an invalid key code for {character:?}")
        })?;
        let modifiers = if layout.need_altgr_keys.contains(&char_key) {
            0x40
        } else if character.is_uppercase() || layout.need_shift_keys.contains(&char_key) {
            0x02
        } else {
            0x00
        };
        let mut press = vec![0x57, 0xab, 0x00, 0x02, 0x08, modifiers, 0x00, usage];
        press.resize(13, 0);
        write_port_command(port.as_mut(), press)
            .map_err(|error| format!("Could not send clipboard text to the target: {error}"))?;
        std::thread::sleep(Duration::from_millis(3));
        write_port_command(
            port.as_mut(),
            vec![0x57, 0xab, 0x00, 0x02, 0x08, 0, 0, 0, 0, 0, 0, 0, 0],
        )
        .map_err(|error| format!("Could not release a pasted key: {error}"))?;
        sent += 1;
    }
    Ok(PasteResult { sent, skipped })
}

#[tauri::command]
fn set_screen_saver_inhibited(inhibited: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_power::set_inhibited(inhibited);
    }
    #[cfg(not(windows))]
    {
        let _ = inhibited;
        Err("Screen-saver control is available in Windows builds only".to_string())
    }
}

#[tauri::command]
fn open_external_link(destination: String) -> Result<(), String> {
    let url = match destination.as_str() {
        "website" => "https://openterface.com/",
        "purchase" => "https://www.crowdsupply.com/techxartisan/openterface-mini-kvm",
        "feedback" => "https://forms.gle/KNQPTNfXCPUPybgG9",
        "releases" => "https://github.com/TechxArtisanStudio/Openterface_QT/releases",
        _ => return Err("That external destination is not available".to_string()),
    };

    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;

        let operation: Vec<u16> = "open".encode_utf16().chain(std::iter::once(0)).collect();
        let target: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                operation.as_ptr(),
                target.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err("Windows could not open the external link".to_string());
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Opening external links is currently supported in Windows builds only".to_string())
    }
}

#[tauri::command]
fn list_devices() -> Result<Vec<KvmDevice>, String> {
    let ports = serialport::available_ports().map_err(|error| error.to_string())?;

    #[cfg(windows)]
    {
        return Ok(windows_devices::discover(&ports));
    }

    #[cfg(not(windows))]
    Ok(ports
        .into_iter()
        .map(|port| {
            let (manufacturer, product, serial_number, vendor_id, product_id) = match port.port_type
            {
                SerialPortType::UsbPort(info) => (
                    info.manufacturer,
                    info.product,
                    info.serial_number,
                    Some(info.vid),
                    Some(info.pid),
                ),
                _ => (None, None, None, None, None),
            };

            let controller = match (vendor_id, product_id) {
                (Some(0x1a86), Some(0x7523)) => Some("CH9329"),
                (Some(0x1a86), Some(0xfe0c)) => Some("CH32V208"),
                _ => None,
            };

            KvmDevice {
                port_name: port.port_name,
                manufacturer,
                product,
                serial_number,
                vendor_id,
                product_id,
                controller,
                generation: None,
                capture_chip: None,
                camera_name: None,
                has_hid: false,
                has_camera: false,
                has_audio: false,
            }
        })
        .filter(|device| device.controller.is_some())
        .collect())
}

#[tauri::command]
fn read_capture_firmware_version(port_name: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let device = list_devices()?
            .into_iter()
            .find(|device| device.port_name.eq_ignore_ascii_case(&port_name))
            .ok_or_else(|| "The selected controller is no longer available".to_string())?;
        let chip = device.capture_chip.ok_or_else(|| {
            "Windows could not identify the capture-chip family for this controller".to_string()
        })?;
        let hid_instance_ids = windows_devices::capture_hid_instance_ids(&port_name)?;
        return windows_capture_firmware::read_version(chip, &hid_instance_ids);
    }
    #[cfg(not(windows))]
    {
        let _ = port_name;
        Err("Capture firmware reads are available in Windows builds only".to_string())
    }
}

#[tauri::command]
fn connect_device(
    port_name: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let devices = list_devices()?;
    let device = devices
        .iter()
        .find(|device| device.port_name == port_name)
        .ok_or_else(|| format!("Serial device {port_name} is no longer available"))?;
    let baud_rates: &[u32] = if device.controller == Some("CH32V208") {
        &[115_200]
    } else {
        &[9_600, 115_200]
    };
    let mut connected_port = None;
    let mut last_error = None;
    for baud_rate in baud_rates {
        let mut port = match serialport::new(&port_name, *baud_rate)
            .timeout(std::time::Duration::from_millis(100))
            .open()
        {
            Ok(port) => port,
            Err(error) => {
                last_error = Some(format!(
                    "Could not open {port_name} at {baud_rate} baud: {error}"
                ));
                continue;
            }
        };
        match probe_controller(&mut *port, device.controller == Some("CH32V208")) {
            Ok(()) => {
                connected_port = Some((port, *baud_rate));
                break;
            }
            Err(error) => last_error = Some(format!("{port_name} at {baud_rate} baud: {error}")),
        }
    }
    let (mut port, baud_rate) = connected_port
        .ok_or_else(|| last_error.unwrap_or_else(|| format!("Could not connect to {port_name}")))?;
    port.set_timeout(Duration::from_millis(10))
        .map_err(|error| format!("Could not configure controller response polling: {error}"))?;

    let connection_id = state.connection_id.fetch_add(1, Ordering::SeqCst) + 1;
    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    *serial = Some(port);
    drop(serial);
    if let Err(error) = spawn_controller_reader(
        state.serial.clone(),
        state.connection_id.clone(),
        connection_id,
        app,
    ) {
        state.connection_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut serial) = state.serial.lock() {
            *serial = None;
        }
        return Err(error);
    }
    Ok(format!("Connected to {port_name} at {baud_rate} baud"))
}

fn read_controller_response(
    port: &mut dyn SerialPort,
    command: u8,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let deadline = Instant::now() + timeout;
    let mut response = Vec::with_capacity(64);
    while Instant::now() < deadline {
        let mut chunk = [0u8; 64];
        match port.read(&mut chunk) {
            Ok(0) => continue,
            Ok(count) => {
                response.extend_from_slice(&chunk[..count]);
                for start in 0..response.len().saturating_sub(5) {
                    if response[start] != 0x57 || response[start + 1] != 0xab {
                        continue;
                    }
                    if response[start + 3] != command && response[start + 3] != (command | 0x80) {
                        continue;
                    }
                    let end = start + response[start + 4] as usize + 6;
                    if end <= response.len() {
                        return Ok(response[start..end].to_vec());
                    }
                }
                if response.len() > 512 {
                    return Err("The controller returned an invalid response".to_string());
                }
            }
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                ) => {}
            Err(error) => return Err(format!("Could not read the controller response: {error}")),
        }
    }
    Err(format!(
        "The controller did not acknowledge command 0x{command:02x}"
    ))
}

fn restart_controller_reader(state: &AppState, app: tauri::AppHandle) -> Result<(), String> {
    let reader_id = state.connection_id.fetch_add(1, Ordering::SeqCst) + 1;
    spawn_controller_reader(
        state.serial.clone(),
        state.connection_id.clone(),
        reader_id,
        app,
    )
}

#[tauri::command]
fn apply_controller_mode(
    port_name: String,
    mode: u8,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    if mode > 3 {
        return Err("Choose a supported controller mode".to_string());
    }
    let device = list_devices()?
        .into_iter()
        .find(|device| device.port_name == port_name)
        .ok_or_else(|| format!("Controller {port_name} is no longer available"))?;
    if device.controller != Some("CH9329") {
        return Err("Operating mode changes are supported on CH9329 controllers only".to_string());
    }

    state.connection_id.fetch_add(1, Ordering::SeqCst);
    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let Some(port) = serial.as_mut() else {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err("Connect the CH9329 controller before changing its mode".to_string());
    };
    if port.name().as_deref() != Some(port_name.as_str()) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(
            "The connected controller changed; reconnect before changing its mode".to_string(),
        );
    }
    let baud_rate = match port.baud_rate() {
        Ok(baud_rate) => baud_rate,
        Err(error) => {
            drop(serial);
            let _ = restart_controller_reader(&state, app);
            return Err(format!("Could not read the controller baud rate: {error}"));
        }
    };
    if !matches!(baud_rate, 9_600 | 115_200) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(format!(
            "CH9329 configuration is unsupported at {baud_rate} baud"
        ));
    }
    if let Err(error) = send_controller_command(port.as_mut(), 0x08, &[]) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(format!(
            "Could not read the current controller configuration: {error}"
        ));
    }
    let current_configuration =
        match read_controller_response(port.as_mut(), 0x08, Duration::from_secs(2)) {
            Ok(configuration) => configuration,
            Err(error) => {
                drop(serial);
                let _ = restart_controller_reader(&state, app);
                return Err(error);
            }
        };
    if current_configuration.len() < 56
        || current_configuration[4] != 0x32
        || !matches!(current_configuration[3], 0x08 | 0x88)
    {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err("The controller returned an incomplete configuration".to_string());
    }
    let mut configuration = current_configuration[..55].to_vec();
    configuration[3] = 0x09;
    configuration[5] = mode;
    if let Err(error) = write_port_command(port.as_mut(), configuration) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(format!(
            "Could not send the controller mode configuration: {error}"
        ));
    }
    if let Err(error) = port.flush() {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(format!(
            "Could not flush the controller mode configuration: {error}"
        ));
    }
    let response = match read_controller_response(port.as_mut(), 0x09, Duration::from_secs(2)) {
        Ok(response) => response,
        Err(error) => {
            drop(serial);
            let _ = restart_controller_reader(&state, app);
            return Err(error);
        }
    };
    if response.get(5) != Some(&0x00) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err("The controller rejected the requested operating mode".to_string());
    }
    if let Err(error) = port.write_request_to_send(true) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err(format!("Could not start the controller reset: {error}"));
    }
    std::thread::sleep(Duration::from_secs(4));
    let reset_release = port.write_request_to_send(false);
    std::thread::sleep(Duration::from_millis(500));
    let old_port = serial.take();
    drop(serial);
    drop(old_port);
    reset_release.map_err(|error| format!("Could not release the controller reset: {error}"))?;
    std::thread::sleep(Duration::from_secs(2));

    let mut last_error = None;
    for attempt in 0..5 {
        match serialport::new(&port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
        {
            Ok(mut reopened) => match probe_controller(&mut *reopened, false) {
                Ok(()) => {
                    reopened
                        .set_timeout(Duration::from_millis(10))
                        .map_err(|error| {
                            format!("Could not configure controller polling: {error}")
                        })?;
                    let mut serial = state
                        .serial
                        .lock()
                        .map_err(|_| "Serial connection state is unavailable".to_string())?;
                    *serial = Some(reopened);
                    drop(serial);
                    restart_controller_reader(&state, app)?;
                    return Ok(format!("Controller restarted in mode {mode}"));
                }
                Err(error) => last_error = Some(error),
            },
            Err(error) => last_error = Some(format!("Could not reopen {port_name}: {error}")),
        }
        if attempt < 4 {
            std::thread::sleep(Duration::from_millis(500));
        }
    }
    Err(last_error
        .unwrap_or_else(|| "The controller did not reconnect after the mode change".to_string()))
}

#[tauri::command]
fn apply_baud_rate(
    port_name: String,
    baud_rate: u32,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    if !matches!(baud_rate, 9_600 | 115_200) {
        return Err("Choose 9600 or 115200 baud".to_string());
    }

    let device = list_devices()?
        .into_iter()
        .find(|device| device.port_name == port_name)
        .ok_or_else(|| format!("Controller {port_name} is no longer available"))?;
    if device.controller == Some("CH32V208") && baud_rate != 115_200 {
        return Err("CH32V208 controllers only support 115200 baud".to_string());
    }
    if device.controller != Some("CH9329") && device.controller != Some("CH32V208") {
        return Err("This controller does not support baud-rate changes".to_string());
    }

    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let Some(port) = serial.as_mut() else {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err("Connect the controller before changing its baud rate".to_string());
    };
    if port.name().as_deref() != Some(port_name.as_str()) {
        drop(serial);
        let _ = restart_controller_reader(&state, app);
        return Err("The connected controller changed; reconnect before continuing".to_string());
    }

    let current_baud = port
        .baud_rate()
        .map_err(|error| format!("Could not read the controller baud rate: {error}"))?;
    if current_baud == baud_rate {
        drop(serial);
        restart_controller_reader(&state, app)?;
        return Ok(format!("Controller is already using {baud_rate} baud"));
    }
    if device.controller == Some("CH32V208") {
        drop(serial);
        return Err("CH32V208 controllers only support 115200 baud".to_string());
    }

    send_controller_command(port.as_mut(), 0x08, &[])
        .map_err(|error| format!("Could not read the controller configuration: {error}"))?;
    let current_configuration =
        read_controller_response(port.as_mut(), 0x08, Duration::from_secs(2))?;
    if current_configuration.len() < 56
        || current_configuration[4] != 0x32
        || !matches!(current_configuration[3], 0x08 | 0x88)
    {
        return Err("The controller returned an incomplete configuration".to_string());
    }

    let mut configuration = current_configuration[..55].to_vec();
    configuration[3] = 0x09;
    let encoded_rate = baud_rate.to_be_bytes();
    configuration[8..12].copy_from_slice(&encoded_rate);
    write_port_command(port.as_mut(), configuration)
        .map_err(|error| format!("Could not send the baud-rate configuration: {error}"))?;
    let response = read_controller_response(port.as_mut(), 0x09, Duration::from_secs(2))?;
    if response.get(5) != Some(&0x00) {
        return Err("The controller rejected the requested baud rate".to_string());
    }

    send_controller_command(port.as_mut(), 0x0f, &[])
        .map_err(|error| format!("Could not restart the controller: {error}"))?;
    read_controller_response(port.as_mut(), 0x0f, Duration::from_secs(2))
        .map_err(|error| format!("The controller did not acknowledge its restart: {error}"))?;
    state.connection_id.fetch_add(1, Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(500));
    let old_port = serial.take();
    drop(serial);
    drop(old_port);
    std::thread::sleep(Duration::from_millis(500));

    let mut last_error = None;
    for attempt in 0..5 {
        match serialport::new(&port_name, baud_rate)
            .timeout(Duration::from_millis(100))
            .open()
        {
            Ok(mut reopened) => match probe_controller(&mut *reopened, false) {
                Ok(()) => {
                    reopened
                        .set_timeout(Duration::from_millis(10))
                        .map_err(|error| {
                            format!("Could not configure controller polling: {error}")
                        })?;
                    let mut serial = state
                        .serial
                        .lock()
                        .map_err(|_| "Serial connection state is unavailable".to_string())?;
                    *serial = Some(reopened);
                    drop(serial);
                    restart_controller_reader(&state, app)?;
                    return Ok(format!("Controller reconnected at {baud_rate} baud"));
                }
                Err(error) => last_error = Some(error),
            },
            Err(error) => last_error = Some(format!("Could not reopen {port_name}: {error}")),
        }
        if attempt < 4 {
            std::thread::sleep(Duration::from_millis(500));
        }
    }
    Err(last_error
        .unwrap_or_else(|| format!("The controller did not reconnect at {baud_rate} baud")))
}

#[tauri::command]
fn factory_reset_controller(
    port_name: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let device = list_devices()?
        .into_iter()
        .find(|device| device.port_name == port_name)
        .ok_or_else(|| format!("Controller {port_name} is no longer available"))?;
    if !matches!(device.controller, Some("CH9329" | "CH32V208")) {
        return Err("This controller does not support a hardware reset".to_string());
    }

    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let Some(port) = serial.as_mut() else {
        return Err("Connect the controller before resetting its HID chip".to_string());
    };
    if port.name().as_deref() != Some(port_name.as_str()) {
        return Err("The connected controller changed; reconnect before continuing".to_string());
    }

    port.write_request_to_send(true)
        .map_err(|error| format!("Could not start the controller hardware reset: {error}"))?;
    std::thread::sleep(Duration::from_secs(4));
    port.write_request_to_send(false)
        .map_err(|error| format!("Could not release the controller hardware reset: {error}"))?;
    state.connection_id.fetch_add(1, Ordering::SeqCst);
    let old_port = serial.take();
    drop(serial);
    drop(old_port);

    std::thread::sleep(Duration::from_millis(500));
    std::thread::sleep(Duration::from_secs(2));
    let baud_rates: &[u32] = if device.controller == Some("CH32V208") {
        &[115_200]
    } else {
        &[9_600, 115_200]
    };
    let mut last_error = None;
    for attempt in 0..6 {
        for baud_rate in baud_rates {
            match serialport::new(&port_name, *baud_rate)
                .timeout(Duration::from_millis(100))
                .open()
            {
                Ok(mut reopened) => match probe_controller(&mut *reopened, false) {
                    Ok(()) => {
                        reopened
                            .set_timeout(Duration::from_millis(10))
                            .map_err(|error| {
                                format!("Could not configure controller polling: {error}")
                            })?;
                        let mut serial = state
                            .serial
                            .lock()
                            .map_err(|_| "Serial connection state is unavailable".to_string())?;
                        *serial = Some(reopened);
                        drop(serial);
                        restart_controller_reader(&state, app)?;
                        return Ok(format!(
                            "HID controller factory reset completed at {baud_rate} baud"
                        ));
                    }
                    Err(error) => last_error = Some(error),
                },
                Err(error) => last_error = Some(format!("Could not reopen {port_name}: {error}")),
            }
        }
        if attempt < 5 {
            std::thread::sleep(Duration::from_secs(1));
        }
    }
    Err(last_error
        .unwrap_or_else(|| "The controller did not reconnect after its factory reset".to_string()))
}

fn spawn_controller_reader(
    serial: Arc<Mutex<Option<Box<dyn SerialPort>>>>,
    connection_id: Arc<AtomicU64>,
    reader_id: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    std::thread::Builder::new()
        .name("openterface-controller-reader".to_string())
        .spawn(move || {
            let mut buffer = Vec::with_capacity(256);
            let mut next_info_poll = Instant::now() + Duration::from_secs(3);
            while connection_id.load(Ordering::SeqCst) == reader_id {
                let mut chunk = [0u8; 128];
                let mut received = 0;
                if let Ok(mut current) = serial.lock() {
                    let Some(port) = current.as_mut() else {
                        break;
                    };
                    match port.read(&mut chunk) {
                        Ok(count) => received = count,
                        Err(error)
                            if matches!(
                                error.kind(),
                                std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                            ) => {}
                        Err(_) => {}
                    }
                    if Instant::now() >= next_info_poll {
                        let request = [0x57, 0xab, 0x00, 0x01, 0x00, 0x03];
                        let _ = port.write_all(&request);
                        let _ = port.flush();
                        next_info_poll = Instant::now() + Duration::from_secs(3);
                    }
                } else {
                    break;
                }

                if received > 0 {
                    buffer.extend_from_slice(&chunk[..received]);
                    if buffer.len() > 4096 {
                        let keep_from = buffer.len() - 512;
                        buffer.drain(..keep_from);
                    }
                    process_controller_packets(&mut buffer, &app);
                }
            }
        })
        .map(|_| ())
        .map_err(|error| format!("Could not start controller response reader: {error}"))
}

fn process_controller_packets(buffer: &mut Vec<u8>, app: &tauri::AppHandle) {
    loop {
        let Some(start) = buffer.windows(2).position(|window| window == [0x57, 0xab]) else {
            let keep_header_prefix = buffer.last() == Some(&0x57);
            buffer.clear();
            if keep_header_prefix {
                buffer.push(0x57);
            }
            return;
        };
        if start > 0 {
            buffer.drain(..start);
        }
        if buffer.len() < 6 {
            return;
        }
        let packet_length = buffer[4] as usize + 6;
        if !(6..=512).contains(&packet_length) {
            buffer.drain(..2);
            continue;
        }
        if buffer.len() < packet_length {
            return;
        }
        let packet: Vec<u8> = buffer.drain(..packet_length).collect();
        if packet[3] == 0x81 && packet.len() >= 8 {
            let indicators = packet[7];
            let _ = app.emit(
                "controller-status",
                ControllerStatus {
                    target_connected: packet[6] == 0x01,
                    num_lock: indicators & 0x01 != 0,
                    caps_lock: indicators & 0x02 != 0,
                    scroll_lock: indicators & 0x04 != 0,
                },
            );
        }
    }
}

fn probe_controller(port: &mut dyn SerialPort, reset_ch32v208: bool) -> Result<(), String> {
    if reset_ch32v208 {
        std::thread::sleep(Duration::from_millis(100));
        send_controller_command(port, 0x0f, &[])
            .map_err(|error| format!("Could not reset the CH32V208 HID interface: {error}"))?;
        std::thread::sleep(Duration::from_millis(100));
    }

    let attempts = if reset_ch32v208 { 5 } else { 1 };
    for attempt in 0..attempts {
        send_controller_command(port, 0x01, &[]).map_err(|error| {
            format!("Could not send controller identification request: {error}")
        })?;
        let deadline = Instant::now() + Duration::from_millis(350);
        let mut response = Vec::with_capacity(64);
        while Instant::now() < deadline {
            let mut chunk = [0u8; 32];
            match port.read(&mut chunk) {
                Ok(0) => continue,
                Ok(count) => {
                    response.extend_from_slice(&chunk[..count]);
                    if valid_info_response(&response) {
                        return Ok(());
                    }
                    if response.len() > 512 {
                        break;
                    }
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) => {}
                Err(_) => {}
            }
        }
        if attempt + 1 < attempts {
            std::thread::sleep(Duration::from_millis(300 * (attempt as u64 + 1)));
        }
    }
    Err("The controller did not return a valid identification response".to_string())
}

fn send_controller_command(
    port: &mut dyn SerialPort,
    command: u8,
    payload: &[u8],
) -> std::io::Result<()> {
    let mut packet = vec![0x57, 0xab, 0x00, command, payload.len() as u8];
    packet.extend_from_slice(payload);
    let checksum = packet.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    packet.push(checksum);
    port.write_all(&packet)?;
    port.flush()
}

fn valid_info_response(response: &[u8]) -> bool {
    for start in 0..response.len().saturating_sub(5) {
        if response[start] != 0x57 || response[start + 1] != 0xab || response[start + 3] != 0x81 {
            continue;
        }
        let packet_length = response[start + 4] as usize + 6;
        let end = start + packet_length;
        if end <= response.len() {
            // The Qt connection path accepts a complete GET_INFO response by
            // header and response command; some supported firmware reports a
            // checksum mismatch while still returning usable device info.
            return true;
        }
    }
    false
}

#[tauri::command]
fn disconnect_device(
    request_id: u64,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    let capture_result = windows_keys::set_capture(false, request_id, &app);
    #[cfg(not(windows))]
    let capture_result: Result<(), String> = {
        let _ = (request_id, &app);
        Ok(())
    };
    let disconnect_result = disconnect_controller(&state);
    capture_result?;
    disconnect_result
}

#[tauri::command]
fn reset_serial_connection(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let (port_name, baud_rate) = {
        let mut serial = state
            .serial
            .lock()
            .map_err(|_| "Serial connection state is unavailable".to_string())?;
        let port = serial.take().ok_or_else(|| {
            "Connect an Openterface controller before resetting the connection".to_string()
        })?;
        let port_name = port
            .name()
            .ok_or_else(|| "Could not identify the connected controller port".to_string())?;
        let baud_rate = port
            .baud_rate()
            .map_err(|error| format!("Could not read the controller baud rate: {error}"))?;
        state.connection_id.fetch_add(1, Ordering::SeqCst);
        drop(port);
        (port_name, baud_rate)
    };

    std::thread::sleep(Duration::from_millis(250));
    let mut port = serialport::new(&port_name, baud_rate)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|error| format!("Could not reopen {port_name} at {baud_rate} baud: {error}"))?;
    probe_controller(&mut *port, false)
        .map_err(|error| format!("The controller port reopened, but did not respond: {error}"))?;
    port.set_timeout(Duration::from_millis(10))
        .map_err(|error| format!("Could not restore controller response polling: {error}"))?;

    {
        let mut serial = state
            .serial
            .lock()
            .map_err(|_| "Serial connection state is unavailable".to_string())?;
        if serial.is_some() {
            return Err(
                "The controller connection changed during reset; reconnect before continuing"
                    .to_string(),
            );
        }
        *serial = Some(port);
    }
    let reader_id = state.connection_id.fetch_add(1, Ordering::SeqCst) + 1;
    if let Err(error) = spawn_controller_reader(
        state.serial.clone(),
        state.connection_id.clone(),
        reader_id,
        app,
    ) {
        state.connection_id.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut serial) = state.serial.lock() {
            *serial = None;
        }
        return Err(error);
    }
    Ok(format!(
        "Serial connection to {port_name} reset at {baud_rate} baud"
    ))
}

fn disconnect_controller(state: &AppState) -> Result<(), String> {
    state.connection_id.fetch_add(1, Ordering::SeqCst);
    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    if let Some(port) = serial.as_mut() {
        // Release any held target keys and mouse buttons before dropping the port.
        let _ = write_port_command(
            port.as_mut(),
            vec![
                0x57, 0xab, 0x00, 0x02, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ],
        );
        let _ = write_port_command(
            port.as_mut(),
            vec![
                0x57, 0xab, 0x00, 0x04, 0x07, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            ],
        );
        let _ = write_port_command(
            port.as_mut(),
            vec![0x57, 0xab, 0x00, 0x05, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00],
        );
    }
    *serial = None;
    Ok(())
}

fn write_command(state: &State<'_, AppState>, command: Vec<u8>) -> Result<(), String> {
    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let port = serial
        .as_mut()
        .ok_or_else(|| "Connect an Openterface controller before sending input".to_string())?;
    write_port_command(port.as_mut(), command)
        .map_err(|error| format!("Could not send input to the controller: {error}"))
}

fn write_port_command(port: &mut dyn SerialPort, mut command: Vec<u8>) -> std::io::Result<()> {
    let checksum = command
        .iter()
        .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    command.push(checksum);
    port.write_all(&command)
}

#[tauri::command]
fn send_keyboard_report(
    modifiers: u8,
    keys: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if keys.len() > 6 {
        return Err("A keyboard report can contain up to six keys".to_string());
    }

    let mut keycodes = Vec::with_capacity(6);
    for (mask, usage) in [
        (0x01, 0xe0),
        (0x02, 0xe1),
        (0x04, 0xe2),
        (0x08, 0xe3),
        (0x10, 0xe4),
        (0x20, 0xe5),
        (0x40, 0xe6),
        (0x80, 0xe7),
    ] {
        if modifiers & mask != 0 && keycodes.len() < 6 {
            keycodes.push(usage);
        }
    }
    for key in keys {
        if keycodes.len() == 6 {
            break;
        }
        if !keycodes.contains(&key) {
            keycodes.push(key);
        }
    }

    // Some CH9329 firmware drops Alt and GUI from the modifier byte. Keep
    // Ctrl and Shift there, and send every held modifier as a HID key usage.
    let safe_modifiers = modifiers & 0x03;
    let mut command = vec![0x57, 0xab, 0x00, 0x02, 0x08, safe_modifiers, 0x00];
    command.extend(keycodes);
    command.resize(13, 0);
    write_command(&state, command)
}

#[tauri::command]
fn send_mouse_report(
    x: u16,
    y: u16,
    buttons: u8,
    wheel: i8,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut command = vec![0x57, 0xab, 0x00, 0x04, 0x07, 0x02, buttons];
    command.extend(x.to_le_bytes());
    command.extend(y.to_le_bytes());
    command.push(wheel as u8);
    write_command(&state, command)
}

#[tauri::command]
fn send_relative_mouse_report(
    dx: i8,
    dy: i8,
    buttons: u8,
    wheel: i8,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let command = vec![
        0x57,
        0xab,
        0x00,
        0x05,
        0x05,
        0x01,
        buttons,
        dx as u8,
        dy as u8,
        wheel as u8,
    ];
    write_command(&state, command)
}

#[tauri::command]
fn switch_usb_route(to_target: bool, state: State<'_, AppState>) -> Result<String, String> {
    let connected_port_name = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?
        .as_ref()
        .and_then(|port| port.name())
        .ok_or_else(|| {
            "Connect an Openterface controller before switching USB routing".to_string()
        })?;
    let device = list_devices()?
        .into_iter()
        .find(|device| device.port_name == connected_port_name)
        .ok_or_else(|| {
            "Connect an Openterface controller before switching USB routing".to_string()
        })?;

    let mut serial = state
        .serial
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let port = serial.as_mut().ok_or_else(|| {
        "Connect an Openterface controller before switching USB routing".to_string()
    })?;
    if port.name().as_deref() != Some(device.port_name.as_str()) {
        return Err(
            "The connected controller changed; reconnect before switching USB routing".to_string(),
        );
    }

    let mut command = vec![
        0x57,
        0xab,
        0x00,
        0x17,
        0x05,
        0x00,
        0x00,
        0x00,
        0x00,
        u8::from(to_target),
    ];
    let checksum = command
        .iter()
        .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
    command.push(checksum);
    port.write_all(&command)
        .map_err(|error| format!("Could not switch the USB route: {error}"))?;

    if device.controller == Some("CH9329") {
        std::thread::sleep(Duration::from_millis(200));
        port.write_data_terminal_ready(true).map_err(|error| {
            format!("USB route was set, but the controller could not reset the switch: {error}")
        })?;
        std::thread::sleep(Duration::from_millis(500));
        port.write_data_terminal_ready(false).map_err(|error| {
            format!(
                "USB route was set, but the controller could not restore its serial line: {error}"
            )
        })?;
    } else if device.controller != Some("CH32V208") {
        return Err("USB route switching is unavailable for this controller".to_string());
    }

    Ok(if to_target {
        "Switchable USB is routed to the target".to_string()
    } else {
        "Switchable USB is routed to the host".to_string()
    })
}

#[tauri::command]
fn set_system_key_capture(
    enabled: bool,
    request_id: u64,
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        return windows_keys::set_capture(enabled, request_id, &app);
    }
    #[cfg(not(windows))]
    {
        let _ = (app, request_id);
        if enabled {
            Err("System shortcut capture is available in Windows builds only".to_string())
        } else {
            Ok(())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            serial: Arc::new(Mutex::new(None)),
            connection_id: Arc::new(AtomicU64::new(0)),
        })
        .invoke_handler(tauri::generate_handler![
            load_preferences,
            save_preferences,
            list_keyboard_layouts,
            paste_clipboard_to_target,
            open_external_link,
            list_devices,
            read_capture_firmware_version,
            connect_device,
            apply_controller_mode,
            apply_baud_rate,
            factory_reset_controller,
            disconnect_device,
            reset_serial_connection,
            send_keyboard_report,
            send_mouse_report,
            send_relative_mouse_report,
            switch_usb_route,
            set_system_key_capture,
            set_screen_saver_inhibited,
        ])
        .on_permission_request(|_webview, permission| match permission {
            PermissionKind::Camera => PermissionResponse::Allow,
            PermissionKind::Microphone => PermissionResponse::Allow,
            _ => PermissionResponse::Default,
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                #[cfg(windows)]
                let _ = windows_keys::shutdown_capture();
                #[cfg(windows)]
                let _ = windows_power::set_inhibited(false);
                let state = window.app_handle().state::<AppState>();
                let _ = disconnect_controller(&state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Openterface Mini-KVM");
}
