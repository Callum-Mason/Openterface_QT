import { useState } from "react";
import { Cpu, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { open as openFile } from "@tauri-apps/plugin-fs";
import type { WchDeviceSummary } from "../types";
import { Dialog } from "./Dialog";

type WchFirmwareDialogProps = {
  open: boolean;
  onClose: () => void;
};

const MAX_IMAGE_BYTES = 512 * 1024;

export function WchFirmwareDialog({ open, onClose }: WchFirmwareDialogProps) {
  const [devices, setDevices] = useState<WchDeviceSummary[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [image, setImage] = useState<{ fileName: string; bytes: Uint8Array } | null>(null);
  const [scanning, setScanning] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const busy = scanning || flashing;
  const selected = devices.find((device) => device.index === selectedIndex) ?? null;

  if (!open) return null;

  const scan = async () => {
    setScanning(true);
    setError("");
    setMessage("");
    try {
      const found = await invoke<WchDeviceSummary[]>("scan_wch_firmware_devices");
      setDevices(found);
      setSelectedIndex(found[0]?.index ?? null);
      if (!found.length) setMessage("No WCH ISP bootloader was found. Connect the controller in ISP mode and check the WCH CH375 driver.");
    } catch (cause) {
      setDevices([]);
      setSelectedIndex(null);
      setError(String(cause));
    } finally {
      setScanning(false);
    }
  };

  const browse = async () => {
    setError("");
    try {
      const path = await openDialog({ multiple: false, directory: false, filters: [{ name: "WCH firmware", extensions: ["hex", "bin"] }] });
      if (typeof path !== "string") return;
      const file = await openFile(path, { read: true });
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        const buffer = new Uint8Array(8192);
        while (true) {
          const count = await file.read(buffer);
          if (!count) break;
          total += count;
          if (total > MAX_IMAGE_BYTES) throw new Error("Firmware file exceeds the 512 KiB safety limit.");
          chunks.push(buffer.slice(0, count));
        }
      } finally {
        await file.close();
      }
      if (!total) throw new Error("Firmware file is empty.");
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      setImage({ fileName: path.split(/[\\/]/).pop() || "firmware.bin", bytes });
      setMessage("");
    } catch (cause) {
      setError(String(cause));
    }
  };

  const flash = async () => {
    if (!selected || !image) return;
    setFlashing(true);
    setError("");
    setMessage("Erasing, programming, verifying, and restarting the controller…");
    try {
      const result = await invoke<string>("flash_wch_firmware", {
        index: selected.index,
        chipId: selected.chipId,
        deviceType: selected.deviceType,
        firmware: Array.from(image.bytes),
      });
      setMessage(result);
      setConfirmOpen(false);
      setDevices([]);
      setSelectedIndex(null);
    } catch (cause) {
      setError(String(cause));
      setConfirmOpen(false);
    } finally {
      setFlashing(false);
    }
  };

  return <>
    <Dialog
      titleId="wch-firmware-title"
      title="WCH controller firmware"
      subtitle="Program a CH32 controller in WCH ISP bootloader mode."
      closeLabel="Close WCH firmware"
      onClose={onClose}
      busy={busy}
      size="md"
      footer={<>
        <span className="dialog-footer-note" role="status">{busy ? (scanning ? "Scanning WCH ISP devices…" : "Do not disconnect the controller during programming.") : "Flashing erases and rewrites the controller code flash."}</span>
        <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Close</button>
        <button className="button button-danger" type="button" onClick={() => setConfirmOpen(true)} disabled={busy || !selected || !image}>Flash, verify &amp; reset</button>
      </>}
    >
      <section className="firmware-summary">
        <div className="firmware-chip-icon"><Cpu size={19} aria-hidden="true" /></div>
        <dl className="kv-list">
          <div><dt>ISP device</dt><dd>{selected?.chipName ?? "Not connected"}</dd></div>
          <div><dt>Code flash</dt><dd>{selected ? `${Math.round(selected.flashSizeBytes / 1024)} KiB` : "—"}</dd></div>
          <div><dt>Firmware file</dt><dd className="mono">{image?.fileName ?? "Not selected"}</dd></div>
          {image && <div><dt>Image size</dt><dd>{image.bytes.length.toLocaleString()} bytes</dd></div>}
        </dl>
      </section>
      <div className="firmware-actions">
        <button className="button button-secondary" type="button" onClick={() => void scan()} disabled={busy}>
          <RefreshCw size={14} className={scanning ? "spin" : ""} />{scanning ? "Scanning…" : "Scan ISP devices"}
        </button>
        {devices.length > 0 && <label className="field-label">Device
          <select className="select" value={selectedIndex ?? ""} onChange={(event) => setSelectedIndex(Number(event.target.value))} disabled={busy}>
            {devices.map((device) => <option key={`${device.index}:${device.chipId}:${device.deviceType}`} value={device.index}>{device.chipName} · ISP index {device.index}</option>)}
          </select>
        </label>}
        <button className="button button-secondary" type="button" onClick={() => void browse()} disabled={busy}>Choose .hex or .bin</button>
      </div>
      {message && <p className="firmware-message" role="status">{message}</p>}
      {error && <p className="firmware-error" role="alert">{error}</p>}
      <p className="firmware-note">Windows uses WCH’s CH375 driver and CH375DLL64.DLL. Protected code flash must be unprotected with WCH’s ISP utility before flashing here.</p>
    </Dialog>
    {confirmOpen && <Dialog
      titleId="wch-firmware-confirm-title"
      title="Erase and flash the controller?"
      describedBy="wch-firmware-confirm-copy"
      closeLabel="Close WCH flash confirmation"
      onClose={() => setConfirmOpen(false)}
      busy={flashing}
      alert
      size="sm"
      footer={<>
        <button className="button button-secondary" type="button" onClick={() => setConfirmOpen(false)} disabled={flashing}>Cancel</button>
        <button className="button button-danger" type="button" onClick={() => void flash()} disabled={flashing}>{flashing ? "Flashing…" : "Flash controller"}</button>
      </>}
    >
      <p id="wch-firmware-confirm-copy">This erases and overwrites the connected <span className="mono">{selected?.chipName ?? "WCH controller"}</span> with <span className="mono">{image?.fileName ?? "the selected image"}</span>. If code flash is protected, the app clears its read protection and resets the controller first. Keep it connected until verification and reset finish.</p>
    </Dialog>}
  </>;
}
