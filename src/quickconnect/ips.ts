export function isPrivate(address: string) {
  return (
    /^(::f{4}:)?10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(address) ||
    /^(::f{4}:)?192\.168\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(address) ||
    /^(::f{4}:)?172\.(1[6-9]|2\d|30|31)\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(address) ||
    /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(address) ||
    /^(::f{4}:)?169\.254\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(address) ||
    /^f[cd][0-9a-f]{2}:/i.test(address) ||
    /^fe80:/i.test(address) ||
    /^::1$/.test(address) ||
    /^::$/.test(address)
  );
}

export function isLoopback(address: string) {
  return (
    /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/.test(address) ||
    /^fe80::1$/.test(address) ||
    /^::1$/.test(address) ||
    /^::$/.test(address)
  );
}

export function isIpv4(address: string) {
  return /^(\d{1,3}\.){3,3}\d{1,3}$/.test(address);
}

export function isIpv6(address: string) {
  return /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i.test(address);
}
