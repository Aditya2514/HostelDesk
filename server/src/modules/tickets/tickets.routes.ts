import { Router } from "express";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { TicketsController } from "./tickets.controller";
import { photoUploadMiddleware } from "../evidence/attachments.validator";
import { AttachmentsController } from "../evidence/attachments.controller";

export const ticketRouter = Router();

// All ticket endpoints require authentication
ticketRouter.use(requireAuth);

// Creation (STUDENT only)
ticketRouter.post("/", requireRole(Role.STUDENT), TicketsController.create);

// List and detail
ticketRouter.get("/", TicketsController.list);
ticketRouter.get("/:id", TicketsController.getById);
ticketRouter.get("/:id/events", TicketsController.getEvents);
ticketRouter.get("/:id/eta-explanation", TicketsController.getEtaExplanation);
ticketRouter.get("/:id/completion-code", TicketsController.getCompletionCode);

// Evidence photo uploads
ticketRouter.post("/:id/attachments", photoUploadMiddleware, AttachmentsController.upload);

// Follow common area ticket
ticketRouter.post("/:id/follow", requireRole(Role.STUDENT), TicketsController.follow);

// Student verification & dispute
ticketRouter.post("/:id/confirm", requireRole(Role.STUDENT), TicketsController.confirm);
ticketRouter.post("/:id/dispute", requireRole(Role.STUDENT), TicketsController.dispute);

// Staff actions
ticketRouter.post("/:id/start", requireRole(Role.STAFF), TicketsController.start);
ticketRouter.post("/:id/resolve", requireRole(Role.STAFF), TicketsController.resolve);
ticketRouter.post("/:id/room-locked", requireRole(Role.STAFF), TicketsController.roomLocked);
ticketRouter.post("/:id/hold", requireRole(Role.STAFF), TicketsController.hold);
ticketRouter.post("/:id/resume", requireRole(Role.STAFF), TicketsController.resume);
ticketRouter.post("/:id/disputes/code-refused", requireRole(Role.STAFF), TicketsController.codeRefused);

// Locked room occupant access & disputes
ticketRouter.get("/:id/access-slots", requireRole(Role.STUDENT), TicketsController.getAccessSlots);
ticketRouter.post("/:id/access", requireRole(Role.STUDENT), TicketsController.respondAccess);
ticketRouter.post("/:id/disputes/locked-claim", requireRole(Role.STUDENT), TicketsController.disputeLockedClaim);

// Warden / Chief Warden actions
ticketRouter.patch(
  "/:id/priority",
  requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN),
  TicketsController.updatePriority
);
ticketRouter.post(
  "/:id/reassign",
  requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN),
  TicketsController.reassign
);
ticketRouter.post(
  "/:id/assign",
  requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN),
  TicketsController.assign
);
ticketRouter.post(
  "/:id/reject",
  requireRole(Role.WARDEN, Role.CHIEF_WARDEN, Role.ADMIN),
  TicketsController.reject
);

// Comments
ticketRouter.post("/:id/comments", TicketsController.addComment);
ticketRouter.get("/:id/comments", TicketsController.getComments);
