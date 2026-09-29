import { ERRORS } from '../../../shared/constants';
import { API_ORIGIN, getToken, SEPARATE_BACKEND } from '../lib/backend';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Appel JSON vers l'API. Les erreurs sont toujours converties en message lisible. */
export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    const token = getToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (SEPARATE_BACKEND) headers['X-Auth-Mode'] = 'token';
    if (token) headers.Authorization = `Bearer ${token}`;
    response = await fetch(`${API_ORIGIN}/api${path}`, {
      method,
      credentials: SEPARATE_BACKEND ? 'omit' : 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, ERRORS.connectionLost);
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new ApiError(response.status, data?.error ?? ERRORS.generic);
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : ERRORS.generic;
}
