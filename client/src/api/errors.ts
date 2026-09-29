import { ERRORS } from '../../../shared/constants';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : ERRORS.generic;
}
