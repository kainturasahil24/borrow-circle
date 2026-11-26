import { Router } from 'express'
import { adminRouter } from './admin.routes'
import { authRouter } from './auth.routes'
import { meRouter } from './me.routes'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/me', meRouter)
apiRouter.use('/admin', adminRouter)
