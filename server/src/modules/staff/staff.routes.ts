import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { StaffController } from "./staff.controller";

export const staffRouter = Router();

staffRouter.use(requireAuth);

// Only wardens and admins need the staff directory (for reassigning tickets).
staffRouter.get(
  "/",
  requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN),
  StaffController.listStaff
);
staffRouter.get("/:id/schedule", StaffController.getSchedule);
