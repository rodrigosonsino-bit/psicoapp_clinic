import { Router } from 'express';
import { BillingController } from '../controllers/BillingController';
import { authMiddleware } from '../middlewares/authMiddleware';

export function createBillingRoutes(billingController: BillingController): Router {
    const router = Router();

    // Endpoints protegidos por JWT
    router.post('/billing/checkout', authMiddleware, billingController.createCheckoutSession);
    router.post('/billing/portal', authMiddleware, billingController.createPortalSession);
    router.get('/billing/subscription', authMiddleware, billingController.getSubscription);

    return router;
}
