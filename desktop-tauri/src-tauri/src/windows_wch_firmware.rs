use crate::WchDeviceSummary;
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::{FreeLibrary, GetLastError, HMODULE, HWND};
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExA};

const WCH_DEVICE_LIMIT: u32 = 16;
const BULK_REPORT_SIZE: usize = 64;
const FLASH_SECTOR_SIZE: usize = 1024;
const FLASH_PROGRAM_CHUNK: usize = 56;
const MAX_FIRMWARE_BYTES: usize = 512 * 1024;

type OpenDevice = unsafe extern "system" fn(u32) -> HWND;
type CloseDevice = unsafe extern "system" fn(u32);
type SetTimeout = unsafe extern "system" fn(u32, u32, u32);
type TransferData = unsafe extern "system" fn(u32, *mut c_void, *mut u32) -> i32;
type SetEndpoint = unsafe extern "system" fn(u32, u8) -> i32;

struct WchTransport {
    library: HMODULE,
    open_device: OpenDevice,
    close_device: CloseDevice,
    set_timeout: SetTimeout,
    write_data: TransferData,
    read_data: TransferData,
    set_endpoint_tx: Option<SetEndpoint>,
    set_endpoint_rx: Option<SetEndpoint>,
    open_index: Option<u32>,
}

impl WchTransport {
    fn new() -> Result<Self, String> {
        unsafe {
            let library = LoadLibraryExA(
                b"CH375DLL64.DLL\0".as_ptr(),
                std::ptr::null_mut(),
                0x00000800,
            );
            if library.is_null() {
                return Err(format!(
                    "Could not load CH375DLL64.DLL (Windows error {}). Install the WCH CH375 USB driver before using WCH ISP flashing.",
                    GetLastError()
                ));
            }
            let symbols = (|| {
                Ok::<_, String>((
                    load_symbol::<OpenDevice>(library, b"CH375OpenDevice\0")?,
                    load_symbol::<CloseDevice>(library, b"CH375CloseDevice\0")?,
                    load_symbol::<SetTimeout>(library, b"CH375SetTimeout\0")?,
                    load_symbol::<TransferData>(library, b"CH375WriteData\0")?,
                    load_symbol::<TransferData>(library, b"CH375ReadData\0")?,
                    load_optional_symbol::<SetEndpoint>(library, b"CH375SetEndpointTx\0"),
                    load_optional_symbol::<SetEndpoint>(library, b"CH375SetEndpointRx\0"),
                ))
            })();
            let (
                open_device,
                close_device,
                set_timeout,
                write_data,
                read_data,
                set_endpoint_tx,
                set_endpoint_rx,
            ) = match symbols {
                Ok(symbols) => symbols,
                Err(error) => {
                    FreeLibrary(library);
                    return Err(error);
                }
            };
            Ok(Self {
                library,
                open_device,
                close_device,
                set_timeout,
                write_data,
                read_data,
                set_endpoint_tx,
                set_endpoint_rx,
                open_index: None,
            })
        }
    }

    fn open(&mut self, index: u32) -> Result<(), String> {
        self.close();
        let handle = unsafe { (self.open_device)(index) };
        if handle.is_null() || handle as isize == -1 {
            return Err(format!("CH375OpenDevice failed for device index {index}"));
        }
        unsafe { (self.set_timeout)(index, 5000, 5000) };
        if let Some(set_endpoint_tx) = self.set_endpoint_tx {
            unsafe { set_endpoint_tx(index, 0x02) };
        }
        if let Some(set_endpoint_rx) = self.set_endpoint_rx {
            unsafe { set_endpoint_rx(index, 0x82) };
        }
        self.open_index = Some(index);
        Ok(())
    }

    fn close(&mut self) {
        if let Some(index) = self.open_index.take() {
            unsafe { (self.close_device)(index) };
        }
    }

