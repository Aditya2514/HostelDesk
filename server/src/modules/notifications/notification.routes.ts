import { Router } from "express";
import { NotificationController } from "./notification.controller";
import { requireAuth } from "../../middleware/auth.middleware";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get("/", NotificationController.list);
notificationRouter.post("/read-all", NotificationController.markAllAsRead);
notificationRouter.post("/:id/read", NotificationController.markAsRead);
