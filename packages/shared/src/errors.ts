// Domain/application error codes shared across services and mapped to HTTP by the
// error handler, and to GraphQL `extensions.code` by the gateway.
export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_STATE'
  | 'VALIDATION'
  | 'INTERNAL';

const CODE_TO_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  VALIDATION: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
  }
  get status(): number {
    return CODE_TO_STATUS[this.code];
  }
}

// Convenience factories
export const Errors = {
  unauthenticated: (m = 'Authentication required') => new AppError('UNAUTHENTICATED', m),
  forbidden: (m = 'Not allowed') => new AppError('FORBIDDEN', m),
  notFound: (m = 'Not found') => new AppError('NOT_FOUND', m),
  conflict: (m = 'Conflict') => new AppError('CONFLICT', m),
  invalidState: (m = 'Invalid state') => new AppError('INVALID_STATE', m),
  validation: (m = 'Validation failed') => new AppError('VALIDATION', m),
};
