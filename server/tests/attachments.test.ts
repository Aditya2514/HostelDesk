import { describe, it, expect, vi, beforeEach } from "vitest";
import { AttachmentKind, TicketStatus, LocationType, Role, EventType } from "@prisma/client";
import { AttachmentsService } from "../src/modules/evidence/attachments.service";
import { isValidImageMagicBytes } from "../src/modules/evidence/attachments.validator";
import { AppError } from "../src/lib/errors";

// Mock Cloudinary upload
vi.mock("../src/modules/evidence/cloudinary", () => ({
  uploadToCloudinary: vi.fn().mockImplementation(async (buffer: Buffer, folder: string) => {
    return {
      publicId: `${folder}/mock_public_id_${Date.now()}`,
      url: `https://res.cloudinary.com/demo/image/upload/v1234/${folder}/photo.jpg`,
      format: "jpg",
      bytes: buffer.length,
    };
  }),
  deleteFromCloudinary: vi.fn().mockResolvedValue(undefined),
}));

describe("Photo Evidence Uploads & Validations (modules/evidence)", () => {
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  const invalidBuffer = Buffer.from("this is a plain text file, not an image!");

  it("validates magic bytes correctly", () => {
    expect(isValidImageMagicBytes(validJpegBuffer)).toBe(true);
    expect(isValidImageMagicBytes(validPngBuffer)).toBe(true);
    expect(isValidImageMagicBytes(invalidBuffer)).toBe(false);
  });

  const mockUserStudent: any = {
    id: "student-1",
    name: "Aarav Sharma",
    role: Role.STUDENT,
    currentRoomId: "room-101",
  };

  const mockUserStaff: any = {
    id: "staff-ramesh",
    name: "Ramesh Kumar",
    role: Role.STAFF,
  };

  const mockUserOtherStaff: any = {
    id: "staff-suresh",
    name: "Suresh Patil",
    role: Role.STAFF,
  };

  const mockRoomTicket: any = {
    id: "ticket-1",
    code: "HD-0001",
    locationType: LocationType.ROOM,
    roomId: "room-101",
    blockId: "block-a",
    status: TicketStatus.ASSIGNED,
    assignedToId: "staff-ramesh",
    raisedById: "student-1",
    followers: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-image or spoofed mime types with 400 INVALID_IMAGE_TYPE", async () => {
    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
    };

    const files: any[] = [
      {
        originalname: "fake.jpg",
        mimetype: "image/jpeg",
        size: invalidBuffer.length,
        buffer: invalidBuffer,
      },
    ];

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStudent,
        AttachmentKind.BEFORE,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("rejects files exceeding 5 MB with 400 FILE_TOO_LARGE", async () => {
    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
    };

    const files: any[] = [
      {
        originalname: "huge.jpg",
        mimetype: "image/jpeg",
        size: 6 * 1024 * 1024,
        buffer: validJpegBuffer,
      },
    ];

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStudent,
        AttachmentKind.BEFORE,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("rejects requests with more than 3 files with 400 TOO_MANY_FILES", async () => {
    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
    };

    const files: any[] = [
      { originalname: "1.jpg", mimetype: "image/jpeg", size: 100, buffer: validJpegBuffer },
      { originalname: "2.jpg", mimetype: "image/jpeg", size: 100, buffer: validJpegBuffer },
      { originalname: "3.jpg", mimetype: "image/jpeg", size: 100, buffer: validJpegBuffer },
      { originalname: "4.jpg", mimetype: "image/jpeg", size: 100, buffer: validJpegBuffer },
    ];

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStudent,
        AttachmentKind.BEFORE,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("permits current room occupant to upload BEFORE photos while ticket is open", async () => {
    const mockAttachmentCreated = {
      id: "att-1",
      ticketId: "ticket-1",
      uploaderId: "student-1",
      url: "https://res.cloudinary.com/demo/image/upload/v1234/hosteldesk/HD-0001/photo.jpg",
      publicId: "hosteldesk/HD-0001/mock_public_id",
      kind: AttachmentKind.BEFORE,
      createdAt: new Date(),
      uploader: {
        id: "student-1",
        name: "Aarav Sharma",
        role: Role.STUDENT,
      },
    };

    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
      attachment: {
        create: vi.fn().mockResolvedValue(mockAttachmentCreated),
      },
      ticketEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-1" }),
      },
    };

    const files: any[] = [
      {
        originalname: "leak.jpg",
        mimetype: "image/jpeg",
        size: validJpegBuffer.length,
        buffer: validJpegBuffer,
      },
    ];

    const result = await AttachmentsService.uploadPhotos(
      "ticket-1",
      mockUserStudent,
      AttachmentKind.BEFORE,
      files,
      mockPrisma
    );

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe(AttachmentKind.BEFORE);
    expect(result[0].uploader.name).toBe("Aarav Sharma");

    // Event PHOTO_ADDED recorded
    expect(mockPrisma.ticketEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ticketId: "ticket-1",
          type: EventType.PHOTO_ADDED,
        }),
      })
    );
  });

  it("rejects BEFORE photo if student is not occupant of that room", async () => {
    const otherStudent: any = {
      id: "student-2",
      name: "Other Student",
      role: Role.STUDENT,
      currentRoomId: "room-202", // Different room
    };

    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
    };

    const files: any[] = [
      { originalname: "photo.jpg", mimetype: "image/jpeg", size: validJpegBuffer.length, buffer: validJpegBuffer },
    ];

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        otherStudent,
        AttachmentKind.BEFORE,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("permits assigned staff to upload AFTER photo only while IN_PROGRESS", async () => {
    const inProgressTicket = {
      ...mockRoomTicket,
      status: TicketStatus.IN_PROGRESS,
    };

    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(inProgressTicket),
      },
      attachment: {
        create: vi.fn().mockResolvedValue({
          id: "att-2",
          url: "https://res.cloudinary.com/after.jpg",
          publicId: "hosteldesk/HD-0001/after",
          kind: AttachmentKind.AFTER,
          createdAt: new Date(),
          uploader: { id: "staff-ramesh", name: "Ramesh Kumar", role: Role.STAFF },
        }),
      },
      ticketEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-2" }),
      },
    };

    const files: any[] = [
      { originalname: "after.jpg", mimetype: "image/jpeg", size: validJpegBuffer.length, buffer: validJpegBuffer },
    ];

    const result = await AttachmentsService.uploadPhotos(
      "ticket-1",
      mockUserStaff,
      AttachmentKind.AFTER,
      files,
      mockPrisma
    );

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe(AttachmentKind.AFTER);

    // Rejects other staff
    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserOtherStaff,
        AttachmentKind.AFTER,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);

    // Rejects when ticket is not IN_PROGRESS
    const assignedTicket = { ...mockRoomTicket, status: TicketStatus.ASSIGNED };
    mockPrisma.ticket.findUnique.mockResolvedValue(assignedTicket);

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStaff,
        AttachmentKind.AFTER,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("enforces DOOR photo rules: assigned staff only, room tickets only, ASSIGNED or IN_PROGRESS", async () => {
    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket), // ROOM, ASSIGNED
      },
      attachment: {
        create: vi.fn().mockResolvedValue({
          id: "att-door",
          url: "https://res.cloudinary.com/door.jpg",
          publicId: "hosteldesk/HD-0001/door",
          kind: AttachmentKind.DOOR,
          createdAt: new Date(),
          uploader: { id: "staff-ramesh", name: "Ramesh Kumar", role: Role.STAFF },
        }),
      },
      ticketEvent: {
        create: vi.fn().mockResolvedValue({ id: "evt-3" }),
      },
    };

    const files: any[] = [
      { originalname: "door.jpg", mimetype: "image/jpeg", size: validJpegBuffer.length, buffer: validJpegBuffer },
    ];

    // Assigned staff on ASSIGNED room ticket -> passes
    const result = await AttachmentsService.uploadPhotos(
      "ticket-1",
      mockUserStaff,
      AttachmentKind.DOOR,
      files,
      mockPrisma
    );
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe(AttachmentKind.DOOR);

    // Rejects for COMMON ticket
    const commonTicket = { ...mockRoomTicket, locationType: LocationType.COMMON, roomId: null };
    mockPrisma.ticket.findUnique.mockResolvedValue(commonTicket);

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStaff,
        AttachmentKind.DOOR,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(AppError);
  });

  it("rejects with 502 UPLOAD_FAILED and saves nothing to DB when uploadToCloudinary fails", async () => {
    const { uploadToCloudinary } = await import("../src/modules/evidence/cloudinary");
    vi.mocked(uploadToCloudinary).mockRejectedValueOnce(new Error("Server returned unexpected status code - 403"));

    const mockPrisma: any = {
      ticket: {
        findUnique: vi.fn().mockResolvedValue(mockRoomTicket),
      },
      attachment: {
        create: vi.fn(),
      },
      ticketEvent: {
        create: vi.fn(),
      },
    };

    const files: any[] = [
      { originalname: "photo.jpg", mimetype: "image/jpeg", size: validJpegBuffer.length, buffer: validJpegBuffer },
    ];

    await expect(
      AttachmentsService.uploadPhotos(
        "ticket-1",
        mockUserStudent,
        AttachmentKind.BEFORE,
        files,
        mockPrisma
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        statusCode: 502,
        code: "UPLOAD_FAILED",
        message: "Photo upload failed, please try again",
      })
    );

    expect(mockPrisma.attachment.create).not.toHaveBeenCalled();
    expect(mockPrisma.ticketEvent.create).not.toHaveBeenCalled();
  });
});
