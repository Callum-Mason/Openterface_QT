use serialport::{SerialPortInfo, SerialPortType};
use std::collections::HashSet;
use windows_sys::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_Child, CM_Get_DevNode_Registry_PropertyW, CM_Get_Device_IDW, CM_Get_Sibling,
    CM_Locate_DevNodeW, CM_DRP_CLASS, CM_DRP_DEVICEDESC, CM_DRP_FRIENDLYNAME,
    CM_DRP_LOCATION_PATHS, CM_LOCATE_DEVNODE_NORMAL, CR_BUFFER_SMALL, CR_SUCCESS,
};

use crate::KvmDevice;

#[derive(Clone, Debug)]
struct DeviceNode {
    devinst: u32,
    id: String,
    parent: Option<u32>,
    class: String,
    name: String,
    location_paths: Vec<String>,
}

pub fn discover(ports: &[SerialPortInfo]) -> Vec<KvmDevice> {
    let nodes = enumerate_nodes();
    let mut devices = ports
        .iter()
        .filter_map(|port| {
            let SerialPortType::UsbPort(info) = &port.port_type else {
                return None;
            };
            let controller = controller_name(info.vid, info.pid)?;
            let serial_node = find_serial_node(&nodes, &port.port_name, info.vid, info.pid);
            let associated = serial_node.and_then(|serial| associate_video(serial, &nodes));
            let (generation, capture_chip, camera_name, has_hid, has_camera, has_audio) = associated
                .map(|video| {
                    let family = descendants(video, &nodes);
                    let camera = family.iter().find(|node| is_camera(node));
                    (
                        Some(generation(serial_node, video)),
                        capture_chip(&video.id),
                        camera
                            .map(|node| node.name.clone())
                            .filter(|name| !name.is_empty())
                            .or_else(|| (!video.name.is_empty()).then(|| video.name.clone())),
                        family.iter().any(|node| is_hid(node)),
                        family.iter().any(|node| is_camera(node)) || is_camera(video),
                        family.iter().any(|node| is_audio(node)),
                    )
                })
                .unwrap_or((None, None, None, false, false, false));

            Some(KvmDevice {
                port_name: port.port_name.clone(),
                manufacturer: info.manufacturer.clone(),
                product: info.product.clone(),
                serial_number: info.serial_number.clone(),
                vendor_id: Some(info.vid),
                product_id: Some(info.pid),
                controller: Some(controller),
                generation,
                capture_chip,
                camera_name,
                has_hid,
                has_camera,
                has_audio,
            })
        })
        .collect::<Vec<_>>();
    devices.sort_by(|left, right| left.port_name.cmp(&right.port_name));
    devices
}

fn controller_name(vid: u16, pid: u16) -> Option<&'static str> {
    match (vid, pid) {
        (0x1a86, 0x7523) => Some("CH9329"),
        (0x1a86, 0xfe0c) => Some("CH32V208"),
        _ => None,
    }
}

fn find_serial_node<'a>(
    nodes: &'a [DeviceNode],
    port: &str,
    vid: u16,
    pid: u16,
) -> Option<&'a DeviceNode> {
    let port_upper = port.to_ascii_uppercase();
    let id_fragment = format!("VID_{vid:04X}&PID_{pid:04X}");
    nodes
        .iter()
        .find(|node| {
            let name_matches = node.name.to_ascii_uppercase().contains(&port_upper);
            let id_matches = node.id.to_ascii_uppercase().contains(&id_fragment);
            name_matches && id_matches
        })
        .or_else(|| {
            nodes.iter().find(|node| {
                node.id.to_ascii_uppercase().contains(&id_fragment)
                    && node.name.to_ascii_uppercase().contains("COM")
            })
        })
}

fn associate_video<'a>(serial: &DeviceNode, nodes: &'a [DeviceNode]) -> Option<&'a DeviceNode> {
    let mut candidates = nodes
        .iter()
        .filter(|node| is_capture_device(node))
        .map(|candidate| (candidate, association_score(serial, candidate)))
        .filter(|(_, score)| *score > 0)
        .collect::<Vec<_>>();
    candidates.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    let (best, score) = *candidates.first()?;
    if candidates
        .get(1)
        .is_some_and(|(_, next_score)| *next_score == score)
    {
        return None;
    }
    Some(best)
}

