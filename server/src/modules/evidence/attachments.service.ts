import { PrismaClient, AttachmentKind, TicketStatus, LocationType, Role, EventType } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuthenticatedUser } from "../../types/express";
import { uploadToCloudinary, deleteFromCloudinary, CloudinaryUploadResult } from "./cloudinary";
import {
  MAX_PHOTO_SIZE,
  MAX_PHOTOS_PER_REQUEST,
  ALLOWED_MIME_TYPES,
  isValidImageMagicBytes,
} from "./attachments.validator";

const OPEN_STATUSES: TicketStatus[] = [
  TicketStatus.RAISED,
  TicketStatus.ASSIGNED,
  TicketStatus.IN_PROGRESS,
  TicketStatus.AWAITING_ACCESS,
  TicketStatus.ON_HOLD,
  TicketStatus.REOPENED,
];

export class AttachmentsService {
  /**
   * Validates photo evidence and uploads to Cloudinary with database and event records.
   */
  static async uploadPhotos(
    ticketId: string,
    user: AuthenticatedUser,
    kind: AttachmentKind,
    files: Express.Multer.File[],
    prisma: PrismaClient = defaultPrisma
  ) {
    if (!files || files.length === 0) {
      throw new AppError(400, "NO_FILES_PROVIDED", "Please provide at least one photo");
    }

    if (files.length > MAX_PHOTOS_PER_REQUEST) {
      throw new AppError(400, "TOO_MANY_FILES", "Maximum 3 photos per upload");
    }

    if (![AttachmentKind.BEFORE, AttachmentKind.AFTER, AttachmentKind.DOOR].includes(kind)) {
      throw new AppError(400, "INVALID_ATTACHMENT_KIND", "Invalid photo kind: must be BEFORE, AFTER, or DOOR");
    }

    // Validate size and magic bytes on every file
    for (const file of files) {
      if (file.size > MAX_PHOTO_SIZE) {
        throw new AppError(400, "FILE_TOO_LARGE", "Maximum photo size is 5 MB");
      }
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype) || !isValidImageMagicBytes(file.buffer)) {
        throw new AppError(400, "INVALID_IMAGE_TYPE", "Only JPEG, PNG, WebP, and HEIC images are allowed");
      }
    }

    // Retrieve ticket
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        followers: { select: { userId: true } },
      },
    });

    if (!ticket) {
      throw new AppError(404, "NOT_FOUND", "Ticket not found");
    }

    // Validate who can upload what kind and when
    if (kind === AttachmentKind.BEFORE) {
      if (!OPEN_STATUSES.includes(ticket.status)) {
        throw new AppError(400, "TICKET_NOT_OPEN", "Before photos can only be uploaded while the ticket is open");
      }

      let canUpload = false;
      if (user.role === Role.ADMIN || user.role === Role.CHIEF_WARDEN) {
        canUpload = true;
      } else if (ticket.locationType === LocationType.ROOM) {
        canUpload = Boolean(user.role === Role.STUDENT && user.currentRoomId && ticket.roomId === user.currentRoomId);
      } else {
        canUpload = Boolean(ticket.raisedById === user.id || ticket.followers.some((f) => f.userId === user.id));
      }

      if (!canUpload) {
        throw new AppError(403, "FORBIDDEN", "Only current room occupants or complaint reporters can upload before photos");
      }
    } else if (kind === AttachmentKind.AFTER) {
      if (ticket.status !== TicketStatus.IN_PROGRESS) {
        throw new AppError(400, "TICKET_NOT_IN_PROGRESS", "After photos can only be uploaded while the ticket is in progress");
      }

      const isAssignedStaff = user.role === Role.STAFF && ticket.assignedToId === user.id;
      if (!isAssignedStaff && user.role !== Role.ADMIN) {
        throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can upload after photos");
      }
    } else if (kind === AttachmentKind.DOOR) {
      if (ticket.locationType !== LocationType.ROOM) {
        throw new AppError(400, "DOOR_PHOTO_ROOM_ONLY", "Door photos are only permitted for room tickets");
      }

      if (ticket.status !== TicketStatus.ASSIGNED && ticket.status !== TicketStatus.IN_PROGRESS) {
        throw new AppError(400, "INVALID_STATUS_FOR_DOOR", "Door photos can only be uploaded while assigned or in progress");
      }

      const isAssignedStaff = user.role === Role.STAFF && ticket.assignedToId === user.id;
      if (!isAssignedStaff && user.role !== Role.ADMIN) {
        throw new AppError(403, "FORBIDDEN", "Only the assigned staff member can upload door photos");
      }
    }

    const now = clock.now();
    const uploadedResults: Array<{ file: Express.Multer.File; uploadResult: CloudinaryUploadResult }> = [];

    for (const file of files) {
      try {
        const uploadResult = await uploadToCloudinary(
          file.buffer,
          `hosteldesk/${ticket.code}`
        );
        uploadedResults.push({ file, uploadResult });
      } catch (err) {
        console.error("[AttachmentsService] Cloudinary upload failed:", err);
        // Clean up any successfully uploaded images in this batch
        for (const item of uploadedResults) {
          await deleteFromCloudinary(item.uploadResult.publicId).catch(() => {});
        }
        throw new AppError(502, "UPLOAD_FAILED", "Photo upload failed, please try again");
      }
    }

    const createdAttachments = [];

    for (const item of uploadedResults) {
      const attachment = await prisma.attachment.create({
        data: {
          ticketId: ticket.id,
          uploaderId: user.id,
          url: item.uploadResult.url,
          publicId: item.uploadResult.publicId,
          kind,
          createdAt: now,
        },
        include: {
          uploader: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

      createdAttachments.push(attachment);
    }

    // Record PHOTO_ADDED timeline event
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: user.id,
        type: EventType.PHOTO_ADDED,
        note: `${kind} photo added (${files.length} photo${files.length > 1 ? "s" : ""})`,
        createdAt: now,
      },
    });

    return createdAttachments.map((a) => ({
      id: a.id,
      url: a.url,
      publicId: a.publicId,
      kind: a.kind,
      createdAt: a.createdAt,
      uploader: {
        id: a.uploader.id,
        name: a.uploader.name,
        role: a.uploader.role,
      },
    }));
  }
}