    fn transfer(&self, command: &[u8]) -> Result<Vec<u8>, String> {
        let index = self
            .open_index
            .ok_or_else(|| "The WCH ISP device is not open".to_string())?;
        let mut output = command.to_vec();
        let mut output_length = output.len() as u32;
        let sent = unsafe {
            (self.write_data)(
                index,
                output.as_mut_ptr().cast(),
                &mut output_length as *mut u32,
            )
        };
        if sent == 0 || output_length as usize != command.len() {
            return Err("CH375WriteData failed or sent an incomplete packet".to_string());
        }

        let mut input = vec![0u8; BULK_REPORT_SIZE];
        let mut input_length = input.len() as u32;
        let received = unsafe {
            (self.read_data)(
                index,
                input.as_mut_ptr().cast(),
                &mut input_length as *mut u32,
            )
        };
        if received == 0 {
            return Err("CH375ReadData failed".to_string());
        }
        if input_length as usize > input.len() {
            return Err("CH375ReadData returned an invalid packet length".to_string());
        }
        input.truncate(input_length as usize);
        Ok(input)
    }

    fn scan(&mut self) -> Vec<WchDeviceSummary> {
        let mut devices = Vec::new();
        for index in 0..WCH_DEVICE_LIMIT {
            if self.open(index).is_err() {
                continue;
            }
            if let Ok(payload) = self.command(&identify_packet(0, 0)) {
                if payload.len() >= 2 {
                    let chip_id = payload[0];
                    let device_type = payload[1];
                    let chip = chip_info(chip_id, device_type);
                    devices.push(WchDeviceSummary {
                        index,
                        chip_name: chip.name,
                        chip_id,
                        device_type,
                        flash_size_bytes: chip.flash_size,
                    });
                }
            }
            self.close();
        }
        devices
    }

    fn command(&self, packet: &[u8]) -> Result<Vec<u8>, String> {
        let raw = self.transfer(packet)?;
        let response = parse_response(&raw)?;
        if response.0 != 0 {
            return Err(format!("WCH ISP reported status 0x{:02x}", response.0));
        }
        Ok(response.1)
    }
}

impl Drop for WchTransport {
    fn drop(&mut self) {
        self.close();
        if !self.library.is_null() {
            unsafe { FreeLibrary(self.library) };
            self.library = std::ptr::null_mut();
        }
    }
}

unsafe fn load_symbol<T: Copy>(library: HMODULE, name: &'static [u8]) -> Result<T, String> {
    let symbol = GetProcAddress(library, name.as_ptr());
    let Some(symbol) = symbol else {
        return Err(format!(
            "CH375DLL64.DLL is missing required export {}",
            String::from_utf8_lossy(&name[..name.len() - 1])
        ));
    };
    Ok(std::mem::transmute_copy(&symbol))
}

unsafe fn load_optional_symbol<T: Copy>(library: HMODULE, name: &'static [u8]) -> Option<T> {
    GetProcAddress(library, name.as_ptr()).map(|symbol| std::mem::transmute_copy(&symbol))
}

struct ChipInfo {
    name: String,
    chip_id: u8,
    device_type: u8,
    flash_size: u32,
    uid_size: usize,
    protects_flash: bool,
}

