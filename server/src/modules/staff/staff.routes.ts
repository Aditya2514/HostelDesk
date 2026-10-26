import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware";
import { StaffController } from "./staff.controller";

export const staffRouter = Router();

staffRouter.use(requireAuth);

staffRouter.get("/", StaffController.listStaff);
staffRouter.get("/:id/schedule", StaffController.getSchedule);
