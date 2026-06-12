import { Router } from 'express';
import { BillingController } from '../controllers/BillingController';
import { authMiddleware } from '../middlewares/authMiddleware';

export function createBillingRoutes(billingController: BillingController): Router {
    const router = Router();

    router.post('/billing/checkout', authMiddleware, billingController.createCheckoutPreference);
    router.post('/billing/cancel', authMiddleware, billingController.cancelSubscription);
    router.get('/billing/subscription', authMiddleware, billingController.getSubscription);

    return router;
}
