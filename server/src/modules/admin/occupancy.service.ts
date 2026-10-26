import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuditService } from "./audit.service";
import { Role } from "@prisma/client";

export class OccupancyService {
  /**
   * GET /api/admin/rooms?blockId=&floor=
   * Returns rooms with their current occupants.
   */
  static async getRooms(filters: { blockId?: string; floor?: number }) {
    const now = clock.now();

    const where: any = {};
    if (filters.blockId) where.blockId = filters.blockId;
    if (filters.floor !== undefined) where.floor = filters.floor;

    const rooms = await prisma.room.findMany({
      where,
      orderBy: [{ block: { name: "asc" } }, { floor: "asc" }, { number: "asc" }],
      include: {
        block: {
          select: { id: true, name: true },
        },
        occupancies: {
          where: {
            fromDate: { lte: now },
            OR: [{ toDate: null }, { toDate: { gt: now } }],
          },
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    return rooms.map((room) => ({
      id: room.id,
      number: room.number,
      floor: room.floor,
      blockId: room.blockId,
      blockName: room.block.name,
      occupantCount: room.occupancies.length,
      isFull: room.occupancies.length >= 2,
      currentOccupants: room.occupancies.map((occ) => ({
        occupancyId: occ.id,
        userId: occ.user.id,
        name: occ.user.name,
        email: occ.user.email,
        fromDate: occ.fromDate.toISOString(),
      })),
    }));
  }

  /**
   * GET /api/admin/students?search=
   * Paginated student directory with current room.
   */
  static async getStudents(params: { search?: string; page?: number; limit?: number }) {
    const now = clock.now();
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(100, Math.max(1, params.limit || 20));
    const skip = (page - 1) * limit;

    const where: any = { role: Role.STUDENT };
    if (params.search?.trim()) {
      const q = params.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, students] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          email: true,
          isActive: true,
          occupancies: {
            where: {
              fromDate: { lte: now },
              OR: [{ toDate: null }, { toDate: { gt: now } }],
            },
            take: 1,
            include: {
              room: {
                include: {
                  block: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      students: students.map((s) => {
        const occ = s.occupancies[0];
        return {
          id: s.id,
          name: s.name,
          email: s.email,
          isActive: s.isActive,
          currentRoom: occ
            ? {
                occupancyId: occ.id,
                roomId: occ.room.id,
                roomNumber: occ.room.number,
                floor: occ.room.floor,
                blockId: occ.room.blockId,
                blockName: occ.room.block.name,
                fromDate: occ.fromDate.toISOString(),
              }
            : null,
        };
      }),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * POST /api/admin/occupancy/move
   * In one transaction, end the current occupancy and create the new one.
   * Rooms hold at most 2 current occupants -> 409 ROOM_FULL.
   * Moving into the same room -> 400 SAME_ROOM.
   * Writes an audit log entry.
   */
  static async moveStudent(params: {
    actorId: string;
    userId: string;
    roomId: string;
    effectiveDate?: string | Date;
  }) {
    const now = clock.now();
    const effective = params.effectiveDate ? new Date(params.effectiveDate) : now;

    return prisma.$transaction(async (tx) => {
      // 1. Verify student exists and is active
      const student = await tx.user.findUnique({
        where: { id: params.userId },
        select: { id: true, role: true, isActive: true },
      });

      if (!student || student.role !== Role.STUDENT) {
        throw new AppError(404, "STUDENT_NOT_FOUND", "Student not found");
      }

      // 2. Verify target room exists
      const targetRoom = await tx.room.findUnique({
        where: { id: params.roomId },
        include: { block: true },
      });

      if (!targetRoom) {
        throw new AppError(404, "ROOM_NOT_FOUND", "Target room not found");
      }

      // 3. Find current active occupancy of student
      const currentOccupancy = await tx.roomOccupancy.findFirst({
        where: {
          userId: params.userId,
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
      });

      // Moving into same room check
      if (currentOccupancy && currentOccupancy.roomId === params.roomId) {
        throw new AppError(400, "SAME_ROOM", "Student is already occupying this room");
      }

      // 4. Check target room capacity (max 2 current occupants)
      // Exclude the moving student if they were somehow in this room
      const targetOccupantsCount = await tx.roomOccupancy.count({
        where: {
          roomId: params.roomId,
          userId: { not: params.userId },
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
      });

      if (targetOccupantsCount >= 2) {
        throw new AppError(409, "ROOM_FULL", "Room already has 2 occupants");
      }

      // 5. End current occupancy if active
      if (currentOccupancy) {
        await tx.roomOccupancy.update({
          where: { id: currentOccupancy.id },
          data: { toDate: effective },
        });
      }

      // 6. Create new occupancy
      const newOccupancy = await tx.roomOccupancy.create({
        data: {
          userId: params.userId,
          roomId: params.roomId,
          fromDate: effective,
          toDate: null,
        },
      });

      // 7. Write audit log inside the same transaction
      await AuditService.logAction(
        {
          actorId: params.actorId,
          action: "MOVE_STUDENT",
          entityType: "ROOM_OCCUPANCY",
          entityId: newOccupancy.id,
          payload: {
            userId: params.userId,
            fromRoomId: currentOccupancy?.roomId || null,
            toRoomId: params.roomId,
            targetRoomNumber: targetRoom.number,
            blockName: targetRoom.block.name,
            effectiveDate: effective.toISOString(),
          },
        },
        tx
      );

      return {
        previousOccupancyId: currentOccupancy?.id || null,
        newOccupancy,
      };
    });
  }

  /**
   * POST /api/admin/occupancy/:id/end
   * A student moves out without a new room.
   * Writes an audit log entry inside the same transaction.
   */
  static async endOccupancy(params: {
    actorId: string;
    occupancyId: string;
    toDate?: string | Date;
  }) {
    const now = clock.now();
    const endDate = params.toDate ? new Date(params.toDate) : now;

    return prisma.$transaction(async (tx) => {
      const occupancy = await tx.roomOccupancy.findUnique({
        where: { id: params.occupancyId },
        include: {
          room: { select: { number: true, block: { select: { name: true } } } },
          user: { select: { name: true, email: true } },
        },
      });

      if (!occupancy) {
        throw new AppError(404, "NOT_FOUND", "Occupancy record not found");
      }

      if (occupancy.toDate && occupancy.toDate <= now) {
        throw new AppError(400, "ALREADY_ENDED", "Occupancy has already ended");
      }

      const updated = await tx.roomOccupancy.update({
        where: { id: params.occupancyId },
        data: { toDate: endDate },
      });

      // Audit log inside same transaction
      await AuditService.logAction(
        {
          actorId: params.actorId,
          action: "END_OCCUPANCY",
          entityType: "ROOM_OCCUPANCY",
          entityId: updated.id,
          payload: {
            userId: occupancy.userId,
            studentName: occupancy.user.name,
            roomId: occupancy.roomId,
            roomNumber: occupancy.room.number,
            blockName: occupancy.room.block.name,
            toDate: endDate.toISOString(),
          },
        },
        tx
      );

      return updated;
    });
  }
}
