use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId,
    PeekMessageW, PostThreadMessageW, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx,
    HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, MSG, PM_NOREMOVE, WH_KEYBOARD_LL, WM_KEYDOWN,
    WM_KEYUP, WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
};

const SYSTEM_KEY_EVENT: &str = "system-key-event";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SystemKeyEvent {
    code: String,
    down: bool,
}

struct HookThread {
    thread_id: u32,
    join: JoinHandle<()>,
}

static HOOK_THREAD: OnceLock<Mutex<Option<HookThread>>> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();
static CAPTURE_ACTIVE: AtomicBool = AtomicBool::new(false);
static HOOK_SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);
static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);
static CAPTURE_REQUEST_ID: AtomicU64 = AtomicU64::new(0);

pub fn set_capture(enabled: bool, request_id: u64, app: &AppHandle) -> Result<(), String> {
    if HOOK_SHUTTING_DOWN.load(Ordering::Acquire) {
        return Ok(());
    }
    let thread_state = HOOK_THREAD.get_or_init(|| Mutex::new(None));
    let mut thread_state = thread_state
        .lock()
        .map_err(|_| "System shortcut capture state is unavailable".to_string())?;
    if HOOK_SHUTTING_DOWN.load(Ordering::Acquire) {
        return Ok(());
    }
    if request_id < CAPTURE_REQUEST_ID.load(Ordering::Acquire) {
        return Ok(());
    }
    CAPTURE_REQUEST_ID.store(request_id, Ordering::Release);

    if enabled {
        let _ = APP_HANDLE.set(app.clone());
        if let Some(existing) = thread_state.as_ref() {
            if !existing.join.is_finished() {
                CAPTURE_ACTIVE.store(true, Ordering::Release);
                return Ok(());
            }
        }
        if let Some(finished) = thread_state.take() {
            let _ = finished.join.join();
        }

        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let join = thread::Builder::new()
            .name("openterface-system-keys".to_string())
            .spawn(move || hook_message_loop(ready_tx))
            .map_err(|error| format!("Could not start system shortcut capture: {error}"))?;

        match ready_rx.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(Ok(thread_id)) => {
                CAPTURE_ACTIVE.store(true, Ordering::Release);
                thread_state.replace(HookThread { thread_id, join });
                Ok(())
            }
            Ok(Err(error)) => {
                let _ = join.join();
                Err(error)
            }
            Err(error) => {
                let thread_id = HOOK_THREAD_ID.load(Ordering::Acquire);
                if thread_id != 0 {
                    unsafe {
                        PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
                    }
                }
                let _ = join.join();
                Err(format!("System shortcut capture did not start: {error}"))
            }
        }
    } else {
        CAPTURE_ACTIVE.store(false, Ordering::Release);
        if let Some(active) = thread_state.take() {
            unsafe {
                PostThreadMessageW(active.thread_id, WM_QUIT, 0, 0);
            }
            active
                .join
                .join()
                .map_err(|_| "System shortcut capture thread stopped unexpectedly".to_string())?;
        }
        Ok(())
    }
}

pub fn shutdown_capture() -> Result<(), String> {
    HOOK_SHUTTING_DOWN.store(true, Ordering::Release);
    CAPTURE_REQUEST_ID.store(u64::MAX, Ordering::Release);
    CAPTURE_ACTIVE.store(false, Ordering::Release);

    let Some(thread_state) = HOOK_THREAD.get() else {
        return Ok(());
    };
    let mut thread_state = thread_state
        .lock()
        .map_err(|_| "System shortcut capture state is unavailable".to_string())?;
    if let Some(active) = thread_state.take() {
        unsafe {
            PostThreadMessageW(active.thread_id, WM_QUIT, 0, 0);
        }
        active
            .join
            .join()
            .map_err(|_| "System shortcut capture thread stopped unexpectedly".to_string())?;
    }
    Ok(())
}

