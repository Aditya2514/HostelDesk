import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { AnalyticsController } from "./analytics.controller";

const router = Router();

// Only WARDEN, CHIEF_WARDEN, and ADMIN can access analytics
router.use(requireAuth);
router.use(requireRole([Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN]));

router.get("/overview", AnalyticsController.getOverview);
router.get("/staff", AnalyticsController.getStaff);
router.get("/prediction-trend", AnalyticsController.getPredictionTrend);
router.get("/repeat-rooms", AnalyticsController.getRepeatRooms);

export { router as analyticsRoutes };
