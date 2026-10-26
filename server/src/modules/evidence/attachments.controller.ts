import { Request, Response, NextFunction } from "express";
import { AttachmentKind } from "@prisma/client";
import { AttachmentsService } from "./attachments.service";
import { AppError } from "../../lib/errors";

export class AttachmentsController {
  static async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const ticketId = req.params.id;
      const kind = (req.body.kind || req.body.role) as AttachmentKind;
      const files = req.files as Express.Multer.File[];

      if (!kind) {
        throw new AppError(400, "KIND_REQUIRED", "Field 'kind' or 'role' is required (BEFORE, AFTER, or DOOR)");
      }

      const attachments = await AttachmentsService.uploadPhotos(
        ticketId,
        req.user!,
        kind,
        files
      );

      res.status(201).json({
        success: true,
        attachments,
        attachment: attachments[0],
      });
    } catch (err) {
      next(err);
    }
  }
}