fn hook_message_loop(ready: mpsc::SyncSender<Result<u32, String>>) {
    let thread_id = unsafe { GetCurrentThreadId() };
    let mut message: MSG = unsafe { std::mem::zeroed() };
    unsafe {
        PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
    }
    HOOK_THREAD_ID.store(thread_id, Ordering::Release);

    let hook = unsafe {
        SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(low_level_keyboard_proc),
            std::ptr::null_mut(),
            0,
        )
    };
    if hook.is_null() {
        HOOK_THREAD_ID.store(0, Ordering::Release);
        let _ = ready.send(Err(format!(
            "Windows refused the system shortcut hook: {}",
            std::io::Error::last_os_error()
        )));
        return;
    }

    if ready.send(Ok(thread_id)).is_err() {
        unsafe {
            UnhookWindowsHookEx(hook);
        }
        HOOK_THREAD_ID.store(0, Ordering::Release);
        return;
    }

    loop {
        let result = unsafe { GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) };
        if result <= 0 {
            break;
        }
        unsafe {
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    }

    CAPTURE_ACTIVE.store(false, Ordering::Release);
    unsafe {
        UnhookWindowsHookEx(hook);
    }
    HOOK_THREAD_ID.store(0, Ordering::Release);
}

unsafe extern "system" fn low_level_keyboard_proc(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code == HC_ACTION as i32 && CAPTURE_ACTIVE.load(Ordering::Acquire) {
        let foreground = GetForegroundWindow();
        let mut process_id = 0;
        if !foreground.is_null() {
            GetWindowThreadProcessId(foreground, &mut process_id);
        }
        if process_id == GetCurrentProcessId() {
            let key = &*(lparam as *const KBDLLHOOKSTRUCT);
            let injected = key.flags & LLKHF_INJECTED != 0;
            let down = wparam == WM_KEYDOWN as usize || wparam == WM_SYSKEYDOWN as usize;
            let up = wparam == WM_KEYUP as usize || wparam == WM_SYSKEYUP as usize;
            if !injected && (down || up) {
                if let (Some(app), Some(code)) = (
                    APP_HANDLE.get(),
                    code_from_virtual_key(key.vkCode, key.scanCode, key.flags),
                ) {
                    if app
                        .emit(SYSTEM_KEY_EVENT, SystemKeyEvent { code, down })
                        .is_ok()
                    {
                        return 1;
                    }
                }
            }
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

fn code_from_virtual_key(vk: u32, scan_code: u32, flags: u32) -> Option<String> {
    if vk == 0x13 {
        return Some("Pause".to_string());
    }
    if let Some(code) = code_from_scan_code(scan_code, flags) {
        return Some(code.to_string());
    }
    if (0x41..=0x5a).contains(&vk) {
        return char::from_u32(vk).map(|letter| format!("Key{letter}"));
    }
    if (0x30..=0x39).contains(&vk) {
        return char::from_u32(vk).map(|digit| format!("Digit{digit}"));
    }
    if (0x70..=0x87).contains(&vk) {
        return Some(format!("F{}", vk - 0x6f));
    }

    const EXTENDED: u32 = 0x01;
    let extended = flags & EXTENDED != 0;
    Some(
        match vk {
            0x08 => "Backspace",
            0x09 => "Tab",
            0x0d if extended => "NumpadEnter",
            0x0d => "Enter",
            0x10 if scan_code == 0x36 => "ShiftRight",
            0x10 => "ShiftLeft",
            0x11 if extended => "ControlRight",
            0x11 => "ControlLeft",
            0x12 if extended => "AltRight",
            0x12 => "AltLeft",
            0x13 => "Pause",
            0x14 => "CapsLock",
            0x1b => "Escape",
            0x20 => "Space",
            0x21 if extended => "PageUp",
            0x21 => "Numpad9",
            0x22 if extended => "PageDown",
            0x22 => "Numpad3",
            0x23 if extended => "End",
            0x23 => "Numpad1",
            0x24 if extended => "Home",
            0x24 => "Numpad7",
            0x25 if extended => "ArrowLeft",
            0x25 => "Numpad4",
            0x26 if extended => "ArrowUp",
            0x26 => "Numpad8",
            0x27 if extended => "ArrowRight",
            0x27 => "Numpad6",
            0x28 if extended => "ArrowDown",
            0x28 => "Numpad2",
            0x2c => "PrintScreen",
            0x2d if extended => "Insert",
            0x2d => "Numpad0",
            0x2e if extended => "Delete",
            0x2e => "NumpadDecimal",
            0x5b => "MetaLeft",
            0x5c => "MetaRight",
            0x5d => "ContextMenu",
            0x60 => "Numpad0",
            0x61 => "Numpad1",
            0x62 => "Numpad2",
            0x63 => "Numpad3",
            0x64 => "Numpad4",
            0x65 => "Numpad5",
            0x66 => "Numpad6",
            0x67 => "Numpad7",
            0x68 => "Numpad8",
            0x69 => "Numpad9",
            0x6a => "NumpadMultiply",
            0x6b => "NumpadAdd",
            0x6d => "NumpadSubtract",
            0x6e => "NumpadDecimal",
            0x6f => "NumpadDivide",
            0x90 => "NumLock",
            0x91 => "ScrollLock",
            0xba => "Semicolon",
            0xbb => "Equal",
            0xbc => "Comma",
            0xbd => "Minus",
            0xbe => "Period",
            0xbf => "Slash",
            0xc0 => "Backquote",
            0xdb => "BracketLeft",
            0xdc => "Backslash",
            0xdd => "BracketRight",
            0xde => "Quote",
            0xe2 => "IntlBackslash",
            _ => return None,
        }
        .to_string(),
    )
}

fn code_from_scan_code(scan_code: u32, flags: u32) -> Option<&'static str> {
    const EXTENDED: u32 = 0x01;
    let extended = flags & EXTENDED != 0;
    Some(match scan_code {
        0x01 => "Escape",
        0x02 => "Digit1",
        0x03 => "Digit2",
        0x04 => "Digit3",
        0x05 => "Digit4",
        0x06 => "Digit5",
        0x07 => "Digit6",
        0x08 => "Digit7",
        0x09 => "Digit8",
        0x0a => "Digit9",
        0x0b => "Digit0",
        0x0c => "Minus",
        0x0d => "Equal",
        0x0e => "Backspace",
        0x0f => "Tab",
        0x10 => "KeyQ",
        0x11 => "KeyW",
        0x12 => "KeyE",
        0x13 => "KeyR",
        0x14 => "KeyT",
        0x15 => "KeyY",
        0x16 => "KeyU",
        0x17 => "KeyI",
        0x18 => "KeyO",
        0x19 => "KeyP",
        0x1a => "BracketLeft",
        0x1b => "BracketRight",
        0x1c if extended => "NumpadEnter",
        0x1c => "Enter",
        0x1d if extended => "ControlRight",
        0x1d => "ControlLeft",
        0x1e => "KeyA",
        0x1f => "KeyS",
        0x20 => "KeyD",
        0x21 => "KeyF",
        0x22 => "KeyG",
        0x23 => "KeyH",
        0x24 => "KeyJ",
        0x25 => "KeyK",
        0x26 => "KeyL",
        0x27 => "Semicolon",
        0x28 => "Quote",
        0x29 => "Backquote",
        0x2a => "ShiftLeft",
        0x2b => "Backslash",
        0x2c => "KeyZ",
        0x2d => "KeyX",
        0x2e => "KeyC",
        0x2f => "KeyV",
        0x30 => "KeyB",
        0x31 => "KeyN",
        0x32 => "KeyM",
        0x33 => "Comma",
        0x34 => "Period",
        0x35 if extended => "NumpadDivide",
        0x35 => "Slash",
        0x36 => "ShiftRight",
        0x37 if extended => "PrintScreen",
        0x37 => "NumpadMultiply",
        0x38 if extended => "AltRight",
        0x38 => "AltLeft",
        0x39 => "Space",
        0x3a => "CapsLock",
        0x3b => "F1",
        0x3c => "F2",
        0x3d => "F3",
        0x3e => "F4",
        0x3f => "F5",
        0x40 => "F6",
        0x41 => "F7",
        0x42 => "F8",
        0x43 => "F9",
        0x44 => "F10",
        0x45 => "NumLock",
        0x46 => "ScrollLock",
        0x47 if extended => "Home",
        0x47 => "Numpad7",
        0x48 if extended => "ArrowUp",
        0x48 => "Numpad8",
        0x49 if extended => "PageUp",
        0x49 => "Numpad9",
        0x4a => "NumpadSubtract",
        0x4b if extended => "ArrowLeft",
        0x4b => "Numpad4",
        0x4c => "Numpad5",
        0x4d if extended => "ArrowRight",
        0x4d => "Numpad6",
        0x4e => "NumpadAdd",
        0x4f if extended => "End",
        0x4f => "Numpad1",
        0x50 if extended => "ArrowDown",
        0x50 => "Numpad2",
        0x51 if extended => "PageDown",
        0x51 => "Numpad3",
        0x52 if extended => "Insert",
        0x52 => "Numpad0",
        0x53 if extended => "Delete",
        0x53 => "NumpadDecimal",
        0x56 => "IntlBackslash",
        0x57 => "F11",
        0x58 => "F12",
        0x5b if extended => "MetaLeft",
        0x5c if extended => "MetaRight",
        0x5d if extended => "ContextMenu",
        _ => return None,
    })
}