fn chip_info(chip_id: u8, device_type: u8) -> ChipInfo {
    let (name, flash_size, uid_size, protects_flash) = match (chip_id, device_type) {
        (0x71, 0x13) => ("CH571", 192u32 * 1024, 8, false),
        (0x73, 0x13) => ("CH573", 448u32 * 1024, 8, false),
        (0x32, 0x14) => ("CH32F103C6", 32u32 * 1024, 8, false),
        (0x33, 0x14) => ("CH32F103C8", 64u32 * 1024, 8, false),
        (0x81, 0x16) => ("CH581", 192u32 * 1024, 8, false),
        (0x82, 0x16) => ("CH582", 448u32 * 1024, 8, false),
        (0x83, 0x16) => ("CH583", 448u32 * 1024, 8, false),
        (0x50, 0x17) => ("CH32V305RB", 128u32 * 1024, 8, true),
        (0x70, 0x17) => ("CH32V307VC", 256u32 * 1024, 8, true),
        (0x73, 0x17) => ("CH32V307WC", 256u32 * 1024, 8, true),
        (0x50, 0x18) => ("CH32F205RB", 128u32 * 1024, 8, true),
        (0x80, 0x18) => ("CH32F208WB", 128u32 * 1024, 8, true),
        (0x81, 0x18) => ("CH32F208RB", 128u32 * 1024, 8, true),
        (0x80, 0x19) => ("CH32V208WB", 128u32 * 1024, 8, true),
        (0x81, 0x19) => ("CH32V208RB", 128u32 * 1024, 8, true),
        (0x82, 0x19) => ("CH32V208CB", 128u32 * 1024, 8, true),
        (0x83, 0x19) => ("CH32V208GB", 128u32 * 1024, 8, true),
        (0x33, 0x19) => ("CH32V203C6", 32u32 * 1024, 8, true),
        (0x30, 0x19) => ("CH32V203C8", 64u32 * 1024, 8, true),
        (0x32, 0x19) => ("CH32V203K8", 64u32 * 1024, 8, true),
        (0x34, 0x19) => ("CH32V203RB", 128u32 * 1024, 8, true),
        (0x32, 0x15) => ("CH32V103C6", 32u32 * 1024, 8, false),
        (0x33, 0x15) => ("CH32V103C8", 64u32 * 1024, 8, false),
        (0x51, 0x11) => ("CH551", 10u32 * 1024, 4, false),
        (0x52, 0x11) => ("CH552", 14u32 * 1024, 4, false),
        (0x54, 0x11) => ("CH554", 14u32 * 1024, 4, false),
        (0x61, 0x10) => ("CH561", 64u32 * 1024, 8, false),
        (0x63, 0x10) => ("CH563", 224u32 * 1024, 8, false),
        (0x65, 0x10) => ("CH565", 448u32 * 1024, 8, false),
        (0x91, 0x22) => ("CH591", 192u32 * 1024, 8, false),
        (0x92, 0x22) => ("CH592", 448u32 * 1024, 8, false),
        (0x30, 0x20) => ("CH32F203C8(D6)", 64u32 * 1024, 8, true),
        (0x20, 0x21) => ("CH32V002F4", 16u32 * 1024, 8, false),
        (0x32, 0x21) => ("CH32V003A4", 16u32 * 1024, 8, false),
        (0x51, 0x23) => ("CH32X035C8", 62u32 * 1024, 8, true),
        (0x50, 0x23) => ("CH32X035R8", 62u32 * 1024, 8, true),
        (0x30, 0x24) => ("CH643", 62u32 * 1024, 8, true),
        (0x30, 0x25) => ("CH32L103C8", 64u32 * 1024, 8, true),
        _ => ("Unknown WCH chip", 0, 8, false),
    };
    ChipInfo {
        name: name.to_string(),
        chip_id,
        device_type,
        flash_size,
        uid_size,
        protects_flash,
    }
}

struct WchFlasher<'a> {
    transport: &'a mut WchTransport,
    chip: ChipInfo,
    uid: Vec<u8>,
    xor_key: [u8; 8],
    protected: bool,
}

impl<'a> WchFlasher<'a> {
    fn connect(
        transport: &'a mut WchTransport,
        chip_id: u8,
        device_type: u8,
    ) -> Result<Self, String> {
        let payload = transport.command(&identify_packet(0, 0))?;
        if payload.len() < 2 || payload[0] != chip_id || payload[1] != device_type {
            return Err("The WCH ISP device changed after scanning".to_string());
        }
        let mut flasher = Self {
            transport,
            chip: chip_info(chip_id, device_type),
            uid: Vec::new(),
            xor_key: [0; 8],
            protected: false,
        };
        flasher.read_config()?;
        flasher.derive_key();
        Ok(flasher)
    }

