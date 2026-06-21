// Windows network state via @bun-win32/iphlpapi — list every network adapter (GetAdaptersAddresses) and every active
// TCP/UDP endpoint with its owning pid (GetExtendedTcpTable / GetExtendedUdpTable) natively, no `ipconfig` /
// `Get-NetAdapter` / `netstat -ano` / `Get-NetTCPConnection` shell. Pure buffer enumeration: NO COM/vtable, NO process
// handles (nothing to free) — the lightest of the OS-read engines. Each connection row carries the owning pid, which
// ties to processInfo()/listProcesses() (desktop/events.ts) so an agent can name the process behind a socket.
//
// Address/port formatting is pure TS (no ws2_32): an IPv4 in_addr is already in display order (print the 4 bytes
// a.b.c.d); a port is network-byte-order in the low 16 bits (ntohs = read the two bytes big-endian). The adapter
// strings (FriendlyName/Description) are pointers INTO the returned buffer, decoded by offset (pointer − base) with a
// range guard so a stray pointer reads '' instead of out of bounds — the desktop/services.ts readPackedWide idiom.

import type { Pointer } from 'bun:ffi';

import Iphlpapi from '@bun-win32/iphlpapi';

const AF_UNSPEC = 0;
const AF_INET = 2;
const AF_INET6 = 23;
const GAA_FLAGS = 0x0e; // SKIP_ANYCAST(0x2) | SKIP_MULTICAST(0x4) | SKIP_DNS_SERVER(0x8) — we only walk unicast IPs + names
const ERROR_BUFFER_OVERFLOW = 111;
const ERROR_INSUFFICIENT_BUFFER = 122;
const TCP_TABLE_OWNER_PID_ALL = 5;
const UDP_TABLE_OWNER_PID = 1;
const MAX_TABLE_BYTES = 8 * 1024 * 1024; // sanity cap on the variable-length tables

const IF_TYPES: Record<number, string> = { 1: 'other', 6: 'ethernet', 23: 'ppp', 24: 'loopback', 71: 'wifi', 131: 'tunnel', 144: 'firewire' };
const OPER_STATUS: Record<number, string> = { 1: 'up', 2: 'down', 3: 'testing', 4: 'unknown', 5: 'dormant', 6: 'not-present', 7: 'lower-layer-down' };
const TCP_STATES: Record<number, string> = { 1: 'CLOSED', 2: 'LISTEN', 3: 'SYN_SENT', 4: 'SYN_RCVD', 5: 'ESTABLISHED', 6: 'FIN_WAIT1', 7: 'FIN_WAIT2', 8: 'CLOSE_WAIT', 9: 'CLOSING', 10: 'LAST_ACK', 11: 'TIME_WAIT', 12: 'DELETE_TCB' };

export interface AdapterInfo {
  name: string; // FriendlyName, e.g. "Wi-Fi" / "Ethernet"
  description: string; // hardware description
  type: string; // ethernet / wifi / loopback / …
  status: string; // up / down / …
  mac: string; // "aa:bb:cc:dd:ee:ff", or '' for an adapter with no physical address (loopback)
  mtu: number;
  ifIndex: number;
  addresses: string[]; // assigned unicast IPv4/IPv6 addresses
}

export interface Connection {
  protocol: 'tcp' | 'udp';
  state: string; // a TCP state, or '' for a UDP endpoint (connectionless)
  localAddress: string;
  localPort: number;
  remoteAddress: string; // '' for a listener / UDP
  remotePort: number; // 0 for a listener / UDP
  pid: number; // the owning process id
}

/** A NUL-terminated wide string the API packed INSIDE `buffer`, read via its absolute `pointer` and the buffer `base`
 *  by offset so the read stays in-bounds (a stray pointer → '' rather than an out-of-bounds absolute read). */
function readPackedWide(buffer: Buffer, base: bigint, pointer: bigint): string {
  if (pointer === 0n) return '';
  const offset = Number(pointer - base);
  if (offset < 0 || offset >= buffer.length) return '';
  return buffer.toString('utf16le', offset, Math.min(offset + 1024, buffer.length)).split('\0')[0] ?? '';
}

