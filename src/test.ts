import { Auth } from './rest';
import { resolveQuickConnectId, constructQuickConnectReferer } from './quickconnect';

function tap<T>(r: T): T {
  console.log(r);
  return r;
}

resolveQuickConnectId('gurthalak', 'https', 'require')
  .then(tap)
  .then(({ hostname, port }) => `https://${hostname}:${port}`)
  .then(tap)
  .then(address => {
    // return Info.Query(address, {
    //   query: 'ALL',
    //   referer: constructQuickConnectReferer('gurthalak', 'https'),
    // });
    return Auth.Login(address, {
      account: 'download-user',
      passwd: 'Ng7Xb9uDP76&iUNd#zW3u9(w&a$6DL^^',
      session: 'DownloadStation',
      timeout: 5000,
      referer: constructQuickConnectReferer('gurthalak', 'https'),
    });
  })
  .then(tap);