    fn read_config(&mut self) -> Result<(), String> {
        let payload = self.transport.command(&packet(0xa7, &[0x1f, 0]))?;
        if payload.len() < 18 {
            return Err("WCH read-config response was too short".to_string());
        }
        self.protected = self.chip.protects_flash && payload[2] != 0xa5;
        self.uid =
            payload[18..18 + self.chip.uid_size.min(payload.len().saturating_sub(18))].to_vec();
        if self.chip.device_type == 0x19 {
            let sram_mode = (payload[4] >> 6) & 0x03;
            self.chip.flash_size = if (0x80..=0x83).contains(&self.chip.chip_id) {
                [192, 224, 256, 228][sram_mode as usize] * 1024
            } else {
                [128, 144, 160, 160][sram_mode as usize] * 1024
            };
        }
        Ok(())
    }

    fn derive_key(&mut self) {
        let uid_sum = self
            .uid
            .iter()
            .take(self.chip.uid_size)
            .fold(0u8, |sum, b| sum.wrapping_add(*b));
        self.xor_key = [uid_sum; 8];
        self.xor_key[7] = self.xor_key[7].wrapping_add(self.chip.chip_id);
    }

    fn flash(&mut self, raw: &[u8]) -> Result<(), String> {
        if self.chip.flash_size == 0 {
            return Err("The WCH ISP reported an unsupported chip model".to_string());
        }
        let padded = pad_to_sector(raw);
        if padded.len() > self.chip.flash_size as usize {
            return Err(format!(
                "Firmware is {} bytes, larger than the {}-byte code flash",
                padded.len(),
                self.chip.flash_size
            ));
        }
        if self.protected {
            self.unprotect()?;
        }

        let sectors = (padded.len() / FLASH_SECTOR_SIZE + 1)
            .max(if self.chip.device_type == 0x10 { 4 } else { 8 });
        self.transport
            .command(&packet(0xa4, &(sectors as u32).to_le_bytes()))?;
        std::thread::sleep(Duration::from_secs(1));

        self.send_key()?;
        let total_chunks = padded.len().div_ceil(FLASH_PROGRAM_CHUNK);
        for (chunk_index, (offset, chunk)) in padded
            .chunks(FLASH_PROGRAM_CHUNK)
            .enumerate()
            .map(|(i, c)| (i * FLASH_PROGRAM_CHUNK, c))
            .enumerate()
        {
            let encrypted = self.xor_bytes(chunk, offset);
            let padding = random_padding(offset);
            let mut payload = (offset as u32).to_le_bytes().to_vec();
            payload.push(padding);
            payload.extend(encrypted);
            self.transport.command(&packet(0xa5, &payload))?;
            let _progress = 10 + ((chunk_index + 1) * 40 / total_chunks.max(1));
        }
        let mut final_payload = (padded.len() as u32).to_le_bytes().to_vec();
        final_payload.push(random_padding(padded.len()));
        self.transport.command(&packet(0xa5, &final_payload))?;
        std::thread::sleep(Duration::from_millis(500));

        self.send_key()?;
        for (chunk_index, (offset, chunk)) in padded
            .chunks(FLASH_PROGRAM_CHUNK)
            .enumerate()
            .map(|(i, c)| (i * FLASH_PROGRAM_CHUNK, c))
            .enumerate()
        {
            let encrypted = self.xor_bytes(chunk, offset);
            let mut payload = (offset as u32).to_le_bytes().to_vec();
            payload.push(random_padding(offset));
            payload.extend(encrypted);
            let response = self.transport.command(&packet(0xa6, &payload))?;
            if response.first().copied() != Some(0) {
                return Err(format!("WCH flash verification failed at byte {offset}"));
            }
            let _progress = 50 + ((chunk_index + 1) * 45 / total_chunks.max(1));
        }
        let _ = self.transport.command(&packet(0xa2, &[1]));
        std::thread::sleep(Duration::from_secs(2));
        Ok(())
    }

