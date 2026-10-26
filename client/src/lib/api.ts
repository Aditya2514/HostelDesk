const BASE_URL = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  public code: string;
  public status: number;

  constructor(message: string, code: string = "UNKNOWN_ERROR", status: number = 500) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
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
    const errorData = jsonResult?.error;
    const message = errorData?.message || jsonResult?.message || "An unexpected error occurred";
    const code = errorData?.code || "ERROR";
    throw new ApiError(message, code, response.status);
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
};
