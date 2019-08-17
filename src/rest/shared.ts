import Axios from "axios";
import { stringify } from "query-string";

export const SessionName = {
  DownloadStation: "DownloadStation" as const,
  FileStation: "FileStation" as const,
};

export type SessionName = keyof typeof SessionName;

export interface FormFile {
  content: Blob;
  filename: string;
}

export function isFormFile(f?: any): f is FormFile {
  return f && (f as FormFile).content != null && (f as FormFile).filename != null;
}

export interface SynologySuccessResponse<S> {
  success: true;
  data: S;
}

export interface SynologyFailureResponse {
  success: false;
  error: {
    code: number;
    errors?: any[];
  };
}

export type SynologyResponse<S> = SynologySuccessResponse<S> | SynologyFailureResponse;

export interface BaseRequest {
  timeout?: number;
}

export interface SynologyApiRequest {
  api: string;
  version: number;
  method: string;
  sid?: string;
  timeout?: number;
  [key: string]: string | number | FormFile | undefined;
}

const DEFAULT_TIMEOUT = 60000;

export async function get<O extends object>(
  baseUrl: string,
  cgi: string,
  request: SynologyApiRequest
): Promise<SynologyResponse<O>> {
  const url = `${baseUrl}/webapi/${cgi}.cgi?${stringify({
    ...request,
    _sid: request.sid,
    timeout: undefined,
  })}`;

  return (await Axios.get(url, {
    timeout: request.timeout || DEFAULT_TIMEOUT,
    withCredentials: false,
  })).data;
}

export async function post<O extends object>(
  baseUrl: string,
  cgi: string,
  request: SynologyApiRequest
): Promise<SynologyResponse<O>> {
  const formData = new FormData();

  Object.keys(request).forEach(k => {
    const v = request[k];
    if (k !== "timeout" && v !== undefined && !isFormFile(v)) {
      // String() !== new String(). This produces lowercase-s strings, not capital-S Strings.
      formData.append(k, String(v));
    }
  });

  if (request.sid) {
    formData.append("_sid", request.sid);
  }

  Object.keys(request).forEach(k => {
    const v = request[k];
    if (k !== "timeout" && v !== undefined && isFormFile(v)) {
      formData.append(k, v.content, v.filename);
    }
  });

  const url = `${baseUrl}/webapi/${cgi}.cgi`;

  return (await Axios.post(url, formData, {
    timeout: request.timeout || DEFAULT_TIMEOUT,
    withCredentials: false,
  })).data;
}

export class ApiBuilder {
  constructor(private cgiName: string, private apiName: string) {}

  makeGet<I extends BaseRequest, O>(
    methodName: string,
    preprocess?: (options: I) => object,
    postprocess?: (response: O) => O
  ): (baseUrl: string, sid: string, options: I) => Promise<SynologyResponse<O>>;
  makeGet<I extends BaseRequest, O>(
    methodName: string,
    preprocess: ((options?: I) => object) | undefined,
    postprocess: ((response: O) => O) | undefined,
    optional: true
  ): (baseUrl: string, sid: string, options?: I) => Promise<SynologyResponse<O>>;

  makeGet(
    methodName: string,
    preprocess?: (options: object) => object,
    postprocess?: (response: object) => object,
    _optional?: true
  ) {
    return this.makeApiRequest(get, methodName, preprocess, postprocess);
  }

  makePost<I extends BaseRequest, O>(
    methodName: string,
    preprocess?: (options: I) => object,
    postprocess?: (response: O) => O
  ): (baseUrl: string, sid: string, options: I) => Promise<SynologyResponse<O>>;
  makePost<I extends BaseRequest, O>(
    methodName: string,
    preprocess: ((options?: I) => object) | undefined,
    postprocess: ((response: O) => O) | undefined,
    optional: true
  ): (baseUrl: string, sid: string, options?: I) => Promise<SynologyResponse<O>>;

  makePost(
    methodName: string,
    preprocess?: (options: object) => object,
    postprocess?: (response: object) => object,
    _optional?: true
  ) {
    return this.makeApiRequest(post, methodName, preprocess, postprocess);
  }

  private makeApiRequest(
    method: (typeof get) | (typeof post),
    methodName: string,
    preprocess?: (options: object) => object,
    postprocess?: (response: object) => object
  ) {
    preprocess = preprocess || (o => o);
    postprocess = postprocess || (r => r);
    return async (baseUrl: string, sid: string, options?: object) => {
      const response = await method(baseUrl, this.cgiName, {
        ...preprocess!(options || {}),
        api: this.apiName,
        version: 1,
        method: methodName,
        sid,
      });
      if (response.success) {
        return { ...response, data: postprocess!(response.data) };
      } else {
        return response;
      }
    };
  }
}
