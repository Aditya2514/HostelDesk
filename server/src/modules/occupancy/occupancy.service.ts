import { prisma } from "../../lib/prisma";
import { clock } from "../../lib/clock";

export class OccupancyService {
  /**
   * Returns current active roomId for a user, where toDate is either null or in the future
   */
  static async getCurrentRoomId(userId: string): Promise<string | null> {
    const occupancy = await prisma.roomOccupancy.findFirst({
      where: {
        userId,
        OR: [
          { toDate: null },
          { toDate: { gt: clock.now() } },
        ],
      },
      select: {
        roomId: true,
      },
      orderBy: {
        fromDate: "desc",
      },
    });

    return occupancy?.roomId || null;
  }

  /**
   * Returns current active room details for a user (including block and room number)
   */
  static async getCurrentRoomDetails(userId: string) {
    const occupancy = await prisma.roomOccupancy.findFirst({
      where: {
        userId,
        OR: [
          { toDate: null },
          { toDate: { gt: clock.now() } },
        ],
      },
      include: {
        room: {
          include: {
            block: true,
          },
        },
      },
      orderBy: {
        fromDate: "desc",
      },
    });

    if (!occupancy) return null;

    return {
      roomId: occupancy.room.id,
      roomNumber: occupancy.room.number,
      floor: occupancy.room.floor,
      blockId: occupancy.room.block.id,
      blockName: occupancy.room.block.name,
      displayName: `${occupancy.room.block.name}-${occupancy.room.number}`,
    };
  }
}
