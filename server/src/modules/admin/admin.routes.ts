import { Router, Request, Response, NextFunction } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { AuditService } from "./audit.service";
import { OccupancyService } from "./occupancy.service";

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

/**
 * GET /api/admin/rooms?blockId=&floor=
 * Rooms with current occupants
 */
router.get("/rooms", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const blockId = req.query.blockId ? String(req.query.blockId) : undefined;
    const floor = req.query.floor !== undefined ? parseInt(String(req.query.floor), 10) : undefined;
    const rooms = await OccupancyService.getRooms({ blockId, floor });
    res.json({ rooms });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/students?search=&page=&limit=
 * Paginated student directory with current room
 */
router.get("/students", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const search = req.query.search ? String(req.query.search) : undefined;
    const page = parseInt(String(req.query.page || "1"), 10);
    const limit = parseInt(String(req.query.limit || "20"), 10);
    const result = await OccupancyService.getStudents({ search, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/occupancy/move
 * Move student to a room in one transaction
 */
router.post("/occupancy/move", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { userId, roomId, effectiveDate } = req.body;
    if (!userId || !roomId) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "userId and roomId are required" },
      });
    }

    const result = await OccupancyService.moveStudent({
      actorId: req.user!.id,
      userId,
      roomId,
      effectiveDate,
    });

    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/occupancy/:id/end
 * End student occupancy without new room
 */
router.post("/occupancy/:id/end", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const occupancyId = req.params.id;
    const { toDate } = req.body;
    const result = await OccupancyService.endOccupancy({
      actorId: req.user!.id,
      occupancyId,
      toDate,
    });

    res.status(200).json({ success: true, occupancy: result });
  } catch (err) {
    next(err);
  }
});

import multer from "multer";
import { CsvImportService } from "./csv-import.service";

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1 MB
});

/**
 * POST /api/admin/import/students?mode=preview|apply
 * Multipart CSV upload (max 1 MB, max 1000 rows)
 * preview: returns validation status for each row
 * apply: atomic all-or-nothing transaction, returns temporary passwords CSV
 */
router.post(
  "/import/students",
  uploadCsv.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: { code: "FILE_REQUIRED", message: "CSV file is required" },
        });
      }
      const csvContent = req.file.buffer.toString("utf8");
      const mode = (req.query.mode as string) || "preview";

      if (mode === "apply") {
        const result = await CsvImportService.applyImport(req.user!.id, csvContent);
        return res.json(result);
      } else {
        const result = await CsvImportService.validateCsv(csvContent);
        return res.json(result);
      }
    } catch (err) {
      next(err);
    }
  }
);

import { StaffService } from "./staff.service";

/**
 * GET /api/admin/staff
 * All staff with trade, active flag, open-ticket count and shifts
 */
router.get("/staff", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const staff = await StaffService.getStaff();
    res.json({ staff });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/staff
 * Create staff account with temporary password
 */
router.post("/staff", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, email, trade } = req.body;
    const result = await StaffService.createStaff({
      actorId: req.user!.id,
      name,
      email,
      trade,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/staff/:id
 * Toggle staff active status; if open tickets exist and reassignOpenTickets: false -> 409
 */
router.patch("/staff/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const staffId = req.params.id;
    const { isActive, reassignOpenTickets } = req.body;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "isActive (boolean) is required" },
      });
    }

    const result = await StaffService.updateStaffStatus({
      actorId: req.user!.id,
      staffId,
      isActive,
      reassignOpenTickets: Boolean(reassignOpenTickets),
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/staff/:id/shifts
 * Replaces all shift windows for a staff member
 */
router.put("/staff/:id/shifts", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const staffId = req.params.id;
    const { shifts } = req.body;
    const result = await StaffService.updateStaffShifts({
      actorId: req.user!.id,
      staffId,
      shifts: shifts || [],
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { router as adminRoutes };


