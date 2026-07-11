import { Router } from 'express';
import { container } from '../../container';
import { HealthController } from '../controllers/HealthController';
import { asyncHandler } from '../middlewares/asyncHandler';

export function createHealthRoutes(): Router {
    const router = Router();
    const controller = container.resolve(HealthController);

    router.get('/health', asyncHandler((req, res) => controller.check(req, res)));
    router.get('/health/liveness', asyncHandler((req, res) => controller.liveness(req, res)));
    router.get('/health/readiness', asyncHandler((req, res) => controller.readiness(req, res)));

    return router;
}
