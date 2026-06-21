// Mounted-volume enumeration via Kernel32 — each drive's type, label, filesystem, and total/free bytes, natively (no
// `wmic logicaldisk` / Get-Volume / Get-PSDrive shell). Read-only. GetLogicalDriveStringsW lists the roots;
// GetDriveTypeW classifies each; GetDiskFreeSpaceExW reads free/total (skipped cleanly for an empty CD/card reader);
// GetVolumeInformationW reads the label + filesystem. Complements get_displays / system_resources as a system-state read.

import Kernel32 from '@bun-win32/kernel32';

const DRIVE_TYPES: Record<number, string> = { 0: 'unknown', 1: 'no-root', 2: 'removable', 3: 'fixed', 4: 'network', 5: 'cd-rom', 6: 'ram-disk' };

export interface VolumeInfo {
  drive: string; // e.g. "C:\"
  type: string; // fixed / removable / network / cd-rom / ram-disk
  label: string; // volume label, '' when none / unavailable
  filesystem: string; // NTFS / FAT32 / exFAT, '' when unavailable
  totalBytes: bigint; // 0n when the drive has no media (not ready)
  freeBytes: bigint; // free bytes available to the caller; 0n when not ready
  ready: boolean; // false for an empty optical / card reader (GetDiskFreeSpaceExW failed)
}

/** Every mounted logical volume: drive root, type, label, filesystem, total + free bytes. [] if none enumerable.
 *  Read-only — pure Kernel32 queries (no COM, no window, no elevation for the user's own drives). */
export function listVolumes(): VolumeInfo[] {
  const buffer = Buffer.alloc(512); // 256 WCHARs — far above the 26-drive max ("C:\<NUL>" per root)
  const length = Kernel32.GetLogicalDriveStringsW(256, buffer.ptr!); // returns chars copied (excl. the final NUL)
  if (length === 0) return [];
  const roots = buffer.toString('utf16le', 0, length * 2).split('\0').filter((entry) => entry.length > 0);
  const ignored = Buffer.alloc(4); // the three GetVolumeInformationW out-params we discard (serial / max-component-len / fs-flags) — each a DWORD the API writes; the binding types them non-nullable LPVOID (MS Learn documents them LPDWORD _Out_opt_, see TODO.md), so we pass one writable 4-byte scratch they harmlessly overwrite rather than NULL
  const volumes: VolumeInfo[] = [];
  for (const drive of roots) {
    const rootWide = Buffer.from(`${drive}\0`, 'utf16le');
    const type = Kernel32.GetDriveTypeW(rootWide.ptr!);
    const freeAvailable = Buffer.alloc(8);
    const total = Buffer.alloc(8);
    const totalFree = Buffer.alloc(8);
    const ready = Kernel32.GetDiskFreeSpaceExW(rootWide.ptr!, freeAvailable.ptr!, total.ptr!, totalFree.ptr!) !== 0; // 0 → no media (empty reader)
    const volumeName = Buffer.alloc(522); // 260 WCHAR + NUL
    const fileSystemName = Buffer.alloc(522);
    const gotInfo = Kernel32.GetVolumeInformationW(rootWide.ptr!, volumeName.ptr!, 261, ignored.ptr!, ignored.ptr!, ignored.ptr!, fileSystemName.ptr!, 261) !== 0;
    volumes.push({
      drive,
      type: DRIVE_TYPES[type] ?? `type-${type}`,
      label: gotInfo ? (volumeName.toString('utf16le').split('\0')[0] ?? '') : '',
      filesystem: gotInfo ? (fileSystemName.toString('utf16le').split('\0')[0] ?? '') : '',
      totalBytes: ready ? total.readBigUInt64LE(0) : 0n,
      freeBytes: ready ? freeAvailable.readBigUInt64LE(0) : 0n,
      ready,
    });
  }
  return volumes;
}
