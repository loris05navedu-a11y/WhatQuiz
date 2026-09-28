import { ERRORS } from '../../../shared/constants';

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
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
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
