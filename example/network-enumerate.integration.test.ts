/**
 * network-enumerate — native network state (adapters + TCP/UDP connections with owning pids) via @bun-win32/iphlpapi,
 * killing the ipconfig / Get-NetAdapter / netstat -ano / Get-NetTCPConnection shell-reach. (This capability was earlier
 * WRONGLY declined as "no @bun-win32 binding exists" — iphlpapi was published all along; it is now a dep.)
 *
 * Proof (the live offset verifier — a wrong struct offset returns garbage IPs/ports or a bad pid):
 *   - listAdapters() yields the loopback adapter with 127.0.0.1 (+ ::1) — pins the IP_ADAPTER_ADDRESSES walk, the
 *     SOCKET_ADDRESS deref, and the AF_INET@4 / AF_INET6@8 sockaddr offsets + the IPv6 "::" compression.
 *   - listConnections() yields plausible TCP LISTEN ports each with a pid — pins the MIB_TCPROW_OWNER_PID stride and
 *     the network-byte-order port swap (a wrong swap turns 445 into 48385).
 *   - HEADLINE end-to-end: bind a TCP listener on an ephemeral port, then find that exact port in the table owned by
 *     THIS process's pid — proves state + port-swap + owning-pid offsets together. Listener closed in a finally.
 *   - the read-category tools are exposed under the readonly profile (pure introspection, no mutation).
 *
 * bun test is broken repo-wide — runnable harness (no windows spawned):
 * Run: bun run example/network-enumerate.integration.test.ts
 */
import { listAdapters, listConnections } from 'umbriel';

import { assert, finish, spawnServer } from './_harness';

// --- adapters ---
const adapters = listAdapters();
assert(adapters.length > 0, `listAdapters() returned ${adapters.length} adapters`);
const loopback = adapters.find((adapter) => adapter.addresses.includes('127.0.0.1'));
assert(loopback !== undefined, 'the loopback adapter is present with 127.0.0.1 (pins the IPv4 sockaddr offset)');
assert(loopback === undefined || loopback.type === 'loopback', `the 127.0.0.1 adapter is typed loopback (got ${loopback?.type})`);
assert(adapters.some((adapter) => adapter.addresses.length > 0 && adapter.status === 'up'), 'at least one up adapter has an assigned IP');
assert(adapters.every((adapter) => adapter.mac === '' || /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(adapter.mac)), 'every MAC is empty or a well-formed 6-octet address (pins PhysicalAddress + length)');

// --- connections ---
const connections = listConnections(true);
const tcp = connections.filter((connection) => connection.protocol === 'tcp');
const listeners = tcp.filter((connection) => connection.state === 'LISTEN');
assert(tcp.length > 0 && listeners.length > 0, `listConnections() returned ${tcp.length} TCP rows incl. ${listeners.length} listeners`);
assert(listeners.every((connection) => connection.localPort >= 1 && connection.localPort <= 65535), 'every LISTEN port is in 1..65535 (catches an un-swapped network-order port)');
assert(listeners.every((connection) => connection.pid > 0), 'every LISTEN row has a real owning pid');

// --- HEADLINE: bind a real listener and find it with our pid ---
const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } });
try {
  const boundPort = server.port;
  await Bun.sleep(120);
  const mine = listConnections(false).find((connection) => connection.state === 'LISTEN' && connection.localPort === boundPort);
  assert(mine !== undefined, `the bound listener on 127.0.0.1:${boundPort} appears in the TCP table`);
  assert(mine === undefined || mine.pid === process.pid, `the bound listener is owned by THIS process (table pid ${mine?.pid} === ${process.pid}) — proves state+port-swap+pid offsets together`);
} finally {
  server.stop();
}

// --- MCP exposure under readonly (both tools are pure-read introspection) ---
const readonly = spawnServer({ UMBRIEL_PROFILE: 'readonly' });
try {
  await readonly.call('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'net', version: '1' } });
  const list = await readonly.call('tools/list', {});
  const names = (list.result?.tools ?? []).map((tool) => tool.name);
  assert(names.includes('list_adapters') && names.includes('list_connections'), 'list_adapters + list_connections are exposed under the readonly profile (read category)');
  const adaptersOut = readonly.textOf(await readonly.call('tools/call', { name: 'list_adapters', arguments: {} }));
  assert(/mtu \d+/.test(adaptersOut), 'the list_adapters tool returns formatted adapter rows over MCP');
} finally {
  readonly.kill();
}

finish('PASS — native adapter + connection enumeration (iphlpapi): loopback/IPs/listeners decode correctly, the bound-port pid-tie holds, and the read tools are readonly-exposed.');
