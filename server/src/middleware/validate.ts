import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

/**
 * Express middleware factory: validates req.body against a Zod schema.
 *
 * On success, replaces req.body with the parsed (coerced + stripped) data
 * so downstream handlers receive clean, typed values.
 *
 * On failure, returns 400 with a structured error response showing
 * field-level issues.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      res.status(400).json({
        error: "Validation failed",
        details: formatted,
      });
      return;
    }
    // Replace body with parsed data (coerced types, stripped unknown keys)
    req.body = result.data;
    next();
  };
}

/**
 * Format ZodError into a flat array of { path, message } objects.
 * Example: [{ path: "deal_parameters.price_paid", message: "Expected number, received string" }]
 */
function formatZodError(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}
