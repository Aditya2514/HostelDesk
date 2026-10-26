import { describe, it, expect } from "vitest";
import { LocationType, Role } from "@prisma/client";
import { TicketAccessService, TicketAccessCheckable } from "../src/modules/tickets/ticketAccess.service";
import { AuthenticatedUser } from "../src/types/express";
import { AppError } from "../src/lib/errors";

describe("TicketAccessService (Centralized Access Rules)", () => {
  const roomTicket: TicketAccessCheckable = {
    id: "ticket-1",
    locationType: LocationType.ROOM,
    roomId: "room-a-301",
    blockId: "block-a",
    raisedById: "student-1",
    assignedToId: "plumber-1",
  };

  const commonTicket: TicketAccessCheckable = {
    id: "ticket-2",
    locationType: LocationType.COMMON,
    blockId: "block-a",
    raisedById: "student-1",
    assignedToId: "electrician-1",
    followers: [{ userId: "student-3" }],
  };

  const studentRoommate: AuthenticatedUser = {
    id: "student-2",
    name: "Roommate",
    email: "student2@hosteldesk.dev",
    role: Role.STUDENT,
    currentRoomId: "room-a-301",
    isActive: true,
  };

  const studentOtherRoom: AuthenticatedUser = {
    id: "student-other",
    name: "Other Room Student",
    email: "other@hosteldesk.dev",
    role: Role.STUDENT,
    currentRoomId: "room-a-101",
    isActive: true,
  };

  const studentMovedOut: AuthenticatedUser = {
    id: "student-moved-out",
    name: "Moved Out",
    email: "moved@hosteldesk.dev",
    role: Role.STUDENT,
    currentRoomId: null, // No longer in room-a-301
    isActive: true,
  };

  const staffAssigned: AuthenticatedUser = {
    id: "plumber-1",
    name: "Plumber 1",
    email: "plumber1@hosteldesk.dev",
    role: Role.STAFF,
    isActive: true,
  };

  const staffUnassigned: AuthenticatedUser = {
    id: "plumber-2",
    name: "Plumber 2",
    email: "plumber2@hosteldesk.dev",
    role: Role.STAFF,
    isActive: true,
  };

  const wardenBlockA: AuthenticatedUser = {
    id: "warden-a",
    name: "Warden A",
    email: "warden.a@hosteldesk.dev",
    role: Role.WARDEN,
    blockId: "block-a",
    isActive: true,
  };

  const wardenBlockB: AuthenticatedUser = {
    id: "warden-b",
    name: "Warden B",
    email: "warden.b@hosteldesk.dev",
    role: Role.WARDEN,
    blockId: "block-b",
    isActive: true,
  };

  const chiefWarden: AuthenticatedUser = {
    id: "chief",
    name: "Chief",
    email: "chief@hosteldesk.dev",
    role: Role.CHIEF_WARDEN,
    isActive: true,
  };

  const admin: AuthenticatedUser = {
    id: "admin",
    name: "Admin",
    email: "admin@hosteldesk.dev",
    role: Role.ADMIN,
    isActive: true,
  };

  describe("canView role matrix", () => {
    it("allows roommate sharing the room to view room ticket", () => {
      expect(TicketAccessService.canView(studentRoommate, roomTicket)).toBe(true);
    });

    it("denies student from another room to view room ticket", () => {
      expect(TicketAccessService.canView(studentOtherRoom, roomTicket)).toBe(false);
    });

    it("denies student who moved out from viewing old room ticket", () => {
      expect(TicketAccessService.canView(studentMovedOut, roomTicket)).toBe(false);
    });

    it("allows common ticket reporter to view common ticket", () => {
      const studentReporter: AuthenticatedUser = {
        ...studentRoommate,
        id: "student-1",
      };
      expect(TicketAccessService.canView(studentReporter, commonTicket)).toBe(true);
    });

    it("allows follower to view common ticket", () => {
      const studentFollower: AuthenticatedUser = {
        ...studentRoommate,
        id: "student-3",
      };
      expect(TicketAccessService.canView(studentFollower, commonTicket)).toBe(true);
    });

    it("denies non-follower/non-reporter student from viewing common ticket", () => {
      expect(TicketAccessService.canView(studentOtherRoom, commonTicket)).toBe(false);
    });

    it("allows assigned staff to view ticket", () => {
      expect(TicketAccessService.canView(staffAssigned, roomTicket)).toBe(true);
    });

    it("denies unassigned staff from viewing ticket", () => {
      expect(TicketAccessService.canView(staffUnassigned, roomTicket)).toBe(false);
    });

    it("allows block warden to view tickets in their block", () => {
      expect(TicketAccessService.canView(wardenBlockA, roomTicket)).toBe(true);
    });

    it("denies other block warden from viewing tickets outside their block", () => {
      expect(TicketAccessService.canView(wardenBlockB, roomTicket)).toBe(false);
    });

    it("allows chief warden and admin to view all tickets", () => {
      expect(TicketAccessService.canView(chiefWarden, roomTicket)).toBe(true);
      expect(TicketAccessService.canView(admin, roomTicket)).toBe(true);
    });
  });

  describe("assertCanView", () => {
    it("throws 404 NOT_FOUND instead of 403 to prevent probing ticket IDs", () => {
      try {
        TicketAccessService.assertCanView(studentOtherRoom, roomTicket);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.statusCode).toBe(404);
        expect(err.code).toBe("NOT_FOUND");
      }
    });

    it("does not throw when access is permitted", () => {
      expect(() => TicketAccessService.assertCanView(studentRoommate, roomTicket)).not.toThrow();
    });
  });
});
