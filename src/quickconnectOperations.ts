import { QuickConnect, QuickConnectServerInfo } from './rest';
import { isPrivate, isLoopback, isIpv4, isIpv6 } from './ips';
import * as MD5 from 'md5.js'; // TODO: Types.

type Protocol = 'http' | 'https';

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

  if (QuickConnect.hasTunnel(info)) {
    candidates[ConnectionType.TUN].push({ address: `${quickConnectId}.${info.env.relay_region!}.quickconnect.to` });
  }

  return candidates;
}

function tryControlHost(controlHost: string, quickConnectId: string, protocol: Protocol): Promise<string> {
  return QuickConnect.getServerInfo(controlHost, quickConnectId, protocol)
    .then(result => {
      if ('errinfo' in result) {
        throw new Error(result.errinfo);
      } else if (!QuickConnect.isValidServerInfo(result)) {
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
        const md5Id: string = new MD5().update(result.server.serverID!).digest('hex');

        let pingPongThunks = formattedCandidateAddresses.map(address => () => QuickConnect.pingPong(address));

        function tryPingPong(): Promise<string> {
          if (pingPongThunks.length === 0) {
            return Promise.reject('no pings resulted in success');
          } else {
            return pingPongThunks.shift()!()
              .then(result => {
                // if is error result do things
                if (result.success && result.ezid === md5Id) {
                  return // the hostname, which we've lost now...
                } else {
                  return tryPingPong();
                }
              })
              .catch(() => tryPingPong());
          }
        }

        return tryPingPong()
      }
    });
}

export function resolveQuickConnectId(quickConnectId: string, protocol: Protocol): Promise<string> {
  return QuickConnect.getControlList()
    .then(controlHosts => {
      let hostThunks = controlHosts.map(controlHost => () => tryControlHost(controlHost, quickConnectId, protocol));

      function tryHost(): Promise<string> {
        if (hostThunks.length === 0) {
          return Promise.reject('no control hosts could provide a reachable DSM');
        } else {
          return hostThunks.shift()!()
            .then(result => {
              // if is error result do things
              return result;
            })
            .catch(() => tryHost());
        }
      }

      return tryHost();
    });
}
