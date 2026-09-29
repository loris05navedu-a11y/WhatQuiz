import { ERRORS } from '../../../shared/constants';
import { API_ORIGIN, getToken, SEPARATE_BACKEND, STANDALONE } from '../lib/backend';
import { ApiError } from './errors';

export { ApiError, errorMessage } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** Appel JSON vers l'API. Les erreurs sont toujours converties en message lisible. */
export async function api<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  if (STANDALONE) {
    const { localApi } = await import('../standalone/api');
    return localApi<T>(method, path, body);
  }
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