    fn unprotect(&mut self) -> Result<(), String> {
        let payload = self.transport.command(&packet(0xa7, &[0x07, 0]))?;
        if payload.len() < 14 {
            return Err("WCH unprotect config response was too short".to_string());
        }

        let mut config = payload[2..14].to_vec();
        config[0] = 0xa5;
        config[1] = 0x5a;
        config[8..12].fill(0xff);
        let mut write_config = vec![0x07, 0];
        write_config.extend(config);
        self.transport.command(&packet(0xa8, &write_config))?;

        // WCH applies the protection change only after a reset. The bootloader
        // may disconnect before replying, so closing and rescanning is expected.
        let _ = self.transport.command(&packet(0xa2, &[1]));
        self.transport.close();

        for _ in 0..10 {
            std::thread::sleep(Duration::from_secs(2));
            let devices = self.transport.scan();
            let Some(device) = devices.iter().find(|device| {
                device.chip_id == self.chip.chip_id && device.device_type == self.chip.device_type
            }) else {
                continue;
            };
            if self.transport.open(device.index).is_err() {
                continue;
            }
            let identified = self
                .transport
                .command(&identify_packet(self.chip.chip_id, self.chip.device_type))
                .is_ok();
            if !identified {
                self.transport.close();
                continue;
            }

            self.read_config()?;
            self.derive_key();
            if self.protected {
                return Err("WCH controller remains protected after the reset".to_string());
            }
            return Ok(());
        }

        Err("WCH controller did not reconnect after clearing code-flash protection".to_string())
    }

    fn send_key(&self) -> Result<(), String> {
        let payload = self.transport.command(&packet(0xa3, &[0; 30]))?;
        if let Some(received) = payload.first() {
            let expected = self
                .xor_key
                .iter()
                .fold(0u8, |sum, byte| sum.wrapping_add(*byte));
            if *received != expected {
                return Err("WCH ISP key checksum did not match the device".to_string());
            }
        }
        Ok(())
    }

    fn xor_bytes(&self, bytes: &[u8], offset: usize) -> Vec<u8> {
        bytes
            .iter()
            .enumerate()
            .map(|(index, byte)| byte ^ self.xor_key[(offset + index) % 8])
            .collect()
    }
}

pub fn scan_devices() -> Result<Vec<WchDeviceSummary>, String> {
    let mut transport = WchTransport::new()?;
    Ok(transport.scan())
}

pub fn flash_device(
    index: u32,
    chip_id: u8,
    device_type: u8,
    raw_firmware: &[u8],
) -> Result<String, String> {
    if raw_firmware.len() > MAX_FIRMWARE_BYTES {
        return Err("Firmware file exceeds the 512 KiB safety limit".to_string());
    }
    let firmware = parse_firmware(raw_firmware)?;
    if firmware.is_empty() || firmware.len() > MAX_FIRMWARE_BYTES {
        return Err("Firmware data is empty or exceeds the 512 KiB safety limit".to_string());
    }
    let mut transport = WchTransport::new()?;
    let devices = transport.scan();
    let selected = devices
        .iter()
        .find(|device| {
            device.index == index && device.chip_id == chip_id && device.device_type == device_type
        })
        .ok_or_else(|| {
            "The selected WCH ISP device changed or disconnected after scanning".to_string()
        })?;
    let expected_chip = (selected.chip_id, selected.device_type);
    transport.open(index)?;
    let mut flasher = WchFlasher::connect(&mut transport, expected_chip.0, expected_chip.1)?;
    flasher.flash(&firmware)?;
    transport.close();
    Ok(format!(
        "{} firmware was programmed and verified. Reconnect the controller.",
        selected.chip_name
    ))
}

fn packet(command: u8, payload: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(3 + payload.len());
    result.push(command);
    result.extend_from_slice(&(payload.len() as u16).to_le_bytes());
    result.extend_from_slice(payload);
    result
}

fn identify_packet(chip_id: u8, device_type: u8) -> Vec<u8> {
    let mut payload = vec![chip_id, device_type];
    payload.extend_from_slice(b"MCU ISP & WCH.CN");
    packet(0xa1, &payload)
}

fn parse_response(raw: &[u8]) -> Result<(u8, Vec<u8>), String> {
    if raw.len() < 4 {
        return Err("WCH ISP response was shorter than its header".to_string());
    }
    let length = u16::from_le_bytes([raw[2], raw[3]]) as usize;
    if raw.len() < 4 + length {
        return Err("WCH ISP response payload was truncated".to_string());
    }
    Ok((raw[1], raw[4..4 + length].to_vec()))
}

