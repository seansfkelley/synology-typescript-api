import Axios from 'axios';
import { stringify } from 'query-string';

export const SessionName = {
  DownloadStation: 'DownloadStation' as 'DownloadStation',
  FileStation: 'FileStation' as 'FileStation'
};

export type SessionName = keyof typeof SessionName;

export interface FormFile {
  content: Blob;
  filename: string;
}

export function isFormFile(f?: any): f is FormFile {
  return f && (f as FormFile).content != null && (f as FormFile).filename != null;
}

export type SynologyResponse<S> = {
  success: true;
  data: S;
} | {
  success: false;
  error: {
    code: number;
    errors?: any[];
  };
};

export interface BaseRequest {
  timeout?: number;
}

export interface SynologyApiRequest {
  api: string;
  version: number;
  method: string;
  sid?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT = 60000;

export function get<I extends SynologyApiRequest, O>(baseUrl: string, cgi: string, request: I): Promise<SynologyResponse<O>> {
  const url = `${baseUrl}/webapi/${cgi}.cgi?${stringify({
    ...(request as object),
    _sid: request.sid,
    timeout: undefined
  })}`;

  return Axios.get(url, { timeout: request.timeout || DEFAULT_TIMEOUT }).then(response => {
    return response.data;
  });
}

export function post<I extends SynologyApiRequest, O>(baseUrl: string, cgi: string, request: I): Promise<SynologyResponse<O>> {
  const formData = new FormData();

  Object.keys(request).forEach((k: keyof typeof request) => {
    const v = request[k];
    if (k !== 'timeout' && v !== undefined && !isFormFile(v)) {
      formData.append(k, v);
    }
  });

  if (request.sid) {
    formData.append('_sid', request.sid);
  }

  Object.keys(request).forEach((k: keyof typeof request) => {
    const v = request[k];
    if (k !== 'timeout' && v !== undefined && isFormFile(v)) {
      formData.append(k, v.content, v.filename);
    }
  });

  const url = `${baseUrl}/webapi/${cgi}.cgi`;

  return Axios.post(url, formData, { timeout: request.timeout || DEFAULT_TIMEOUT }).then(response => {
    return response.data;
  });
}

export class ApiBuilder {
  constructor(private cgiName: string, private apiName: string) {}

  makeGet<I extends BaseRequest, O>(methodName: string, preprocess?: (options: I) => object): (baseUrl: string, sid: string, options: I) => Promise<SynologyResponse<O>>;
  makeGet<I extends BaseRequest, O>(methodName: string, preprocess: ((options?: I) => object) | undefined, optional: true): (baseUrl: string, sid: string, options?: I) => Promise<SynologyResponse<O>>;

  makeGet(methodName: string, preprocess?: (options: object) => object, _optional?: true) {
    return this.makeApiRequest(get, methodName, preprocess);
  }

  makePost<I extends BaseRequest, O>(methodName: string, preprocess?: (options: I) => object): (baseUrl: string, sid: string, options: I) => Promise<SynologyResponse<O>>;
  makePost<I extends BaseRequest, O>(methodName: string, preprocess: ((options?: I) => object) | undefined, optional: true): (baseUrl: string, sid: string, options?: I) => Promise<SynologyResponse<O>>;

  makePost(methodName: string, preprocess?: (options: object) => object, _optional?: true) {
    return this.makeApiRequest(post, methodName, preprocess);
  }

  private makeApiRequest(method: (typeof get) | (typeof post), methodName: string, preprocess?: (options: object) => object) {
    preprocess = preprocess || (o => o);
    return (baseUrl: string, sid: string, options?: object) => {
      return method(baseUrl, this.cgiName, {
        ...preprocess!(options || {}),
        api: this.apiName,
        version: 1,
        method: methodName,
        sid
      });
    };
  }
}