/** Format an IPv6 address (16 bytes at `offset` in `buffer`) with the standard longest-zero-run "::" compression. */
function formatIpv6(buffer: Buffer, offset: number): string {
  const hextets: number[] = [];
  for (let k = 0; k < 8; k += 1) hextets.push(((buffer[offset + 2 * k] ?? 0) << 8) | (buffer[offset + 2 * k + 1] ?? 0));
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let k = 0; k < 8; k += 1) {
    if (hextets[k] === 0) {
      runStart = runStart < 0 ? k : runStart;
      runLen += 1;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }
  if (bestLen < 2) return hextets.map((h) => h.toString(16)).join(':');
  const head = hextets.slice(0, bestStart).map((h) => h.toString(16)).join(':');
  const tail = hextets.slice(bestStart + bestLen).map((h) => h.toString(16)).join(':');
  return `${head}::${tail}`;
}

/** Walk one adapter record's FirstUnicastAddress linked list into a list of formatted IPv4/IPv6 addresses (all reads
 *  bounded to `buffer`; the per-IP and sockaddr pointers point back into the same GetAdaptersAddresses buffer). */
function readUnicastAddresses(buffer: Buffer, base: bigint, firstUnicast: bigint): string[] {
  const addresses: string[] = [];
  for (let unicast = firstUnicast; unicast !== 0n; ) {
    const uo = Number(unicast - base);
    if (uo < 0 || uo + 24 > buffer.length) break; // need Next@uo+8 (→16) and lpSockaddr@uo+16 (→24)
    const sockPointer = buffer.readBigUInt64LE(uo + 16); // SOCKET_ADDRESS.lpSockaddr (Address @16 of the unicast struct)
    const so = Number(sockPointer - base);
    if (so >= 0 && so + 2 <= buffer.length) {
      const family = buffer.readUInt16LE(so); // sockaddr.sa_family
      if (family === AF_INET && so + 8 <= buffer.length) addresses.push(`${buffer[so + 4]}.${buffer[so + 5]}.${buffer[so + 6]}.${buffer[so + 7]}`);
      else if (family === AF_INET6 && so + 24 <= buffer.length) addresses.push(formatIpv6(buffer, so + 8));
    }
    unicast = buffer.readBigUInt64LE(uo + 8); // IP_ADAPTER_UNICAST_ADDRESS.Next
  }
  return addresses;
}

/** Every network adapter (friendly name, type, status, MAC, MTU, assigned IPs). [] if enumeration fails. Read-only. */
export function listAdapters(): AdapterInfo[] {
  const size = Buffer.alloc(4);
  if (Iphlpapi.GetAdaptersAddresses(AF_UNSPEC, GAA_FLAGS, null, null, size.ptr!) !== ERROR_BUFFER_OVERFLOW) return []; // size it (no adapters / error → not 111)
  let needed = size.readUInt32LE(0);
  if (needed === 0 || needed > MAX_TABLE_BYTES) return [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const buffer = Buffer.alloc(needed);
    const result = Iphlpapi.GetAdaptersAddresses(AF_UNSPEC, GAA_FLAGS, null, buffer.ptr!, size.ptr!);
    if (result === ERROR_BUFFER_OVERFLOW) {
      needed = size.readUInt32LE(0); // grew between the size and fill calls (an adapter changed) — retry
      if (needed === 0 || needed > MAX_TABLE_BYTES) return [];
      continue;
    }
    if (result !== 0) return []; // NO_ERROR=0; any other code → give up
    const base = BigInt(buffer.ptr!); // read inline right after the synchronous fill; no await before the walk
    const adapters: AdapterInfo[] = [];
    for (let pointer = base; pointer !== 0n; ) {
      const o = Number(pointer - base);
      if (o < 0 || o + 108 > buffer.length) break; // we read fields up to OperStatus@104 (→108)
      const macLength = buffer.readUInt32LE(o + 88);
      const macBytes: string[] = [];
      for (let b = 0; b < macLength && b < 8; b += 1) macBytes.push(buffer[o + 80 + b].toString(16).padStart(2, '0'));
      adapters.push({
        name: readPackedWide(buffer, base, buffer.readBigUInt64LE(o + 72)), // FriendlyName
        description: readPackedWide(buffer, base, buffer.readBigUInt64LE(o + 64)), // Description
        type: IF_TYPES[buffer.readUInt32LE(o + 100)] ?? `type-${buffer.readUInt32LE(o + 100)}`,
        status: OPER_STATUS[buffer.readUInt32LE(o + 104)] ?? `status-${buffer.readUInt32LE(o + 104)}`,
        mac: macBytes.join(':'),
        mtu: buffer.readUInt32LE(o + 96),
        ifIndex: buffer.readUInt32LE(o + 4),
        addresses: readUnicastAddresses(buffer, base, buffer.readBigUInt64LE(o + 24)), // FirstUnicastAddress
      });
      pointer = buffer.readBigUInt64LE(o + 8); // IP_ADAPTER_ADDRESSES.Next
    }
    return adapters;
  }
  return [];
}