fn association_score(serial: &DeviceNode, capture: &DeviceNode) -> i32 {
    if serial.parent == Some(capture.devinst) || capture.parent == Some(serial.devinst) {
        return 100;
    }
    if serial.parent.is_some() && serial.parent == capture.parent {
        return 90;
    }
    let serial_path = serial.location_paths.first();
    let capture_path = capture.location_paths.first();
    let Some((serial_path, capture_path)) = serial_path.zip(capture_path) else {
        return 0;
    };
    let serial_parts = serial_path.split('#').collect::<Vec<_>>();
    let capture_parts = capture_path.split('#').collect::<Vec<_>>();
    let common = common_location_prefix(serial_path, capture_path);
    let distance = serial_parts.len().abs_diff(capture_parts.len())
        + serial_parts
            .len()
            .min(capture_parts.len())
            .saturating_sub(common);
    let same_hub = common >= 3;
    let proximate = distance <= 2;
    let known_adjacent = serial_parts.len() == capture_parts.len()
        && common + 1 == serial_parts.len()
        && usb_port_number(serial_path)
            .zip(usb_port_number(capture_path))
            .is_some_and(|(left, right)| left.abs_diff(right) == 1);
    if !same_hub && !proximate && !known_adjacent {
        return 0;
    }
    i32::from(same_hub) * 10 + i32::from(proximate) * 5 + i32::from(known_adjacent) * 8
        - distance as i32
}

fn common_location_prefix(left: &str, right: &str) -> usize {
    left.split('#')
        .zip(right.split('#'))
        .take_while(|(a, b)| a.eq_ignore_ascii_case(b))
        .count()
}

fn usb_port_number(path: &str) -> Option<u32> {
    let leaf = path.split('#').last()?;
    leaf.strip_prefix("USB(")?.strip_suffix(')')?.parse().ok()
}

fn generation(serial: Option<&DeviceNode>, capture: &DeviceNode) -> &'static str {
    let capture_id = capture.id.to_ascii_uppercase();
    let controller_id = serial
        .map(|node| node.id.to_ascii_uppercase())
        .unwrap_or_default();
    if capture_id.contains("VID_534D&PID_2109") || controller_id.contains("VID_1A86&PID_7523") {
        "Generation 1"
    } else if serial.is_some_and(|node| node.parent == capture.parent) {
        "Generation 2"
    } else {
        "Generation 3"
    }
}

fn is_capture_device(node: &DeviceNode) -> bool {
    let id = node.id.to_ascii_uppercase();
    (id.contains("VID_534D&PID_2109")
        || id.contains("VID_345F&PID_2109")
        || id.contains("VID_345F&PID_2132")
        || id.contains("VID_345F&PID_0001"))
        && !id.contains("&0004")
}

fn capture_chip(device_id: &str) -> Option<&'static str> {
    let id = device_id.to_ascii_uppercase();
    if id.contains("VID_345F&PID_2132") {
        Some("MS2130S")
    } else if id.contains("VID_345F&PID_0001") {
        Some("MS2130S recovery")
    } else if id.contains("VID_345F&PID_2109") {
        Some("MS2109S")
    } else if id.contains("VID_534D&PID_2109") {
        Some("MS2109")
    } else {
        None
    }
}

fn descendants<'a>(root: &DeviceNode, nodes: &'a [DeviceNode]) -> Vec<&'a DeviceNode> {
    let mut result = Vec::new();
    let mut pending = vec![root.devinst];
    let mut visited = HashSet::new();
    while let Some(parent) = pending.pop() {
        if !visited.insert(parent) {
            continue;
        }
        for node in nodes.iter().filter(|node| node.parent == Some(parent)) {
            result.push(node);
            pending.push(node.devinst);
        }
    }
    result
}

