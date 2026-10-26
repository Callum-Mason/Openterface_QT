use std::sync::{Mutex, OnceLock};
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::Power::{
    PowerClearRequest, PowerCreateRequest, PowerRequestDisplayRequired, PowerRequestSystemRequired,
    PowerSetRequest,
};
use windows_sys::Win32::System::Threading::{
    POWER_REQUEST_CONTEXT_SIMPLE_STRING, REASON_CONTEXT, REASON_CONTEXT_0,
};

static POWER_REQUEST: OnceLock<Mutex<Option<isize>>> = OnceLock::new();

fn power_request() -> &'static Mutex<Option<isize>> {
    POWER_REQUEST.get_or_init(|| Mutex::new(None))
}

fn create_request() -> Result<HANDLE, String> {
    let mut reason = "Openterface Mini-KVM is in use\0"
        .encode_utf16()
        .collect::<Vec<_>>();
    let context = REASON_CONTEXT {
        Version: 0,
        Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
        Reason: REASON_CONTEXT_0 {
            SimpleReasonString: reason.as_mut_ptr(),
        },
    };
    let request = unsafe { PowerCreateRequest(&context) };
    if request.is_null() || request as isize == -1 {
        Err("Windows could not create a display power request".to_string())
    } else {
        Ok(request)
    }
}

pub fn set_inhibited(inhibited: bool) -> Result<(), String> {
    let mut stored = power_request()
        .lock()
        .map_err(|_| "Windows power preference is unavailable".to_string())?;

    if !inhibited {
        if let Some(raw_handle) = stored.take() {
            let request = raw_handle as HANDLE;
            unsafe {
                PowerClearRequest(request, PowerRequestDisplayRequired);
                PowerClearRequest(request, PowerRequestSystemRequired);
                CloseHandle(request);
            }
        }
        return Ok(());
    }

    if stored.is_none() {
        let request = create_request()?;
        let display_set = unsafe { PowerSetRequest(request, PowerRequestDisplayRequired) };
        let system_set = unsafe { PowerSetRequest(request, PowerRequestSystemRequired) };
        if display_set == 0 || system_set == 0 {
            unsafe {
                PowerClearRequest(request, PowerRequestDisplayRequired);
                PowerClearRequest(request, PowerRequestSystemRequired);
                CloseHandle(request);
            }
            return Err("Windows could not apply the display power request".to_string());
        }
        *stored = Some(request as isize);
    }

    Ok(())
}
