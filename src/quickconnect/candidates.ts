import { QuickConnect, QuickConnectServerInfo } from '../rest';
import { isPrivate, isLoopback, isIpv4, isIpv6 } from './ips';
import { series } from './promises';
import * as md5 from 'md5';

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

const PROTOCOL_PORTS = {
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

// This is an adaptation of what quickconnect.to refers to as "addCase".
function generatePingPongCandidates(quickConnectId: string, info: QuickConnectServerInfo): Record<ConnectionType, PingPongCandidate[]> {
  let candidates: Record<ConnectionType, PingPongCandidate[]> = {} as any;
  Object.keys(ConnectionType).forEach((connectionType: ConnectionType) => {
    candidates[connectionType] = [];
  });

  const port = +info.service!.port!;
  if (!isNaN(port)) {
    const extPort = shouldCheckExtPort(info.service!.ext_port, port) ? +info.service!.ext_port! : undefined;

    function addWithPort(type: ConnectionType, address: string) {
      candidates[type].push({ address, port });
    }

    function addWithExtPort(type: ConnectionType, address: string) {
      if (extPort) {
        candidates[type].push({ address, port: extPort });
      }
    }

    info.server.interface!.forEach(iface => {
      if (iface.ipv6) {
        iface.ipv6.forEach(ipv6Interface => {
          if (!!ipv6Interface.address) {
            addWithPort(
              ipv6Interface.scope === 'link' ? ConnectionType.LAN_IPV6 : ConnectionType.WAN_IPV6,
              ipv6Interface.address,
            );
            addWithExtPort(ConnectionType.WAN_IPV6, ipv6Interface.address);
          }
        });
      }

      if (iface.ip && !isLoopback(iface.ip)) {
        addWithPort(
          isPrivate(iface.ip) ? ConnectionType.LAN_IPV4 : ConnectionType.WAN_IPV4,
          iface.ip,
        );
        addWithExtPort(ConnectionType.WAN_IPV4, iface.ip);
      }
    });

    if (info.server.ddns && info.server.ddns !== 'NULL') {
      addWithPort(ConnectionType.DDNS, info.server.ddns);
      addWithExtPort(ConnectionType.DDNS, info.server.ddns);
    }

    if (info.server.fqdn && info.server.fqdn !== 'NULL') {
      addWithPort(ConnectionType.FQDN, info.server.fqdn);
      addWithExtPort(ConnectionType.FQDN, info.server.fqdn);
    }

    if (info.server.external && info.server.external.ip)  {
      addWithPort(ConnectionType.LAN_IPV4, info.server.external.ip);
      addWithExtPort(ConnectionType.LAN_IPV4, info.server.external.ip);
    }
  }

  if (hasTunnel(info)) {
    candidates[ConnectionType.TUN].push({ address: `${quickConnectId}.${info.env.relay_region!}.quickconnect.to` });
  }

  return candidates;
}

export function tryControlHost(controlHost: string, quickConnectId: string, protocol: 'http' | 'https'): Promise<string> {
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
        const serverIdHash: string = md5(result.server.serverID!);

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
