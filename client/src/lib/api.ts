const BASE_URL = import.meta.env.VITE_API_URL || "";

/** Fired on any 401 from a non-auth endpoint; AuthContext listens and logs the user out locally. */
export const SESSION_EXPIRED_EVENT = "hosteldesk:session-expired";

export class ApiError extends Error {
  public code: string;
  public status: number;
  public details?: any;

  constructor(message: string, code: string = "UNKNOWN_ERROR", status: number = 500, details?: any) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions extends RequestInit {
  data?: any;
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { data, headers, ...customConfig } = options;

  const config: RequestInit = {
    ...customConfig,
    credentials: "include", // Required for httpOnly cookie transport
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  };

  if (data !== undefined) {
    config.body = JSON.stringify(data);
  }

  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, config);
  } catch (err: any) {
    throw new ApiError(
      err?.message || "Network error. Please check your connection.",
      "NETWORK_ERROR",
      0
    );
  }

  let jsonResult: any;
  try {
    jsonResult = await response.json();
  } catch {
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, "HTTP_ERROR", response.status);
    }
    return {} as T;
  }

  if (!response.ok) {
    // Session expired or cookie missing: tell the auth layer so the app returns to the login
    // page instead of leaving the user on a page where every request fails.
    if (response.status === 401 && !endpoint.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }

    const errorData = jsonResult?.error;
    const message = errorData?.message || jsonResult?.message || "An unexpected error occurred";
    const code = errorData?.code || "ERROR";
    const details = errorData?.details !== undefined ? errorData.details : jsonResult?.details;
    throw new ApiError(message, code, response.status, details);
  }

  return jsonResult as T;
}

export const api = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "GET" }),
  post: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "POST", data }),
  put: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "PUT", data }),
  patch: <T>(endpoint: string, data?: any, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "PATCH", data }),
  delete: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { ...options, method: "DELETE" }),
  upload: async <T>(endpoint: string, formData: FormData): Promise<T> => {
    const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        credentials: "include",
        body: formData,
      });
    } catch (err: any) {
      throw new ApiError(err?.message || "Network error. Please check connection.", "NETWORK_ERROR", 0);
    }
    let jsonResult: any;
    try {
      jsonResult = await response.json();
    } catch {
      if (!response.ok) throw new ApiError(`Upload failed with status ${response.status}`, "HTTP_ERROR", response.status);
      return {} as T;
    }
    if (!response.ok) {
      const errorData = jsonResult?.error;
      const message = errorData?.message || jsonResult?.message || "Upload failed";
      const code = errorData?.code || "UPLOAD_ERROR";
      throw new ApiError(message, code, response.status);
    }
    return jsonResult as T;
  },
};
