import Axios from 'axios';

type Protocol = 'http' | 'https';
type DsmPortal = 'dsm_portal' | 'dsm_portal_https';

const DSM_PROTOCOL: Record<Protocol, DsmPortal> = {
  'http': 'dsm_portal',
  'https': 'dsm_portal_https',
};

const REQUEST_CONFIG = {
  timeout: 5000,
  withCredentials: false,
};

const GLOBAL_CONTROL_SERVER = 'global.quickconnect.to';

function servPath(host: string) {
  return `https://${host}/Serv.php`;
}

function getControlList(): Promise<string[]> { // Not sure what the return type here actually is...
  return Axios.post(servPath(GLOBAL_CONTROL_SERVER), {
    version: 1,
    command: 'get_site_list',
  }, REQUEST_CONFIG)
    .then(response => response.data.sites);
}

// Note that because this protocol is reverse-engineered, this interface may be incomplete.
// In particular, the optionality of many of these fields is unclear, so I've made some
// educated guesses based on the results I've seen.
// Furthermore, some of these numerical types might actually sometimes be delivered as strings.
// ext_port can, for sure, and I've seen this happen in the request API requests too.
export interface QuickConnectServerInfo {
  command: string;
  server: {
    ddns?: 'NULL' | string;
    ds_state: string;
    serverID?: string;
    gateway: string;
    interface?: {
      mask: string;
      name: string;
      ip?: string;
      ipv6?: {
        scope?: 'link' | string;
        address?: string;
        prefix_length: number;
        addr_type: number;
      }[];
    }[];
    version: string;
    fqdn: 'NULL' | string;
    udp_punch_port?: number;
    external?: {
      ip?: string;
      ipv6?: string;
    };
  };
  service?: {
    pingpong_desc?: any[];
    ext_port?: number | string;
    relay_ip?: string;
    relay_ipv6?: string;
    https_ip?: string;
    port?: number | string;
    relay_dualstack?: string;
    https_port?: string;
    pingpong?: string;
    relay_dn?: string;
    relay_port?: number;
  };
  errno: number;
  env: {
    control_host?: string;
    relay_region?: string;
  };
  version: number;
}

export interface QuickConnectErrorResponse {
  errinfo: string;
  errno: number;
  command: string;
  version: number;
}

function getServerInfo(controlHost: string, quickConnectId: string, protocol: Protocol): Promise<QuickConnectServerInfo | QuickConnectErrorResponse> {
  return Axios.post(servPath(controlHost), {
    version: 1,
    command: 'get_server_info',
    id: DSM_PROTOCOL[protocol],
    serverID: quickConnectId,
  }, REQUEST_CONFIG)
    .then(response => response.data);
}

function requestTunnel(controlHost: string, quickConnectId: string, protocol: Protocol): Promise<QuickConnectServerInfo | QuickConnectErrorResponse> {
  return Axios.post(servPath(controlHost), {
    version: 1,
    command: 'request_tunnel',
    id: DSM_PROTOCOL[protocol],
    serverID: quickConnectId,
  }, REQUEST_CONFIG)
    .then(response => response.data);
}

export interface PingPongResponse {
  boot_done: boolean;
  disk_hibernation: boolean;
  ezid: string;
  success: boolean;
}

function pingPong(urlRoot: string, quickConnectId: string): Promise<PingPongResponse> {
  return Axios.get(`${urlRoot}/webman/pingpong.cgi?action=cors`, {
    headers: {
      // It appears that this header is necessary to get it to actually respond!
      'Referer': `https://${quickConnectId}.quickconnect.to`,
    },
  })
    .then(response => response.data);
}

export const QuickConnect = {
  getControlList,
  getServerInfo,
  requestTunnel,
  pingPong,
};
