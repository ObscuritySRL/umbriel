// Windows Defender Firewall via COM — enumerate every inbound/outbound rule natively (no `netsh advfirewall firewall
// show rule`) through umbriel's OWN generic COM machinery (vcall/guid/comRelease + the BSTR/LONG readers), the same
// mechanism desktop/tasks.ts uses for the Task Scheduler — just a different CLSID. Read-only: no rule is added or changed.
//
// SEGFAULT SAFETY: a wrong vtable slot is an unchecked function-pointer call that crashes the host. Every FIREWALL_SLOT
// was verified against netfw.h's MIDL `*Vtbl` declaration order (slot-gate.test.ts) AND live (the integration test
// enumerates the real rule set). The collection is walked via IEnumVARIANT::Next, whose VARIANTs are VT_DISPATCH
// INetFwRule pointers — released per item.

import { FFIType } from 'bun:ffi';
import Combase from '@bun-win32/combase';

import { comRelease, guid, vcall } from '../com/com';
import { getBstr, getLong } from '../com/reads';
import { CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, S_OK, VT_DISPATCH } from '../com/constants';

const CLSID_NetFwPolicy2 = '{E2B3C97F-6AE1-41AC-817A-F6F92166D7DD}';
const IID_INetFwPolicy2 = '{98325047-C671-4174-8D81-DEFCD3F03186}';
const IID_IEnumVARIANT = '{00020404-0000-0000-C000-000000000046}';
const MAX_RULES = 5000;

const QUERY_INTERFACE = 0;
const ENUM_NEXT = 3; // IEnumVARIANT::Next — IUnknown 0-2, then Next 3

/** Verified-LIVE vtable slots against netfw.h. INetFwPolicy2/INetFwRules/INetFwRule are IDispatch-derived (IUnknown 0-2,
 *  IDispatch 3-6, members from 7); the spread-out INetFwRule slots are the get+put property pairs each consuming two. */
export const FIREWALL_SLOT = {
  INetFwPolicy2_get_Rules: 18,
  INetFwRules_get__NewEnum: 11,
  INetFwRule_get_Name: 7,
  INetFwRule_get_Protocol: 15,
  INetFwRule_get_LocalPorts: 17,
  INetFwRule_get_Direction: 27,
  INetFwRule_get_Enabled: 33,
  INetFwRule_get_Action: 41,
};

const DIRECTIONS: Record<number, string> = { 1: 'in', 2: 'out' };
const ACTIONS: Record<number, string> = { 0: 'block', 1: 'allow' };
const PROTOCOLS: Record<number, string> = { 1: 'icmpv4', 6: 'tcp', 17: 'udp', 58: 'icmpv6', 256: 'any' };

export interface FirewallRule {
  name: string;
  direction: string; // in / out
  action: string; // allow / block
  enabled: boolean;
  protocol: string; // tcp / udp / icmpv4 / any / …
  localPorts: string; // e.g. "5353", or '' for any
}

/** Read a 2-byte VARIANT_BOOL property (get+put bool, e.g. INetFwRule::Enabled): a zeroed 4-byte out, read the low int16
 *  (−1 true / 0 false) — getLong's 4-byte read would mix the callee's 2 bytes with stale high bytes. */
function getVariantBool(ptr: bigint, slot: number): boolean {
  const out = Buffer.alloc(4);
  return vcall(ptr, slot, [FFIType.ptr], [out.ptr!]) === S_OK && out.readInt16LE(0) !== 0;
}

/** Every Windows Firewall rule (name / direction / action / enabled / protocol / local ports). [] if the firewall COM
 *  service is unreachable. Read-only — no rule is created or modified. */
export function listFirewallRules(): FirewallRule[] {
  Combase.CoInitializeEx(null, COINIT_APARTMENTTHREADED); // idempotent (S_FALSE if already initialized on this thread)
  const out = Buffer.alloc(8);
  if (Combase.CoCreateInstance(guid(CLSID_NetFwPolicy2).ptr!, 0n, CLSCTX_INPROC_SERVER, guid(IID_INetFwPolicy2).ptr!, out.ptr!) !== S_OK) return [];
  const policy = out.readBigUInt64LE(0);
  if (policy === 0n) return [];
  const rules: FirewallRule[] = [];
  try {
    const rulesOut = Buffer.alloc(8);
    if (vcall(policy, FIREWALL_SLOT.INetFwPolicy2_get_Rules, [FFIType.ptr], [rulesOut.ptr!]) !== S_OK) return rules;
    const collection = rulesOut.readBigUInt64LE(0);
    if (collection === 0n) return rules;
    try {
      const enumOut = Buffer.alloc(8);
      if (vcall(collection, FIREWALL_SLOT.INetFwRules_get__NewEnum, [FFIType.ptr], [enumOut.ptr!]) !== S_OK) return rules;
      const unknown = enumOut.readBigUInt64LE(0);
      if (unknown === 0n) return rules;
      const enumVariantOut = Buffer.alloc(8);
      const queried = vcall(unknown, QUERY_INTERFACE, [FFIType.ptr, FFIType.ptr], [guid(IID_IEnumVARIANT).ptr!, enumVariantOut.ptr!]); // IUnknown → IEnumVARIANT
      comRelease(unknown);
      if (queried !== S_OK) return rules;
      const enumerator = enumVariantOut.readBigUInt64LE(0);
      if (enumerator === 0n) return rules;
      try {
        const variant = Buffer.alloc(16);
        const fetched = Buffer.alloc(4);
        while (rules.length < MAX_RULES) {
          variant.fill(0);
          if (vcall(enumerator, ENUM_NEXT, [FFIType.u32, FFIType.ptr, FFIType.ptr], [1, variant.ptr!, fetched.ptr!]) !== S_OK || fetched.readUInt32LE(0) === 0) break;
          if (variant.readUInt16LE(0) !== VT_DISPATCH) continue;
          const rule = variant.readBigUInt64LE(8);
          if (rule === 0n) continue;
          const protocol = getLong(rule, FIREWALL_SLOT.INetFwRule_get_Protocol);
          const direction = getLong(rule, FIREWALL_SLOT.INetFwRule_get_Direction);
          const action = getLong(rule, FIREWALL_SLOT.INetFwRule_get_Action);
          rules.push({
            name: getBstr(rule, FIREWALL_SLOT.INetFwRule_get_Name),
            direction: DIRECTIONS[direction] ?? `dir-${direction}`,
            action: ACTIONS[action] ?? `action-${action}`,
            enabled: getVariantBool(rule, FIREWALL_SLOT.INetFwRule_get_Enabled),
            protocol: PROTOCOLS[protocol] ?? `proto-${protocol}`,
            localPorts: getBstr(rule, FIREWALL_SLOT.INetFwRule_get_LocalPorts),
          });
          comRelease(rule);
        }
      } finally {
        comRelease(enumerator);
      }
    } finally {
      comRelease(collection);
    }
  } finally {
    comRelease(policy);
  }
  return rules;
}
