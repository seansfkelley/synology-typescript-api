import Axios from 'axios';
import { BaseRequest, DEFAULT_TIMEOUT } from './shared';

export type PingPongResponse = {
  success: true;
  boot_done: boolean;
  disk_hibernation: boolean;
  ezid: string;
} | {
  // Unsure what this type looks like, but we know it must have this at least.
  success: false;
};

export function pingPong(baseUrl: string, options: BaseRequest): Promise<PingPongResponse> {
  return Axios.get(`${baseUrl}/webman/pingpong.cgi?action=cors`, {
    timeout: options.timeout || DEFAULT_TIMEOUT,
    withCredentials: false,
    headers: options.referer ? { 'Referer': options.referer } : {},
  })
    .then(response => response.data);
}
