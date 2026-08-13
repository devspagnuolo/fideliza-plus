import { Router } from 'express';import { authRoutes } from './auth.routes.js';import { adminRoutes } from './admin.routes.js';import { customerRoutes } from './customer.routes.js';import { commerceRoutes } from './commerce.routes.js';import { growthRoutes } from './growth.routes.js';
export const apiRoutes=Router();apiRoutes.use(authRoutes,adminRoutes,customerRoutes,commerceRoutes,growthRoutes);
