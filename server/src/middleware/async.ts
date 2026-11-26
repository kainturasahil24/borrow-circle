import type { NextFunction, Request, RequestHandler, Response } from 'express'

type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

/**
 * Express 4 does not forward rejected promises to the error handler.
 * Every async route is wrapped so failures become normal `next(err)` calls.
 */
export function asyncHandler(handler: AsyncRoute): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}
