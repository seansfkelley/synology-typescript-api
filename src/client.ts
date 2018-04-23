import {
  Auth,
  AuthLoginResponse,
  DownloadStation,
  FileStation,
  Info,
  SynologyResponse,
  SessionName,
  SynologyFailureResponse,
} from './rest';
import { BaseRequest } from './rest/shared';
// import { resolveQuickConnectId } from './quickconnect';

// Make the compiler shut up about inaccessible or unused typings that I actually need for declarations.
import * as _unused_DownloadStation from './rest/DownloadStation';
import * as _unused_FileStation from './rest/FileStation';
import { SynologySuccessResponse } from './rest';
{
  let _1: any; _1 = _unused_DownloadStation; _1 = _unused_FileStation; _1 = _1;
  let _2: SynologySuccessResponse<any> = null as any; _2 = _2;
}

const NO_PERMISSIONS_ERROR_CODE = 105;
const SESSION_TIMEOUT_ERROR_CODE = 106;

export interface ExtraLoginInfo {
  extra: {
    // If we're using version 1 of the login API for compatibility reasons, we will get Set-Cookie headers that we
    // don't want, which will override the existing login session in the normal browing space. We should warn our
    // callers about this!
    isLegacyLogin: boolean;
  };
}

export interface ApiClientSettings {
  baseUrl?: string;
  account?: string;
  passwd?: string;
  session?: SessionName;
}

const _settingNames: Record<keyof ApiClientSettings, true> = {
  'baseUrl': true,
  'account': true,
  'passwd': true,
  'session': true,
};

const SETTING_NAME_KEYS = Object.keys(_settingNames) as (keyof ApiClientSettings)[];

const TIMEOUT_MESSAGE_REGEX = /timeout of \d+ms exceeded/;

function handleRejection(error: any): ConnectionFailure {
  if (error && error.response && error.response.status === 400) {
    return { type: 'probable-wrong-protocol', error };
  } else if (error && error.message === 'Network Error') {
    return { type: 'probable-wrong-url-or-no-connection-or-cert-error', error };
  } else if (error && TIMEOUT_MESSAGE_REGEX.test(error.message)) {
    // This is a best-effort which I expect to start silently falling back onto 'unknown error' at some point in the future.
    return { type: 'timeout', error };
  } else {
    return { type: 'unknown', error };
  }
}

export type ConnectionFailure = {
  type: 'missing-config';
} | {
  type: 'probable-wrong-protocol' | 'probable-wrong-url-or-no-connection-or-cert-error' | 'timeout' | 'unknown';
  error: any;
};

export function isConnectionFailure(result: SynologyResponse<{}> | ConnectionFailure): result is ConnectionFailure {
  return (result as ConnectionFailure).type != null && (result as SynologyResponse<{}>).success == null;
}

export class ApiClient {
  private sidPromise: Promise<SynologyResponse<AuthLoginResponse & ExtraLoginInfo>> | undefined;
  private settingsVersion: number = 0;
  private onSettingsChangeListeners: (() => void)[] = [];

  constructor(private settings: ApiClientSettings) {}

  public updateSettings(settings: ApiClientSettings) {
    if (settings != null && (this.settings == null || SETTING_NAME_KEYS.some(k => settings[k] !== this.settings[k]))) {
      this.settingsVersion++;
      this.settings = settings;
      this.maybeLogout();
      return true;
    } else {
      return false;
    }
  }

  public onSettingsChange(listener: () => void) {
    this.onSettingsChangeListeners.push(listener);
    let isSubscribed = true;
    return () => {
      if (isSubscribed) {
        this.onSettingsChangeListeners = this.onSettingsChangeListeners.filter(l => l !== listener);
        isSubscribed = false;
      }
    };
  }

  private isFullyConfigured() {
    return SETTING_NAME_KEYS.every(k => {
      const v = this.settings[k];
      return v != null && v.length > 0;
    });
  }

  private maybeLogin = (request?: BaseRequest): Promise<SynologyResponse<AuthLoginResponse & ExtraLoginInfo>| ConnectionFailure> => {
    if (!this.sidPromise) {
      if (!this.isFullyConfigured()) {
        const failure: ConnectionFailure = {
          type: 'missing-config'
        };
        return Promise.resolve(failure);
      } else {
        const cachedSettings = this.settings;
        this.sidPromise = Info.Query(cachedSettings.baseUrl!, { query: [ Auth.API_NAME ] })
          .then(apiVersions => {
            const authApiVersion: 1 | 4 = apiVersions.success && apiVersions.data[Auth.API_NAME].maxVersion >= 4
              ? 4
              : 1;
            return Auth.Login(cachedSettings.baseUrl!, {
              ...(request || {}),
              account: cachedSettings.account!,
              passwd: cachedSettings.passwd!,
              session: cachedSettings.session!,
              version: authApiVersion,
            })
              .then(response => {
                if (response.success) {
                  return {
                    ...response,
                    data: {
                      ...response.data,
                      extra: {
                        isLegacyLogin: authApiVersion === 1
                      }
                    }
                  };
                } else {
                  return response;
                }
              });
          })
        return this.sidPromise.catch(handleRejection);
      }
    } else {
      return this.sidPromise.catch(handleRejection);
    }
  };

