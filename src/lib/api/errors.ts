export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "EMAIL_TAKEN"
  | "INVALID_CREDENTIALS"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

/** Every API error uses the shape `{ error: { code, message } }`. */
export function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json({ error: { code, message } }, { status, headers });
}

/** Logs the real error server-side and returns a generic 500 to the client. */
export function internalErrorResponse(err: unknown): Response {
  console.error(err);
  return errorResponse(500, "INTERNAL_ERROR", "Something went wrong.");
}