fn is_camera(node: &DeviceNode) -> bool {
    if is_irrelevant_interface(node) {
        return false;
    }
    let text = format!("{} {} {}", node.id, node.class, node.name).to_ascii_lowercase();
    text.contains("mi_00")
        || text.contains("camera")
        || text.contains("image")
        || text.contains("webcam")
}

fn is_hid(node: &DeviceNode) -> bool {
    !is_irrelevant_interface(node)
        && (node.class.eq_ignore_ascii_case("HIDClass")
            || node.id.to_ascii_uppercase().starts_with("HID\\"))
}

fn is_audio(node: &DeviceNode) -> bool {
    if is_irrelevant_interface(node) {
        return false;
    }
    let text = format!("{} {} {}", node.id, node.class, node.name).to_ascii_lowercase();
    node.class.eq_ignore_ascii_case("MEDIA")
        || text.contains("audio")
        || text.contains("sound")
        || text.contains("mi_01")
        || text.contains("mi_02")
}

fn is_irrelevant_interface(node: &DeviceNode) -> bool {
    node.id.to_ascii_uppercase().contains("&0004")
}

fn enumerate_nodes() -> Vec<DeviceNode> {
    let mut root = 0u32;
    // Configuration Manager is read-only here; it enumerates the current PnP tree.
    let result =
        unsafe { CM_Locate_DevNodeW(&mut root, std::ptr::null(), CM_LOCATE_DEVNODE_NORMAL) };
    if result != CR_SUCCESS {
        return Vec::new();
    }
    let mut nodes = Vec::new();
    let mut pending = vec![(root, None)];
    let mut visited = HashSet::new();
    while let Some((devinst, parent)) = pending.pop() {
        if !visited.insert(devinst) {
            continue;
        }
        let node = DeviceNode {
            devinst,
            id: device_id(devinst),
            parent,
            class: registry_strings(devinst, CM_DRP_CLASS)
                .into_iter()
                .next()
                .unwrap_or_default(),
            name: registry_strings(devinst, CM_DRP_FRIENDLYNAME)
                .into_iter()
                .next()
                .or_else(|| {
                    registry_strings(devinst, CM_DRP_DEVICEDESC)
                        .into_iter()
                        .next()
                })
                .unwrap_or_default(),
            location_paths: registry_strings(devinst, CM_DRP_LOCATION_PATHS),
        };
        let mut child = 0u32;
        if unsafe { CM_Get_Child(&mut child, devinst, 0) } == CR_SUCCESS {
            let mut sibling = child;
            loop {
                pending.push((sibling, Some(devinst)));
                let mut next = 0u32;
                if unsafe { CM_Get_Sibling(&mut next, sibling, 0) } != CR_SUCCESS {
                    break;
                }
                sibling = next;
            }
        }
        nodes.push(node);
    }
    nodes
}

fn device_id(devinst: u32) -> String {
    let mut buffer = vec![0u16; 2048];
    let result = unsafe { CM_Get_Device_IDW(devinst, buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if result != CR_SUCCESS {
        return String::new();
    }
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    String::from_utf16_lossy(&buffer[..length])
}

fn registry_strings(devinst: u32, property: u32) -> Vec<String> {
    let mut length = 0u32;
    let mut kind = 0u32;
    let first = unsafe {
        CM_Get_DevNode_Registry_PropertyW(
            devinst,
            property,
            &mut kind,
            std::ptr::null_mut(),
            &mut length,
            0,
        )
    };
    if first != CR_BUFFER_SMALL || length < 2 || length > 64 * 1024 {
        return Vec::new();
    }
    let mut bytes = vec![0u8; length as usize];
    let result = unsafe {
        CM_Get_DevNode_Registry_PropertyW(
            devinst,
            property,
            &mut kind,
            bytes.as_mut_ptr().cast(),
            &mut length,
            0,
        )
    };
    if result != CR_SUCCESS {
        return Vec::new();
    }
    let wide = bytes[..(length as usize).min(bytes.len())]
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect::<Vec<_>>();
    wide.split(|value| *value == 0)
        .filter(|part| !part.is_empty())
        .map(String::from_utf16_lossy)
        .collect()
}
