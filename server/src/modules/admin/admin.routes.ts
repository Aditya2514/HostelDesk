import { Router, Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { AuditService } from "./audit.service";

const router = Router();

// Strictly ADMIN only for all /api/admin endpoints
router.use(requireAuth);
router.use(requireRole([Role.ADMIN]));

/**
 * GET /api/admin/audit-log
 * Paginated audit logs, newest first
 */
router.get("/audit-log", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(String(req.query.page || "1"), 10);
    const limit = parseInt(String(req.query.limit || "20"), 10);
    const result = await AuditService.getAuditLogs(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as adminRoutes };
