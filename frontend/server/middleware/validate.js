/**
 * Zod Input Validation Middleware
 */
export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstError = result.error.issues[0]?.message || 'Invalid input data';
      return res.status(400).json({ error: firstError, details: result.error.issues });
    }
    req.validatedBody = result.data;
    next();
  };
}
