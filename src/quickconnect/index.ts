// This entire directory is adapted from the quickconnect.to minified javascript.
// Many of the weird-seeming functions (like isValidServerInfo, which doesn't
// even type narrow) are adapted with minimal semantic changes.
import { QuickConnect } from '../rest';
import { tryResolveFromControlHost, QuickConnectTunnelRequest } from './connections';
import { series } from './promises';

export function resolveQuickConnectId(quickConnectId: string, protocol: 'http' | 'https', tunnel: QuickConnectTunnelRequest = 'include') {
  return QuickConnect.getControlList()
    .then(controlHosts => {
      return series(controlHosts, controlHost =>
        // TODO: It probably returns a non-rejected promise with error information. Turn that
        // into a rejection so we don't inadvertently return it to the caller.
        tryResolveFromControlHost(controlHost, quickConnectId, protocol, tunnel)
      );
    });
}
