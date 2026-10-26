import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";
import { AppError } from "../../lib/errors";
import { AuditService } from "./audit.service";
import { Role } from "@prisma/client";

export interface CsvRowResult {
  rowIndex: number;
  email: string;
  name: string;
  block: string;
  room: string;
  fromDate: string;
  status: "CREATE" | "MOVE" | "UNCHANGED" | "ERROR";
  errorReason?: string;
}

export class CsvImportService {
  /**
   * Generates a secure, readable 12-character temporary password.
   */
  static generateTemporaryPassword(length = 12): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$";
    const bytes = crypto.randomBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars[bytes[i] % chars.length];
    }
    return result;
  }

  /**
   * Parses raw CSV content into records.
   */
  static parseCsv(csvContent: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = csvContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length === 0) {
      throw new AppError(400, "EMPTY_CSV", "CSV file contains no data");
    }

    const headerLine = lines[0];
    const headers = headerLine.split(",").map((h) => h.trim().toLowerCase());

    const requiredHeaders = ["email", "name", "block", "room", "fromdate"];
    const missing = requiredHeaders.filter((req) => !headers.includes(req));
    if (missing.length > 0) {
      throw new AppError(
        400,
        "INVALID_HEADERS",
        `CSV is missing required headers: ${missing.join(", ")}. Expected columns: email,name,block,room,fromDate`
      );
    }

    const dataLines = lines.slice(1);
    if (dataLines.length > 1000) {
      throw new AppError(400, "TOO_MANY_ROWS", "CSV exceeds maximum allowed limit of 1000 rows");
    }

    const rows: Record<string, string>[] = [];
    for (let i = 0; i < dataLines.length; i++) {
      const parts = dataLines[i].split(",").map((p) => p.trim());
      const rowObj: Record<string, string> = {};
      for (let j = 0; j < headers.length; j++) {
        rowObj[headers[j]] = parts[j] ?? "";
      }
      rows.push(rowObj);
    }

    return { headers, rows };
  }

  /**
   * Validates each row against database state and capacity rules.
   */
  static async validateCsv(csvContent: string): Promise<{
    rows: CsvRowResult[];
    hasErrors: boolean;
    summary: { total: number; create: number; move: number; unchanged: number; error: number };
  }> {
    const { rows: rawRows } = this.parseCsv(csvContent);
    const now = clock.now();

    // 1. Fetch blocks, rooms, users, occupancies
    const [blocks, rooms, existingUsers, activeOccupancies] = await Promise.all([
      prisma.block.findMany({ select: { id: true, name: true } }),
      prisma.room.findMany({
        select: { id: true, number: true, blockId: true, block: { select: { name: true } } },
      }),
      prisma.user.findMany({
        where: { role: Role.STUDENT },
        select: { id: true, email: true, name: true },
      }),
      prisma.roomOccupancy.findMany({
        where: {
          fromDate: { lte: now },
          OR: [{ toDate: null }, { toDate: { gt: now } }],
        },
        select: { id: true, userId: true, roomId: true },
      }),
    ]);

    // Fast lookups
    const blockMap = new Map<string, string>(); // blockName.toLowerCase() -> blockId
    for (const b of blocks) {
      blockMap.set(b.name.trim().toLowerCase(), b.id);
    }

    const roomLookup = new Map<string, { id: string; number: string; blockId: string }>(); // "blockId:roomNumber" -> room
    for (const r of rooms) {
      roomLookup.set(`${r.blockId}:${r.number.trim().toLowerCase()}`, r);
    }

    const userByEmail = new Map<string, { id: string; email: string; name: string }>();
    for (const u of existingUsers) {
      userByEmail.set(u.email.trim().toLowerCase(), u);
    }

    // Current room occupancy map: roomId -> Set of userIds
    const roomOccupants = new Map<string, Set<string>>();
    // Student to current roomId map
    const studentCurrentRoom = new Map<string, string>();

    for (const occ of activeOccupancies) {
      if (!roomOccupants.has(occ.roomId)) {
        roomOccupants.set(occ.roomId, new Set());
      }
      roomOccupants.get(occ.roomId)!.add(occ.userId);
      studentCurrentRoom.set(occ.userId, occ.roomId);
    }

    // Count occurrences of each email in the file to detect duplicates
    const emailCounts = new Map<string, number>();
    for (const r of rawRows) {
      const email = r.email.trim().toLowerCase();
      emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    }

    const results: CsvRowResult[] = [];
    let createCount = 0;
    let moveCount = 0;
    let unchangedCount = 0;
    let errorCount = 0;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const rowIndex = i + 1;
      const email = row.email?.trim() || "";
      const name = row.name?.trim() || "";
      const blockStr = row.block?.trim() || "";
      const roomStr = row.room?.trim() || "";
      const fromDateStr = row.fromdate?.trim() || "";

      // 1. Duplicate email check within file
      if (email && (emailCounts.get(email.toLowerCase()) || 0) > 1) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "duplicate email within the file",
        });
        errorCount++;
        continue;
      }

      // 2. Email format validation
      if (!email || !emailRegex.test(email)) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "bad email",
        });
        errorCount++;
        continue;
      }

      // 3. Name validation
      if (!name) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "missing student name",
        });
        errorCount++;
        continue;
      }

      // 4. Block & Room existence
      const blockId = blockMap.get(blockStr.toLowerCase());
      if (!blockId) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "unknown block/room",
        });
        errorCount++;
        continue;
      }

      const room = roomLookup.get(`${blockId}:${roomStr.toLowerCase()}`);
      if (!room) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "unknown block/room",
        });
        errorCount++;
        continue;
      }

      // 5. fromDate validation
      const parsedDate = new Date(fromDateStr);
      if (isNaN(parsedDate.getTime())) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "invalid date",
        });
        errorCount++;
        continue;
      }

      // 6. Capacity & status evaluation
      const existingUser = userByEmail.get(email.toLowerCase());
      const effectiveStudentId = existingUser ? existingUser.id : `synthetic-new-${email.toLowerCase()}`;
      const currentRoomId = existingUser ? studentCurrentRoom.get(existingUser.id) : undefined;

      if (!roomOccupants.has(room.id)) {
        roomOccupants.set(room.id, new Set());
      }
      const occupantsInTarget = roomOccupants.get(room.id)!;

      // Check if unchanged
      if (currentRoomId && currentRoomId === room.id) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "UNCHANGED",
        });
        unchangedCount++;
        continue;
      }

      // If moving from another room, free up their previous room
      if (currentRoomId && currentRoomId !== room.id) {
        const prevOccupants = roomOccupants.get(currentRoomId);
        if (prevOccupants && existingUser) {
          prevOccupants.delete(existingUser.id);
        }
      }

      // Check if target room would exceed 2 occupants
      if (occupantsInTarget.size >= 2) {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "ERROR",
          errorReason: "room would exceed 2 occupants after the import",
        });
        errorCount++;
        continue;
      }

      // Reserve slot in target room
      occupantsInTarget.add(effectiveStudentId);
      if (existingUser) {
        studentCurrentRoom.set(existingUser.id, room.id);
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "MOVE",
        });
        moveCount++;
      } else {
        results.push({
          rowIndex,
          email,
          name,
          block: blockStr,
          room: roomStr,
          fromDate: fromDateStr,
          status: "CREATE",
        });
        createCount++;
      }
    }

    return {
      rows: results,
      hasErrors: errorCount > 0,
      summary: {
        total: results.length,
        create: createCount,
        move: moveCount,
        unchanged: unchangedCount,
        error: errorCount,
      },
    };
  }

  /**
   * Applies the CSV import in an all-or-nothing transaction.
   * If any row has ERROR, refuses the entire import.
   */
  static async applyImport(actorId: string, csvContent: string) {
    const validation = await this.validateCsv(csvContent);

    if (validation.hasErrors) {
      throw new AppError(
        400,
        "IMPORT_CONTAINS_ERRORS",
        "Cannot apply import: CSV contains errors. All errors must be resolved first.",
        { rows: validation.rows.filter((r) => r.status === "ERROR") }
      );
    }

    const now = clock.now();

    return prisma.$transaction(async (tx) => {
      // Fetch fresh room and user data
      const [blocks, rooms, existingUsers] = await Promise.all([
        tx.block.findMany({ select: { id: true, name: true } }),
        tx.room.findMany({ select: { id: true, number: true, blockId: true } }),
        tx.user.findMany({
          where: { role: Role.STUDENT },
          select: { id: true, email: true },
        }),
      ]);

      const blockMap = new Map<string, string>();
      for (const b of blocks) blockMap.set(b.name.trim().toLowerCase(), b.id);

      const roomLookup = new Map<string, string>(); // "blockId:number" -> roomId
      for (const r of rooms) roomLookup.set(`${r.blockId}:${r.number.trim().toLowerCase()}`, r.id);

      const userMap = new Map<string, string>(); // email -> userId
      for (const u of existingUsers) userMap.set(u.email.trim().toLowerCase(), u.id);

      const credentials: { email: string; temporaryPassword: string }[] = [];

      for (const row of validation.rows) {
        const blockId = blockMap.get(row.block.toLowerCase())!;
        const roomId = roomLookup.get(`${blockId}:${row.room.toLowerCase()}`)!;
        const fromDate = new Date(row.fromDate);

        if (row.status === "CREATE") {
          const tempPassword = this.generateTemporaryPassword(12);
          const passwordHash = await bcrypt.hash(tempPassword, 10);

          const newUser = await tx.user.create({
            data: {
              email: row.email.toLowerCase(),
              name: row.name,
              passwordHash,
              role: Role.STUDENT,
              isActive: true,
            },
          });

          await tx.roomOccupancy.create({
            data: {
              userId: newUser.id,
              roomId,
              fromDate,
              toDate: null,
            },
          });

          credentials.push({
            email: newUser.email,
            temporaryPassword: tempPassword,
          });
        } else if (row.status === "MOVE") {
          const userId = userMap.get(row.email.toLowerCase())!;

          // Terminate active occupancy
          await tx.roomOccupancy.updateMany({
            where: {
              userId,
              fromDate: { lte: now },
              OR: [{ toDate: null }, { toDate: { gt: now } }],
            },
            data: {
              toDate: fromDate,
            },
          });

          // Create new occupancy
          await tx.roomOccupancy.create({
            data: {
              userId,
              roomId,
              fromDate,
              toDate: null,
            },
          });
        }
        // UNCHANGED does nothing
      }

      // Generate downloadable CSV string of credentials
      const credentialsCsv = [
        "email,temporaryPassword",
        ...credentials.map((c) => `${c.email},${c.temporaryPassword}`),
      ].join("\n");

      // Audit log in same transaction
      await AuditService.logAction(
        {
          actorId,
          action: "IMPORT_STUDENTS",
          entityType: "CSV_IMPORT",
          payload: {
            totalRows: validation.summary.total,
            created: validation.summary.create,
            moved: validation.summary.move,
            unchanged: validation.summary.unchanged,
          },
        },
        tx
      );

      return {
        summary: validation.summary,
        credentialsCsv,
        credentials,
      };
    });
  }
}
