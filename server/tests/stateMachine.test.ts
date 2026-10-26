import { describe, it, expect } from "vitest";
import { TicketStatus, Role } from "@prisma/client";
import { assertTransition } from "../src/modules/tickets/stateMachine";
import { AppError } from "../src/lib/errors";

describe("Ticket State Machine", () => {
  it("allows staff to start work on assigned ticket", () => {
    expect(() =>
      assertTransition(TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, Role.STAFF)
    ).not.toThrow();
  });

  it("rejects invalid transition with 409 INVALID_TRANSITION", () => {
    try {
      assertTransition(TicketStatus.ASSIGNED, TicketStatus.CLOSED, Role.STAFF);
      expect.fail("Should have thrown 409");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe("INVALID_TRANSITION");
    }
  });

  it("rejects unauthorized role with 403 FORBIDDEN_TRANSITION", () => {
    try {
      // Student cannot start work on ticket
      assertTransition(TicketStatus.ASSIGNED, TicketStatus.IN_PROGRESS, Role.STUDENT);
      expect.fail("Should have thrown 403");
    } catch (err: any) {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN_TRANSITION");
    }
  });

  it("enforces reason when placing ticket ON_HOLD", () => {
    // Missing reason
    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.ON_HOLD, Role.STAFF, {
        reason: "",
      })
    ).toThrowError(AppError);

    // With reason -> passes
    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.ON_HOLD, Role.STAFF, {
        reason: "Waiting for replacement valve part",
      })
    ).not.toThrow();
  });

  it("enforces reason when warden rejects ticket", () => {
    expect(() =>
      assertTransition(TicketStatus.ASSIGNED, TicketStatus.REJECTED, Role.WARDEN, {
        reason: "",
      })
    ).toThrowError(AppError);

    expect(() =>
      assertTransition(TicketStatus.ASSIGNED, TicketStatus.REJECTED, Role.WARDEN, {
        reason: "Issue is not hostel property responsibility",
      })
    ).not.toThrow();
  });

  it("allows student to close resolved ticket or reopen with reason", () => {
    // Closing
    expect(() =>
      assertTransition(TicketStatus.RESOLVED, TicketStatus.CLOSED, Role.STUDENT)
    ).not.toThrow();

    // Reopening without reason -> fails
    expect(() =>
      assertTransition(TicketStatus.RESOLVED, TicketStatus.REOPENED, Role.STUDENT)
    ).toThrowError(AppError);

    // Reopening with reason -> passes
    expect(() =>
      assertTransition(TicketStatus.RESOLVED, TicketStatus.REOPENED, Role.STUDENT, {
        reason: "Fan still making squeaking noise after repair",
      })
    ).not.toThrow();
  });
});