fn random_padding(offset: usize) -> u8 {
    let tick = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos();
    (tick as u8).wrapping_add(offset as u8)
}

fn pad_to_sector(firmware: &[u8]) -> Vec<u8> {
    let mut result = firmware.to_vec();
    let padding = (FLASH_SECTOR_SIZE - result.len() % FLASH_SECTOR_SIZE) % FLASH_SECTOR_SIZE;
    result.resize(result.len() + padding, 0);
    result
}

fn parse_firmware(raw: &[u8]) -> Result<Vec<u8>, String> {
    if raw.first() != Some(&b':') {
        return Ok(raw.to_vec());
    }
    let text =
        std::str::from_utf8(raw).map_err(|_| "Intel HEX file is not valid UTF-8".to_string())?;
    let mut sparse = BTreeMap::<u32, u8>::new();
    let mut base = 0u32;
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if !line.starts_with(':') || line.len() < 11 {
            return Err("Invalid or truncated Intel HEX record".to_string());
        }
        let record = decode_hex(&line[1..])?;
        let count = record[0] as usize;
        if record.len() != count + 5 {
            return Err("Intel HEX record byte count does not match its payload".to_string());
        }
        if record.iter().fold(0u8, |sum, byte| sum.wrapping_add(*byte)) != 0 {
            return Err("Intel HEX checksum mismatch".to_string());
        }
        let address = u16::from_be_bytes([record[1], record[2]]) as u32;
        match record[3] {
            0x00 => {
                for (offset, byte) in record[4..4 + count].iter().enumerate() {
                    let address = base
                        .checked_add(address)
                        .and_then(|address| address.checked_add(offset as u32))
                        .filter(|address| (*address as usize) < MAX_FIRMWARE_BYTES)
                        .ok_or_else(|| {
                            "Intel HEX address exceeds the 512 KiB safety limit".to_string()
                        })?;
                    sparse.insert(address, *byte);
                }
            }
            0x01 => break,
            0x02 if count == 2 => base = u16::from_be_bytes([record[4], record[5]]) as u32 * 16,
            0x04 if count == 2 => base = u16::from_be_bytes([record[4], record[5]]) as u32 * 65536,
            0x02 | 0x04 => return Err("Invalid Intel HEX extended address record".to_string()),
            _ => {}
        }
        if sparse.len() > MAX_FIRMWARE_BYTES {
            return Err("Intel HEX data exceeds the 512 KiB safety limit".to_string());
        }
    }
    let Some((&first, _)) = sparse.first_key_value() else {
        return Err("Intel HEX file contains no firmware data".to_string());
    };
    let last = *sparse.last_key_value().expect("map is not empty").0;
    let span = (last - first + 1) as usize;
    if first != 0 {
        return Err(
            "Intel HEX firmware must start at address zero for this WCH ISP programmer".to_string(),
        );
    }
    if span > MAX_FIRMWARE_BYTES {
        return Err("Intel HEX address span exceeds the 512 KiB safety limit".to_string());
    }
    let mut result = vec![0u8; span];
    for (address, byte) in sparse {
        result[address as usize] = byte;
    }
    Ok(result)
}

fn decode_hex(text: &str) -> Result<Vec<u8>, String> {
    if text.len() % 2 != 0 {
        return Err("Intel HEX record contains an incomplete byte".to_string());
    }
    text.as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let digit = |byte: u8| match byte {
                b'0'..=b'9' => Some(byte - b'0'),
                b'a'..=b'f' => Some(byte - b'a' + 10),
                b'A'..=b'F' => Some(byte - b'A' + 10),
                _ => None,
            };
            let high = digit(pair[0])
                .ok_or_else(|| "Intel HEX record contains a non-hex character".to_string())?;
            let low = digit(pair[1])
                .ok_or_else(|| "Intel HEX record contains a non-hex character".to_string())?;
            Ok((high << 4) | low)
        })
        .collect()
}
