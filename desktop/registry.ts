// Windows registry READ via Advapi32 — the config hive an AI configuring Windows needs (install paths, OS/app
// versions, policy + HKCU preferences), with no `reg query` / Get-ItemProperty shell. Two-pass sizing (RegQueryValueExW
// with a NULL data buffer to learn size+type, then the real read), value decoded by RegType. Zero new bindings — every
// Reg* call is already in @bun-win32/advapi32 (the package element/window.ts already imports for the token path).

import Advapi32, { HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, HKEY_USERS, RegDisposition, RegKeyAccessRights, RegOption, RegType } from '@bun-win32/advapi32';

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
    // RegEnum* lpcch/lpcbData are in/out length scalars: each is reset to its capacity (or API-overwritten, for the
    // output-only type) before every read, so reusing one buffer per call is byte-identical to allocating fresh.
    // registryList is synchronous (no await) → these are never reentrant, and the three are never aliased within a call.
    const nameLength = Buffer.alloc(4);
    const typeOut = Buffer.alloc(4);
    const dataLength = Buffer.alloc(4);
    const subkeys: string[] = [];
    const subkeyName = Buffer.alloc(514); // 256 WCHARs + NUL — the registry key-name max is 255
    for (let index = 0; ; index += 1) {
      nameLength.writeUInt32LE(256, 0); // capacity in WCHARs (excludes the NUL it writes)
      const status = Advapi32.RegEnumKeyExW(handle, index, subkeyName.ptr!, nameLength.ptr!, null, null, null, null);
      if (status !== ERROR_SUCCESS) break; // ERROR_NO_MORE_ITEMS or any error ends the walk
      subkeys.push(subkeyName.toString('utf16le', 0, nameLength.readUInt32LE(0) * 2));
    }
    const values: RegistryValue[] = [];
    const valueName = Buffer.alloc(32_770); // 16383 WCHARs + NUL — the value-name max
    const valueData = Buffer.alloc(LIST_DATA_CAP);
    for (let index = 0; ; index += 1) {
      nameLength.writeUInt32LE(16_384, 0);
      dataLength.writeUInt32LE(LIST_DATA_CAP, 0);
      const status = Advapi32.RegEnumValueW(handle, index, valueName.ptr!, nameLength.ptr!, null, typeOut.ptr!, valueData.ptr!, dataLength.ptr!);
      if (status === ERROR_NO_MORE_ITEMS) break;
      if (status === ERROR_MORE_DATA) {
        // The value's data exceeds LIST_DATA_CAP. On MORE_DATA RegEnumValueW leaves the NAME buffer + lpcchValueName
        // STALE (the PRIOR value's), so decoding here would emit a corrupt duplicate and LOSE this value's real name
        // (HKLM\…\Session Manager\Environment\Path is commonly > the cap). Re-query name+type ONLY (lpData/lpcbData =
        // null → no MORE_DATA) to recover the true name, and mark it oversized — read it whole with registry_get.
        const requiredBytes = dataLength.readUInt32LE(0);
        nameLength.writeUInt32LE(16_384, 0);
        if (Advapi32.RegEnumValueW(handle, index, valueName.ptr!, nameLength.ptr!, null, typeOut.ptr!, null, null) !== ERROR_SUCCESS) continue;
        const oversizedType = typeOut.readUInt32LE(0);
        const oversizedName = valueName.toString('utf16le', 0, nameLength.readUInt32LE(0) * 2);
        values.push({ name: oversizedName.length > 0 ? oversizedName : '(default)', type: RegType[oversizedType] ?? `0x${oversizedType.toString(16)}`, value: `(${requiredBytes} bytes — too large to list; read it by name with registry_get)` });
        continue;
      }
      if (status !== ERROR_SUCCESS) break;
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

/** Set a string (REG_SZ / REG_EXPAND_SZ) value on an EXISTING key. true on success, false on access-denied / error.
 *  (env_var's user/machine persistent writes go through here — the Environment keys always exist, so no create.) */
export function registrySetString(hive: RegistryHive, key: string, valueName: string, value: string, expandable: boolean): boolean {
  const handle = openKey(hive, key, RegKeyAccessRights.KEY_SET_VALUE);
  if (handle === 0n) return false;
  try {
    const name = Buffer.from(`${valueName}\0`, 'utf16le');
    const data = Buffer.from(`${value}\0`, 'utf16le');
    return Advapi32.RegSetValueExW(handle, name.ptr!, 0, expandable ? RegType.REG_EXPAND_SZ : RegType.REG_SZ, data.ptr!, data.length) === ERROR_SUCCESS;
  } finally {
    Advapi32.RegCloseKey(handle);
  }
}

/** Delete a registry value. true on success, false on access-denied / not-found. */
export function registryDeleteValue(hive: RegistryHive, key: string, valueName: string): boolean {
  const handle = openKey(hive, key, RegKeyAccessRights.KEY_SET_VALUE);
  if (handle === 0n) return false;
  try {
    const name = Buffer.from(`${valueName}\0`, 'utf16le');
    return Advapi32.RegDeleteValueW(handle, name.ptr!) === ERROR_SUCCESS;
  } finally {
    Advapi32.RegCloseKey(handle);
  }
}

export type RegistryWriteType = 'REG_SZ' | 'REG_EXPAND_SZ' | 'REG_DWORD' | 'REG_QWORD' | 'REG_MULTI_SZ';

/** Encode `data` for a registry write per `type`, or null if the data does not match the type (the validation gate —
 *  a DWORD must be a 0..2^32-1 integer, a MULTI_SZ a string[], etc.). REG_QWORD accepts a number or a numeric string. */
function encodeRegistryWrite(type: RegistryWriteType, data: unknown): { buffer: Buffer; regType: number } | null {
  switch (type) {
    case 'REG_SZ':
    case 'REG_EXPAND_SZ':
      return typeof data === 'string' ? { buffer: Buffer.from(`${data}\0`, 'utf16le'), regType: type === 'REG_EXPAND_SZ' ? RegType.REG_EXPAND_SZ : RegType.REG_SZ } : null;
    case 'REG_DWORD': {
      if (typeof data !== 'number' || !Number.isInteger(data) || data < 0 || data > 0xffff_ffff) return null;
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32LE(data, 0);
      return { buffer, regType: RegType.REG_DWORD };
    }
    case 'REG_QWORD': {
      if (typeof data !== 'number' && typeof data !== 'string') return null;
      let value: bigint;
      try {
        value = BigInt(data); // throws on a non-integer number / non-numeric string → caught
      } catch {
        return null;
      }
      if (value < 0n || value > 0xffff_ffff_ffff_ffffn) return null;
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64LE(value, 0);
      return { buffer, regType: RegType.REG_QWORD };
    }
    case 'REG_MULTI_SZ': {
      if (!Array.isArray(data) || data.some((entry) => typeof entry !== 'string')) return null;
      const block = `${data.map((entry) => `${String(entry)}\0`).join('')}\0`; // each string NUL-terminated, the block double-NUL-terminated
      return { buffer: Buffer.from(block, 'utf16le'), regType: RegType.REG_MULTI_SZ };
    }
    default:
      return null;
  }
}

/** Write a typed value to an EXISTING key (set_env's scoped writes are the REG_SZ special case; this is the general
 *  writer behind registry_set). true on success; false if the key doesn't exist, the data fails type validation, or
 *  the write is access-denied (HKLM / protected keys need elevation). */
export function registrySet(hive: RegistryHive, key: string, valueName: string, type: RegistryWriteType, data: unknown): boolean {
  const encoded = encodeRegistryWrite(type, data);
  if (encoded === null) return false;
  const handle = openKey(hive, key, RegKeyAccessRights.KEY_SET_VALUE);
  if (handle === 0n) return false;
  try {
    const name = Buffer.from(`${valueName}\0`, 'utf16le');
    return Advapi32.RegSetValueExW(handle, name.ptr!, 0, encoded.regType, encoded.buffer.ptr!, encoded.buffer.length) === ERROR_SUCCESS;
  } finally {
    Advapi32.RegCloseKey(handle);
  }
}

/** Create a registry KEY (and any missing intermediate keys in the path) under a hive — the half registrySet lacks
 *  (registrySet writes a VALUE on an EXISTING key, so a brand-new HKCU\Software\<App> subtree must be created first).
 *  Returns 'created' (newly made) or 'existed' (RegCreateKeyExW opens a present key), or null on access-denied / error. */
export function registryCreateKey(hive: RegistryHive, key: string): 'created' | 'existed' | null {
  const root = hive === 'HKLM' ? HKEY_LOCAL_MACHINE : hive === 'HKCU' ? HKEY_CURRENT_USER : hive === 'HKCR' ? HKEY_CLASSES_ROOT : HKEY_USERS;
  const subkey = Buffer.from(`${key}\0`, 'utf16le');
  const handleOut = Buffer.alloc(8);
  const dispositionOut = Buffer.alloc(4);
  if (Advapi32.RegCreateKeyExW(root, subkey.ptr!, 0, null, RegOption.REG_OPTION_NON_VOLATILE, RegKeyAccessRights.KEY_WRITE, null, handleOut.ptr!, dispositionOut.ptr!) !== ERROR_SUCCESS) return null;
  Advapi32.RegCloseKey(handleOut.readBigUInt64LE(0)); // the create returns an open handle; we only needed the key made
  return dispositionOut.readUInt32LE(0) === RegDisposition.REG_CREATED_NEW_KEY ? 'created' : 'existed';
}

/** Delete a registry KEY. {recursive} → RegDeleteTreeW, which removes the named key AND its entire subtree (verified
 *  live: it deletes the key itself, not just its descendants). Non-recursive → RegDeleteKeyExW, which deletes ONLY a
 *  key that has no subkeys (Windows refuses a non-empty key → false, steering the caller to {recursive:true}). true on
 *  success; false if the key is absent, non-empty (non-recursive), or the delete is access-denied (HKLM needs elevation). */
export function registryDeleteKey(hive: RegistryHive, key: string, recursive: boolean): boolean {
  const root = hive === 'HKLM' ? HKEY_LOCAL_MACHINE : hive === 'HKCU' ? HKEY_CURRENT_USER : hive === 'HKCR' ? HKEY_CLASSES_ROOT : HKEY_USERS;
  const subkey = Buffer.from(`${key}\0`, 'utf16le');
  if (recursive) return Advapi32.RegDeleteTreeW(root, subkey.ptr!) === ERROR_SUCCESS; // removes the key + all descendants in one call
  return Advapi32.RegDeleteKeyExW(root, subkey.ptr!, 0, 0) === ERROR_SUCCESS; // samDesired=0 (default view), Reserved=0; fails if the key has subkeys
}
