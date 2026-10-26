# Openterface Mini-KVM Desktop (Tauri)

This is the Rust and React desktop application for the Windows x64 migration. Rust owns serial device discovery and CH9329/CH32V208 input reports; React renders the control desk and the Windows WebView2 camera stream.

## Windows development prerequisites

- Windows 10 or 11 x64
- Rust 1.90 or newer with the `x86_64-pc-windows-msvc` target
- Microsoft C++ Build Tools with the Desktop development with C++ workload
- Node.js 20 or newer and npm
- WebView2 Runtime (included with supported Windows 10/11 installations)

## Run the desktop app

From this directory:

```powershell
npm ci
npm run tauri -- dev
```

Build the Windows x64 NSIS installer:

```powershell
npm ci
npm run tauri -- build --target x86_64-pc-windows-msvc --bundles nsis
```

The installer is written under `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`.

## Current KVM slice

- Enumerates Windows Plug and Play devices and matches the CH9329 (`1A86:7523`) or CH32V208 (`1A86:FE0C`) COM port to a related Mini-KVM capture device.
- Identifies the three supported device generations, associated capture-chip family (including MS2130S recovery mode), and camera, HID, and audio interfaces where Windows exposes them in the same device topology.
- Probes CH9329 at 9600 then 115200 baud with the read-only `GET_INFO` command. CH32V208 uses 115200 baud, resets its HID interface during startup, then retries `GET_INFO` before reporting a connection.
- Grants the app WebView camera permission for UVC capture; other WebView permission requests retain the runtime default.
- Captures a connected UVC video input through WebView2 camera access.
- Routes audio from a selected Openterface capture input to the Windows default output with an explicit live-audio toggle and saved output volume. Audio capture permission is requested when live pass-through is enabled or when a recording starts with audio enabled.
- Sends keyboard and absolute or relative mouse reports over the connected controller, including clipboard text through the selected keyboard layout.
- Supports CH9329 baud-rate changes, controller operating-mode changes, serial reconnect, USB routing, and an RTS hardware factory reset; CH32V208 remains limited to its supported 115200 baud mode.
- Saves target screenshots and records WebM from the selected capture source. Recording can pause, resume, and stop, follows the selected capture-quality and video bitrate preferences, and can optionally include audio from the selected capture input with configurable bitrate and preferred sample rate. It prompts for a save location in the Windows Videos folder by default and remembers the last location; pending writes finish before the app closes. WebView2 selects the WebM codec and pixel format.
- Saves device preferences, capture quality, controller mode, mouse behavior, keyboard layout, Windows shortcut capture, and screen-saver behavior.
- Offers English and 12 additional locale choices in Preferences, starts in English, remembers the selected language, and loads its existing Qt catalog on demand. Text without a matching catalog entry remains in English while coverage is expanded.
- Provides a copyable environment report with the app/runtime version, controller and target status, selected video source, and capture settings (`Ctrl+E`).
- Provides live controller, target, video, audio, and WebM availability checks with a copyable diagnostic report. Physical USB hotplug checks and serial stress testing remain manual.
- Reads the installed version from the associated MS2109, MS2109S, or MS2130S capture chip through its matched Windows HID interface. Checks the official firmware index, stages the matching package in memory, and supports confirmed EEPROM firmware writes, `.bin` backups, and restores for MS2109 and MS2109S. MS2130S SPI updates and restores are supported with readback verification; SPI backup and recovery-mode flashing remain unavailable. The Application menu can scan WCH ISP devices, parse `.hex` or `.bin` images, erase/program code flash, verify it, and reset supported WCH controllers. WCH flashing requires the installed 64-bit CH375 driver and `CH375DLL64.DLL`; protected code flash must first be unprotected with WCH's ISP utility.
- Manually checks the latest stable GitHub release (`Ctrl+U`), shows a version comparison and release-note excerpt, and lets the user open the releases page. Updates are not downloaded or installed by the app.
- Offers a persistent, opt-in system-shortcut capture toggle for Alt+Tab and the Windows key while target control is active. The hook only runs while connected and the target view is active; Ctrl+Alt+Delete remains reserved by Windows.

The React console uses the associated camera name as a capture-selection hint, with a device-label fallback when Windows does not report a matching name. Video sources remain selectable after capture errors; a lost capture track reports the disconnect and refreshes available inputs. Pending camera requests are invalidated when the controller disconnects, preventing a late permission response from reopening video. Physical device discovery, camera and microphone permissions, video, audio, target input, recording, and all capture-chip and WCH firmware operations still need validation on a Windows host with Mini-KVM hardware attached. Qt's interactive hotplug, reset, baud-rate, and serial stress diagnostics, and development tools have not been ported yet; translation coverage will continue to expand as the remaining UI moves over.

The Qt implementation remains in the repository during the staged port so each hardware path can be replaced and reviewed without losing the current protocol reference.
