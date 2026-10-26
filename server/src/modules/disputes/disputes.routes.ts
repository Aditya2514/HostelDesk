import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { DisputesController } from "./disputes.controller";

export const disputeRouter = Router();

disputeRouter.use(requireAuth, requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN));

disputeRouter.get("/", DisputesController.list);
disputeRouter.post("/:id/decide", DisputesController.decide);
