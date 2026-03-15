/**
 * Safely extract an error message from an unknown catch value.
 * Handles Error instances, strings, and unknown types.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "An unknown error occurred";
}
