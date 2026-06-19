// Windows registry READ via Advapi32 — the config hive an AI configuring Windows needs (install paths, OS/app
// versions, policy + HKCU preferences), with no `reg query` / Get-ItemProperty shell. Two-pass sizing (RegQueryValueExW
// with a NULL data buffer to learn size+type, then the real read), value decoded by RegType. Zero new bindings — every
// Reg* call is already in @bun-win32/advapi32 (the package element/window.ts already imports for the token path).

import Advapi32, { HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, HKEY_USERS, RegKeyAccessRights, RegType } from '@bun-win32/advapi32';

const ERROR_SUCCESS = 0;
const ERROR_MORE_DATA = 234;
const ERROR_NO_MORE_ITEMS = 259;
const LIST_DATA_CAP = 16_384; // per-value data cap for the enumerate path (a single value's bytes); registryGet sizes exactly

export type RegistryHive = 'HKLM' | 'HKCU' | 'HKCR' | 'HKU';
/** A decoded registry datum — REG_SZ/EXPAND_SZ → string, REG_DWORD/BIG_ENDIAN → number, REG_QWORD → bigint, REG_MULTI_SZ → string[], everything else (REG_BINARY / resource lists) → a lowercase hex string. */
export type RegistryData = string | number | bigint | string[];

export interface RegistryValue {
  name: string;
  type: string; // the RegType name, e.g. 'REG_SZ'
  value: RegistryData;
}

/** Parse a hive string into the typed hive, or null — keeps the handler cast-free. */
export function parseHive(value: string): RegistryHive | null {
  const upper = value.toUpperCase();
  return upper === 'HKLM' || upper === 'HKCU' || upper === 'HKCR' || upper === 'HKU' ? upper : null;
}

function decodeRegistryValue(type: number, data: Buffer): RegistryData {
  switch (type) {
    case RegType.REG_SZ:
    case RegType.REG_EXPAND_SZ:
    case RegType.REG_LINK:
      return data.toString('utf16le').replace(/\0+$/, '');
    case RegType.REG_DWORD:
      return data.length >= 4 ? data.readUInt32LE(0) : 0;
    case RegType.REG_DWORD_BIG_ENDIAN:
      return data.length >= 4 ? data.readUInt32BE(0) : 0;
    case RegType.REG_QWORD:
      return data.length >= 8 ? data.readBigUInt64LE(0) : 0n;
    case RegType.REG_MULTI_SZ:
      return data.toString('utf16le').split('\0').filter((entry) => entry.length > 0);
    default:
      return data.toString('hex'); // REG_BINARY / resource lists / NONE
  }
}

/** Open a subkey under a hive. Returns the opened HKEY (bigint), or 0n if it cannot be opened. Caller MUST RegCloseKey. */
function openKey(hive: RegistryHive, key: string, access: number): bigint {
  const root = hive === 'HKLM' ? HKEY_LOCAL_MACHINE : hive === 'HKCU' ? HKEY_CURRENT_USER : hive === 'HKCR' ? HKEY_CLASSES_ROOT : HKEY_USERS;
  const subkey = Buffer.from(`${key}\0`, 'utf16le');
  const handleOut = Buffer.alloc(8);
  if (Advapi32.RegOpenKeyExW(root, subkey.ptr!, 0, access, handleOut.ptr!) !== ERROR_SUCCESS) return 0n;
  return handleOut.readBigUInt64LE(0);
}

/** Read ONE registry value (two-pass: size query then read). null if the key/value is absent or inaccessible. */
export function registryGet(hive: RegistryHive, key: string, valueName: string): RegistryValue | null {
  const handle = openKey(hive, key, RegKeyAccessRights.KEY_READ);
  if (handle === 0n) return null;
  try {
    const name = Buffer.from(`${valueName}\0`, 'utf16le');
    const typeOut = Buffer.alloc(4);
    const sizeOut = Buffer.alloc(4);
    if (Advapi32.RegQueryValueExW(handle, name.ptr!, null, typeOut.ptr!, null, sizeOut.ptr!) !== ERROR_SUCCESS) return null; // value missing
    const data = Buffer.alloc(sizeOut.readUInt32LE(0));
    if (Advapi32.RegQueryValueExW(handle, name.ptr!, null, typeOut.ptr!, data.ptr!, sizeOut.ptr!) !== ERROR_SUCCESS) return null;
    const type = typeOut.readUInt32LE(0);
    return { name: valueName, type: RegType[type] ?? `0x${type.toString(16)}`, value: decodeRegistryValue(type, data) };
  } finally {
    Advapi32.RegCloseKey(handle);
  }
}

/** Enumerate a key's immediate subkeys + values (name/type/decoded data). null if the key is absent or inaccessible. */
export function registryList(hive: RegistryHive, key: string): { subkeys: string[]; values: RegistryValue[] } | null {
  const handle = openKey(hive, key, RegKeyAccessRights.KEY_READ);
  if (handle === 0n) return null;
  try {
    const subkeys: string[] = [];
    const subkeyName = Buffer.alloc(514); // 256 WCHARs + NUL — the registry key-name max is 255
    for (let index = 0; ; index += 1) {
      const nameLength = Buffer.alloc(4);
      nameLength.writeUInt32LE(256, 0); // capacity in WCHARs (excludes the NUL it writes)
      const status = Advapi32.RegEnumKeyExW(handle, index, subkeyName.ptr!, nameLength.ptr!, null, null, null, null);
      if (status !== ERROR_SUCCESS) break; // ERROR_NO_MORE_ITEMS or any error ends the walk
      subkeys.push(subkeyName.toString('utf16le', 0, nameLength.readUInt32LE(0) * 2));
    }
    const values: RegistryValue[] = [];
    const valueName = Buffer.alloc(32_770); // 16383 WCHARs + NUL — the value-name max
    const valueData = Buffer.alloc(LIST_DATA_CAP);
    for (let index = 0; ; index += 1) {
      const nameLength = Buffer.alloc(4);
      nameLength.writeUInt32LE(16_384, 0);
      const typeOut = Buffer.alloc(4);
      const dataLength = Buffer.alloc(4);
      dataLength.writeUInt32LE(LIST_DATA_CAP, 0);
      const status = Advapi32.RegEnumValueW(handle, index, valueName.ptr!, nameLength.ptr!, null, typeOut.ptr!, valueData.ptr!, dataLength.ptr!);
      if (status === ERROR_NO_MORE_ITEMS) break;
      if (status !== ERROR_SUCCESS && status !== ERROR_MORE_DATA) break; // MORE_DATA = a value bigger than the cap; keep the truncated bytes
      const name = valueName.toString('utf16le', 0, nameLength.readUInt32LE(0) * 2);
      const type = typeOut.readUInt32LE(0);
      const data = valueData.subarray(0, Math.min(dataLength.readUInt32LE(0), LIST_DATA_CAP));
      values.push({ name: name.length > 0 ? name : '(default)', type: RegType[type] ?? `0x${type.toString(16)}`, value: decodeRegistryValue(type, data) });
    }
    return { subkeys, values };
  } finally {
    Advapi32.RegCloseKey(handle);
  }
}
