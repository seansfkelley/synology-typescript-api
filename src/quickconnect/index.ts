// This entire file is adapted from the quickconnect.to minified javascript.
// Many of the weird-seeming functions (like isValidServerInfo, which doesn't
// even type narrow) are adapted with minimal semantic changes.

import { QuickConnect, QuickConnectServerInfo } from '../rest';
import { isPrivate, isLoopback, isIpv4, isIpv6 } from './ips';
import { series } from './promises';
import * as MD5 from 'md5.js'; // TODO: Types.

type Protocol = 'http' | 'https';

function isValidServerInfo(info: QuickConnectServerInfo) {
  return (
    info.errno === 0 &&
    !!info.server &&
    !!info.server.interface &&
    !!info.server.external &&
    !!info.server.external.ip &&
    !!info.server.serverID &&
    !!info.service &&
    !!info.service.port &&
    !!info.service.ext_port &&
    !!info.env &&
    !!info.env.control_host &&
    !!info.env.relay_region
  );
}

function hasTunnel(info: QuickConnectServerInfo) {
  return (
    !!info.service &&
    !!info.service.relay_ip &&
    !!info.service.relay_port
  );
}

const PROTOCOL_PORTS: Record<Protocol, number> = {
  'http': 80,
  'https': 443,
};

enum ConnectionType {
  LAN_IPV4 = 'LAN_IPV4',
  LAN_IPV6 = 'LAN_IPV6',
  FQDN = 'FQDN',
  DDNS = 'DDNS',
  WAN_IPV6 = 'WAN_IPV6',
  WAN_IPV4 = 'WAN_IPV4',
  TUN = 'TUN',
}

// quickconnect.to doesn't _quite_ do this. All non-tunnel https variants are followed by all non-tunnel
// http variant, followed by tunnel in both http and https (guess tunneling really sucks). We skip that
// here for simplicity and because we ask for a protocol up front.
const PREFERRED_CONNECTION_ORDERING: ConnectionType[] = [
  ConnectionType.LAN_IPV4,
  ConnectionType.LAN_IPV6,
  ConnectionType.FQDN,
  ConnectionType.DDNS,
  ConnectionType.WAN_IPV6,
  ConnectionType.WAN_IPV4,
  ConnectionType.TUN,
];

function shouldCheckExtPort(extPort: number | string | undefined, port: number) {
  return extPort != null && extPort !== 0 && extPort !== '0' && !isNaN(+extPort) && +extPort !== port;
}

interface PingPongCandidate {
  address: string;
  port?: number;
}

// Adapted from quickconnect.to javascript. ctrl-f "addCase".
function generatePingPongCandidates(quickConnectId: string, info: QuickConnectServerInfo): Record<ConnectionType, PingPongCandidate[]> {
  let candidates: Record<ConnectionType, PingPongCandidate[]> = {} as any;
  Object.keys(ConnectionType).forEach((connectionType: ConnectionType) => {
    candidates[connectionType] = [];
  });

  const port = +info.service!.port!;
  if (!isNaN(port)) {
    const extPort = shouldCheckExtPort(info.service!.ext_port, port) ? +info.service!.ext_port! : undefined;

    info.server.interface!.forEach(iface => {
      if (iface.ipv6) {
        iface.ipv6.forEach(ipv6Interface => {
          if (!!ipv6Interface.address) {
            candidates[ipv6Interface.scope === 'link'
              ? ConnectionType.LAN_IPV6
              : ConnectionType.WAN_IPV6
            ].push({ address: ipv6Interface.address, port });

            if (extPort) {
              candidates[ConnectionType.WAN_IPV6].push({ address: ipv6Interface.address, port: extPort });
            }
          }
        });
      }

      if (iface.ip && !isLoopback(iface.ip)) {
        candidates[isPrivate(iface.ip)
          ? ConnectionType.LAN_IPV4
          : ConnectionType.WAN_IPV4
        ].push({ address: iface.ip, port });

        if (extPort) {
          candidates[ConnectionType.WAN_IPV4].push({ address: iface.ip, port: extPort });
        }
      }
    });

    if (info.server.ddns && info.server.ddns !== 'NULL') {
      candidates[ConnectionType.DDNS].push({ address: info.server.ddns, port });

      if (extPort) {
        candidates[ConnectionType.DDNS].push({ address: info.server.ddns, port: extPort });
      }
    }

    if (info.server.fqdn && info.server.fqdn !== 'NULL') {
      candidates[ConnectionType.FQDN].push({ address: info.server.fqdn, port });

      if (extPort) {
        candidates[ConnectionType.FQDN].push({ address: info.server.fqdn, port: extPort });
      }
    }

    if (info.server.external && info.server.external.ip)  {
      candidates[ConnectionType.LAN_IPV4].push({ address: info.server.external.ip, port });

      if (extPort) {
        candidates[ConnectionType.LAN_IPV4].push({ address: info.server.external.ip, port: extPort });
      }
    }
  }

  if (hasTunnel(info)) {
    candidates[ConnectionType.TUN].push({ address: `${quickConnectId}.${info.env.relay_region!}.quickconnect.to` });
  }

  return candidates;
}

function tryControlHost(controlHost: string, quickConnectId: string, protocol: Protocol): Promise<string> {
  return QuickConnect.getServerInfo(controlHost, quickConnectId, protocol)
    .then(result => {
      if ('errinfo' in result) {
        throw new Error(result.errinfo);
      } else if (!isValidServerInfo(result)) {
        throw new Error(`server info returned is invalid!`);
      } else {
        const candidates = generatePingPongCandidates(quickConnectId, result);
        const formattedCandidateAddresses = ([] as string[]).concat(...PREFERRED_CONNECTION_ORDERING.map(connectionType => {
          return candidates[connectionType].map(candidate => {
            const address = isIpv6(candidate.address) && !isIpv4(candidate.address)
              ? `[${candidate.address}]`
              : candidate.address;
            return `${address}:${candidate.port || PROTOCOL_PORTS[protocol]}`;
          })
        }));
        const serverIdHash: string = new MD5().update(result.server.serverID!).digest('hex');

        return series(formattedCandidateAddresses, address => {
          return QuickConnect.pingPong(address)
            .then(result => {
              if (result.success && result.ezid === serverIdHash) {
                return address;
              } else {
                throw new Error(`failed to get response from candidate address or ezid failed validation`);
              }
            });
        });
      }
    });
}

export function resolveQuickConnectId(quickConnectId: string, protocol: 'http' | 'https'): Promise<string> {
  return QuickConnect.getControlList()
    .then(controlHosts => {
      return series(controlHosts, controlHost =>
        // TODO: It probably returns a non-rejected promise with error information. Turn that
        // into a rejection so we don't inadvertently return it to the caller.
        tryControlHost(controlHost, quickConnectId, protocol)
      );
    });
}
