// Windows Event Log (System / Application / …) via the LEGACY Advapi32 API — read recent crash/failure/warning records
// natively, no Get-WinEvent/wevtutil shell. The modern wevtapi (EvtQuery) is NOT a dep; the classic
// OpenEventLogW/ReadEventLogW/CloseEventLog path IS in advapi32 (a current dep). Reads newest-first
// (EVENTLOG_BACKWARDS_READ), decoding the fixed EVENTLOGRECORD header by hand. The `message` is the raw INSERTION
// strings (the event's parameters), not the message-DLL-formatted sentence (which would need FormatMessage + the
// source's message resource) — still diagnostic (service names, error codes, paths).

import Advapi32 from '@bun-win32/advapi32';

const EVENTLOG_SEQUENTIAL_READ = 0x0001;
const EVENTLOG_BACKWARDS_READ = 0x0008;
const EVENT_TYPES: Record<number, string> = { 1: 'error', 2: 'warning', 4: 'information', 8: 'audit-success', 16: 'audit-failure' };

export type EventLogLevel = 'error' | 'warning' | 'all';

export interface EventLogRecord {
  recordNumber: number;
  time: string; // ISO 8601
  type: string;
  source: string;
  eventId: number;
  message: string; // the insertion strings joined (raw parameters, not the formatted sentence)
}

/** Read a NUL-terminated UTF-16 string from `buffer` at `offset`, bounded by the buffer length. */
function readWideZ(buffer: Buffer, offset: number): string {
  let end = offset;
  while (end + 1 < buffer.length && (buffer[end] !== 0 || buffer[end + 1] !== 0)) end += 2;
  return buffer.toString('utf16le', offset, end);
}

/** Read `count` consecutive NUL-terminated UTF-16 strings starting at `offset` (the event's insertion strings). */
function readStrings(buffer: Buffer, offset: number, count: number): string {
  const parts: string[] = [];
  let current = offset;
  for (let index = 0; index < count && current + 1 < buffer.length; index += 1) {
    const text = readWideZ(buffer, current);
    if (text.length > 0) parts.push(text);
    current += (text.length + 1) * 2;
  }
  return parts.join(' | ');
}

/**
 * Read the newest `count` records (optionally filtered to error / warning) from a Windows event log (e.g. 'System',
 * 'Application'). [] if the log can't be opened (a bad name, or 'Security' without elevation; System/Application read
 * without elevation). EVENTLOGRECORD fixed header (x86 packed): Length@0, RecordNumber@8, TimeGenerated@12 (unix
 * seconds), EventID@20 (low 16 bits), EventType u16@24, NumStrings u16@26, StringOffset@36, SourceName (WCHARZ) @56.
 */
export function readEventLog(logName: string, count: number, level: EventLogLevel): EventLogRecord[] {
  const source = Buffer.from(`${logName}\0`, 'utf16le');
  const handle = Advapi32.OpenEventLogW(null, source.ptr!);
  if (handle === 0n) return [];
  const records: EventLogRecord[] = [];
  try {
    const buffer = Buffer.alloc(0x10000); // 64KB — holds many records per read
    const bytesRead = Buffer.alloc(4);
    const bytesNeeded = Buffer.alloc(4);
    while (records.length < count) {
      if (Advapi32.ReadEventLogW(handle, EVENTLOG_SEQUENTIAL_READ | EVENTLOG_BACKWARDS_READ, 0, buffer.ptr!, buffer.length, bytesRead.ptr!, bytesNeeded.ptr!) === 0) break; // EOF, or a single record > 64KB
      const read = bytesRead.readUInt32LE(0);
      let offset = 0;
      while (offset + 56 <= read && records.length < count) {
        const length = buffer.readUInt32LE(offset);
        if (length < 56 || offset + length > read) break; // malformed / spans past the bytes actually read
        const eventType = buffer.readUInt16LE(offset + 24);
        const include = level === 'all' || (level === 'error' && eventType === 1) || (level === 'warning' && (eventType === 1 || eventType === 2));
        if (include) {
          const stringOffset = buffer.readUInt32LE(offset + 36);
          records.push({
            recordNumber: buffer.readUInt32LE(offset + 8),
            time: new Date(buffer.readUInt32LE(offset + 12) * 1000).toISOString(),
            type: EVENT_TYPES[eventType] ?? `type-${eventType}`,
            source: readWideZ(buffer, offset + 56),
            eventId: buffer.readUInt32LE(offset + 20) & 0xffff,
            message: readStrings(buffer, offset + stringOffset, buffer.readUInt16LE(offset + 26)),
          });
        }
        offset += length;
      }
    }
  } finally {
    Advapi32.CloseEventLog(handle);
  }
  return records;
}
