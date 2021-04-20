import { BaseRequest, FormFile, SynologyResponse, get, post } from "./shared";

const TASK_API_NAME = "SYNO.DownloadStation2.Task" as const;
const TASK_CGI_NAME = "entry";

interface BaseDownloadStation2TaskCreateRequest extends BaseRequest {
  create_list?: boolean;
  destination?: string;
  extract_password?: string;
}

export interface DownloadStation2TaskCreateFileRequest
  extends BaseDownloadStation2TaskCreateRequest {
  type: "file";
  file: FormFile;
}

export interface DownloadStation2TaskCreateUrlRequest
  extends BaseDownloadStation2TaskCreateRequest {
  type: "url";
  url: string[];
}

export interface DownloadStation2TaskCreateLocalRequest
  extends BaseDownloadStation2TaskCreateRequest {
  type: "local";
  local_path: string;
}

export type DownloadStation2TaskCreateRequest =
  | DownloadStation2TaskCreateFileRequest
  | DownloadStation2TaskCreateUrlRequest
  | DownloadStation2TaskCreateLocalRequest;

export interface DownloadStation2TaskCreateResponse {
  list_id: string[];
  task_id: string[];
}

function Task_Create(
  baseUrl: string,
  sid: string,
  options: DownloadStation2TaskCreateRequest,
): Promise<SynologyResponse<DownloadStation2TaskCreateResponse>> {
  const commonOptions = {
    ...options,
    type: JSON.stringify(options.type),
    // undefined means default location configured on the NAS, which is represented by empty string
    destination: JSON.stringify(options.destination ?? ""),
    create_list: JSON.stringify(options.create_list ?? false),
    api: TASK_API_NAME,
    version: 2,
    method: "create",
    sid,
    file: undefined,
    url: undefined,
    local_path: undefined,
  };

  if (options.type === "file") {
    return post(baseUrl, TASK_CGI_NAME, {
      ...commonOptions,
      // TODO: Check that this works.
      file: '["torrent"]',
      torrent: options.file,
    });
  } else if (options.type === "url") {
    return get(baseUrl, TASK_CGI_NAME, {
      ...commonOptions,
      // TODO: Check that this works.
      url: options.url && options.url.length ? options.url.join(",") : undefined,
    });
  } else if (options.type === "local") {
    return get(baseUrl, TASK_CGI_NAME, {
      ...commonOptions,
      local_path: options.local_path,
    });
  } else {
    return Promise.reject(new Error(`illegal type "${(options as any)?.type}"`));
  }
}

const Task = {
  API_NAME: TASK_API_NAME,
  Create: Task_Create,
};

// ------------------------------------------------------------------------- //
//                                  exports                                  //
// ------------------------------------------------------------------------- //

export const DownloadStation2 = {
  Task,
};