/** IPv4 dotted from the 4 in_addr bytes at `offset` (already display order — no swap). */
function ipv4(buffer: Buffer, offset: number): string {
  return `${buffer[offset]}.${buffer[offset + 1]}.${buffer[offset + 2]}.${buffer[offset + 3]}`;
}

/** A network-byte-order port from the low 16 bits at `offset` (ntohs — read the two bytes big-endian). */
function port(buffer: Buffer, offset: number): number {
  return ((buffer[offset] ?? 0) << 8) | (buffer[offset + 1] ?? 0);
}

/** Fill a variable-length owner-pid table via a two-call (size, then read) `get`. Returns the filled buffer or null. */
function ownerPidTable(get: (out: Buffer | null, sizePointer: Pointer) => number): Buffer | null {
  const size = Buffer.alloc(4);
  const sizing = get(null, size.ptr!);
  if (sizing !== ERROR_INSUFFICIENT_BUFFER && sizing !== 0) return null;
  let needed = size.readUInt32LE(0);
  if (needed === 0 || needed > MAX_TABLE_BYTES) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const buffer = Buffer.alloc(needed);
    const result = get(buffer, size.ptr!);
    if (result === 0) return buffer;
    if (result !== ERROR_INSUFFICIENT_BUFFER) return null;
    needed = size.readUInt32LE(0);
    if (needed === 0 || needed > MAX_TABLE_BYTES) return null;
  }
  return null;
}

/** Active IPv4 TCP connections + listeners, and (unless `includeUdp` is false) UDP endpoints, each with its owning pid.
 *  [] if enumeration fails. Read-only. */
export function listConnections(includeUdp = true): Connection[] {
  const connections: Connection[] = [];
  const tcp = ownerPidTable((out, sizePointer) => Iphlpapi.GetExtendedTcpTable(out === null ? null : out.ptr!, sizePointer, 0, AF_INET, TCP_TABLE_OWNER_PID_ALL, 0));
  if (tcp !== null) {
    const count = tcp.readUInt32LE(0);
    for (let i = 0; i < count; i += 1) {
      const row = 4 + i * 24; // MIB_TCPROW_OWNER_PID = 6×DWORD
      if (row + 24 > tcp.length) break;
      const state = TCP_STATES[tcp.readUInt32LE(row)] ?? `state-${tcp.readUInt32LE(row)}`;
      const listening = state === 'LISTEN';
      connections.push({ protocol: 'tcp', state, localAddress: ipv4(tcp, row + 4), localPort: port(tcp, row + 8), remoteAddress: listening ? '' : ipv4(tcp, row + 12), remotePort: listening ? 0 : port(tcp, row + 16), pid: tcp.readUInt32LE(row + 20) });
    }
  }
  if (includeUdp) {
    const udp = ownerPidTable((out, sizePointer) => Iphlpapi.GetExtendedUdpTable(out === null ? null : out.ptr!, sizePointer, 0, AF_INET, UDP_TABLE_OWNER_PID, 0));
    if (udp !== null) {
      const count = udp.readUInt32LE(0);
      for (let i = 0; i < count; i += 1) {
        const row = 4 + i * 12; // MIB_UDPROW_OWNER_PID = 3×DWORD
        if (row + 12 > udp.length) break;
        connections.push({ protocol: 'udp', state: '', localAddress: ipv4(udp, row), localPort: port(udp, row + 4), remoteAddress: '', remotePort: 0, pid: udp.readUInt32LE(row + 8) });
      }
    }
  }
  return connections;
}