  // Note that this method is a BEST EFFORT.
  // (1) Because the client auto-re-logs in when you make new queries, this method will attempt to
  //     only log out the current session. The next non-logout call is guaranteed to attempt to log
  //     back in.
  // (2) The result of this call, either success or failure, has no bearing on future API calls. It
  //     is provided to the caller only for convenience, and may not reflect the true state of the
  //     client or session at the time the promise is resolved.
  private maybeLogout = (request?: BaseRequest): Promise<SynologyResponse<{}> | ConnectionFailure | 'not-logged-in'> => {
    const stashedSidPromise = this.sidPromise;
    this.sidPromise = undefined;

    if (stashedSidPromise) {
      if (!this.isFullyConfigured()) {
        const failure: ConnectionFailure = {
          type: 'missing-config'
        };
        return Promise.resolve(failure);
      } else {
        const { baseUrl, session } = this.settings;
        return stashedSidPromise
          .then(response => {
            if (response.success) {
              return Auth.Logout(baseUrl!, {
                ...(request || {}),
                sid: response.data.sid,
                session: session!
              });
            } else {
              return response;
            }
          })
          .catch(handleRejection);
      }
    } else {
      return Promise.resolve('not-logged-in' as 'not-logged-in');
    }
  };

  private proxy<T, U>(fn: (baseUrl: string, sid: string, options: T) => Promise<SynologyResponse<U>>): (options: T) => Promise<SynologyResponse<U> | ConnectionFailure>;
  private proxy<T, U>(fn: (baseUrl: string, sid: string, options?: T) => Promise<SynologyResponse<U>>, optional: true): (options?: T) => Promise<SynologyResponse<U> | ConnectionFailure>;

  // This function is a doozy. Thank goodness for Typescript.
  private proxy<T, U>(fn: (baseUrl: string, sid: string, options: T) => Promise<SynologyResponse<U>>) {
    const wrappedFunction = (options: T, shouldRetryRoutineFailures: boolean = true): Promise<SynologyResponse<U> | ConnectionFailure> => {
      const versionAtInit = this.settingsVersion;

      const settingsStillValid = () => {
        return this.settingsVersion === versionAtInit;
      };

      const unconditionallyRetry = () => {
        return wrappedFunction(options);
      };

      const retryIfAllowed = (response: SynologyFailureResponse) => {
        if (shouldRetryRoutineFailures && (response.error.code === SESSION_TIMEOUT_ERROR_CODE || response.error.code === NO_PERMISSIONS_ERROR_CODE)) {
          this.sidPromise = undefined;
          return wrappedFunction(options, false);
        } else {
          return response;
        }
      };

      // This can't really be unnested or broken into functions in a more-readable way. The recursive implementation
      // handling out-of-date settings breaks the abstraction provided by a series of .then, because if we ever hit
      // that branch we want to stop all further processing along the current line and defer entirely to that call.
      // Thus, if we flatten into a series .then, we will always run through successive .then and may end up making
      // several requests needlessly.
      return this.maybeLogin()
        .then(response => {
          if (settingsStillValid()) {
            if (isConnectionFailure(response)) {
              return response;
            } else if (response.success) {
              return fn(this.settings.baseUrl!, response.data.sid, options)
                .then(response => {
                  if (settingsStillValid()) {
                    if (isConnectionFailure(response) || response.success) {
                      return response;
                    } else {
                      return retryIfAllowed(response);
                    }
                  } else {
                    return unconditionallyRetry();
                  }
                });
            } else {
              return retryIfAllowed(response);
            }
          } else {
            return unconditionallyRetry();
          }
        })
        .catch(handleRejection);
    };

    return wrappedFunction;
  }

  public Auth = {
    Login: this.maybeLogin,
    Logout: this.maybeLogout,
  };

  public DownloadStation = {
    Info: {
      GetInfo: this.proxy(DownloadStation.Info.GetInfo, true),
      GetConfig: this.proxy(DownloadStation.Info.GetConfig, true),
      SetServerConfig: this.proxy(DownloadStation.Info.SetServerConfig),
    },
    Schedule: {
      GetConfig: this.proxy(DownloadStation.Schedule.GetConfig, true),
      SetConfig: this.proxy(DownloadStation.Schedule.SetConfig),
    },
    Statistic: {
      GetInfo: this.proxy(DownloadStation.Statistic.GetInfo, true),
    },
    Task: {
      List: this.proxy(DownloadStation.Task.List, true),
      GetInfo: this.proxy(DownloadStation.Task.GetInfo),
      Create: this.proxy(DownloadStation.Task.Create),
      Delete: this.proxy(DownloadStation.Task.Delete),
      Pause: this.proxy(DownloadStation.Task.Pause),
      Resume: this.proxy(DownloadStation.Task.Resume),
      Edit: this.proxy(DownloadStation.Task.Edit),
    }
  };

  public FileStation = {
    Info: {
      get: this.proxy(FileStation.Info.get),
    },
    List: {
      list_share: this.proxy(FileStation.List.list_share, true),
      list: this.proxy(FileStation.List.list),
      getinfo: this.proxy(FileStation.List.getinfo),
    }
  };
}
