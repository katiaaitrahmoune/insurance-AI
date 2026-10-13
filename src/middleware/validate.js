import { unprocessable } from '../utils/errors.js';

/** validate({ body, query, params }) — parsed values land on req.validated.<part>. */
export const validate = (schemas) => (req, _res, next) => {
  req.validated = req.validated ?? {};
  for (const [part, schema] of Object.entries(schemas)) {
    const result = schema.safeParse(req[part] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({ field: i.path.join('.') || part, message: i.message }));
      return next(unprocessable(details[0] ? `${details[0].field}: ${details[0].message}` : 'Validation failed', details));
    }
    req.validated[part] = result.data;
  }
  next();
};
