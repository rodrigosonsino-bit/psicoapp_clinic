import { Router } from 'express';
import { Pool } from 'pg';
import { GoogleCalendarController } from '../controllers/GoogleCalendarController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { createTrialCheckMiddleware } from '../middlewares/trialCheckMiddleware';

export function createGoogleRoutes(controller: GoogleCalendarController, dbPool: Pool): Router {
    const router = Router();
    const trialCheck = createTrialCheckMiddleware(dbPool);

    router.get('/google/auth-url', authMiddleware, trialCheck, controller.getAuthUrl.bind(controller));
    router.get('/google/callback', controller.handleCallback.bind(controller));
    router.get('/google/status', authMiddleware, trialCheck, controller.getStatus.bind(controller));
    router.get('/google/calendars', authMiddleware, trialCheck, controller.listCalendars.bind(controller));
    router.post('/google/select-calendar', authMiddleware, trialCheck, controller.selectCalendar.bind(controller));
    router.post('/google/disconnect', authMiddleware, trialCheck, controller.disconnect.bind(controller));
    router.post('/google/sync', authMiddleware, trialCheck, controller.triggerSync.bind(controller));
    router.get('/google/events', authMiddleware, trialCheck, controller.getEvents.bind(controller));
    router.post('/google/events/toggle', authMiddleware, trialCheck, controller.toggleEventAutoSend.bind(controller));

    return router;
}
