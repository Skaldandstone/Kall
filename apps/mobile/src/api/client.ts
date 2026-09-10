import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";
import { File } from "expo-file-system";

import { getClerkInstance } from "@clerk/expo";

const API_BASE_URL: string =
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ??
  "http://10.0.2.2:8000/api";

/**
 * The current Clerk session token, or null when signed out.
 *
 * Mobile talks to the API directly -- there is no Next.js proxy in front of
 * it as there is on web -- so the token has to be attached here. apiRequest is
 * a plain function rather than a hook, so this reads Clerk's singleton instead
 * of useAuth(); Clerk refreshes short-lived tokens itself, so this must be
 * called per request rather than cached.
 */
async function sessionToken(): Promise<string | null> {
  try {
    return (await getClerkInstance().session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((item: { msg?: string }) => item.msg)
        .filter(Boolean)
        .join(" · ");
    }
  } catch {
    // Non-JSON error body -- fall through to the generic message.
  }
  return fallback;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

type UploadPart = {
  uri: string;
  name: string;
  type: string;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = await sessionToken();
    if (!token) throw new ApiError("Not signed in", 401);
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && auth) {
    // Clerk owns the session; signing out is the provider's job, not ours.
    // Surfacing the error lets the screen react without this module reaching
    // into auth state it no longer manages.
    throw new ApiError("Your session expired. Please sign in again.", 401);
  }
  if (!response.ok) {
    throw new ApiError(
      await errorMessage(response, `Request failed (${response.status})`),
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiUpload<T>(
  path: string,
  field: string,
  file: UploadPart,
): Promise<T> {
  const token = await sessionToken();
  if (!token) throw new ApiError("Not signed in", 401);
  const nativeFile = new File(file.uri);
  if (!nativeFile.exists) {
    throw new ApiError("Kall could not read that file. Choose it again.", 400);
  }
  const body = new FormData();
  const bytes = await nativeFile.bytes();
  body.append(field, new Blob([bytes], { type: file.type }), file.name);
  const response = await expoFetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (response.status === 401)
    throw new ApiError("Your session expired. Please sign in again.", 401);
  if (!response.ok)
    throw new ApiError(
      await errorMessage(response, `Upload failed (${response.status})`),
      response.status,
    );
  return (await response.json()) as T;
}
