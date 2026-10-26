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

  it("supports Phase 4 CLOSED -> REOPENED for student disputes and warden inspections", () => {
    // Student can reopen closed ticket with reason (dispute-wins rule)
    expect(() =>
      assertTransition(TicketStatus.CLOSED, TicketStatus.REOPENED, Role.STUDENT, {
        reason: "Roommate reported it fixed but leak is still ongoing",
      })
    ).not.toThrow();

    // Student without reason -> fails
    expect(() =>
      assertTransition(TicketStatus.CLOSED, TicketStatus.REOPENED, Role.STUDENT)
    ).toThrowError(AppError);

    // Warden can reopen closed ticket with reason (warden inspection found problem)
    expect(() =>
      assertTransition(TicketStatus.CLOSED, TicketStatus.REOPENED, Role.WARDEN, {
        reason: "Warden inspection found paint peeling and dampness still present",
      })
    ).not.toThrow();

    // Staff cannot reopen closed ticket
    expect(() =>
      assertTransition(TicketStatus.CLOSED, TicketStatus.REOPENED, Role.STAFF, {
        reason: "Staff wanting to reopen",
      })
    ).toThrowError(AppError);
  });

  it("supports Phase 4 IN_PROGRESS -> CLOSED for warden code-refusal decisions", () => {
    // Warden can close directly from IN_PROGRESS when code-refusal dispute is upheld
    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.CLOSED, Role.WARDEN)
    ).not.toThrow();

    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.CLOSED, Role.CHIEF_WARDEN)
    ).not.toThrow();

    // Staff and student cannot close directly from IN_PROGRESS
    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.CLOSED, Role.STAFF)
    ).toThrowError(AppError);

    expect(() =>
      assertTransition(TicketStatus.IN_PROGRESS, TicketStatus.CLOSED, Role.STUDENT)
    ).toThrowError(AppError);
  });
});
