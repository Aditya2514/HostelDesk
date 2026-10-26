import { Prisma, Role, TicketStatus, Trade } from "@prisma/client";

export interface TicketForRouting {
  categoryId: string;
  trade?: Trade;
}

export class RoutingService {
  /**
   * Temporary routing service for Phase 2: Assigns ticket to active staff member
   * with the fewest open tickets (ties broken by lowest id).
   * Note: In Phase 3, this function's internals will be replaced by the schedule simulation engine.
   */
  static async chooseAssignee(
    ticket: TicketForRouting,
    tx: Prisma.TransactionClient
  ): Promise<string | null> {
    let trade = ticket.trade;

    if (!trade) {
      const category = await tx.category.findUnique({
        where: { id: ticket.categoryId },
        select: { trade: true },
      });
      if (!category) return null;
      trade = category.trade;
    }

    // 1. Fetch all active staff with the category's trade
    const eligibleStaff = await tx.user.findMany({
      where: {
        role: Role.STAFF,
        trade,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (eligibleStaff.length === 0) {
      return null;
    }

    // 2. Count open tickets per staff member
    const openStatuses: TicketStatus[] = [
      TicketStatus.ASSIGNED,
      TicketStatus.IN_PROGRESS,
      TicketStatus.AWAITING_ACCESS,
      TicketStatus.ON_HOLD,
      TicketStatus.REOPENED,
    ];

    const staffLoads = await Promise.all(
      eligibleStaff.map(async (staff) => {
        const count = await tx.ticket.count({
          where: {
            assignedToId: staff.id,
            status: { in: openStatuses },
          },
        });
        return {
          id: staff.id,
          openCount: count,
        };
      })
    );

    // 3. Sort: fewest open tickets first, ties broken by lowest string ID
    staffLoads.sort((a, b) => {
      if (a.openCount !== b.openCount) {
        return a.openCount - b.openCount;
      }
      return a.id.localeCompare(b.id);
    });

    return staffLoads[0]?.id || null;
  }
}
