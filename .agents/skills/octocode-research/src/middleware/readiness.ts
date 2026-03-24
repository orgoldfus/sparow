import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { isServerReady } from '../mcpCache.js';

export const checkReadiness: RequestHandler = (_req: Request, res: Response, next: NextFunction) => {
  if (!isServerReady()) {
    res.status(503).json({
      success: false,
      error: {
        message: 'Server is initializing',
        code: 'SERVER_INITIALIZING',
        hint: 'Please retry in a few seconds',
      },
    });
    return;
  }
  next();
};
