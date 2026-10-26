import { prisma } from "../../lib/prisma";
import { AppError } from "../../lib/errors";
import { AuditService } from "./audit.service";
import { Trade, Priority } from "@prisma/client";

export interface CreateCategoryInput {
  name: string;
  trade: Trade;
  defaultDurationMin: number;
  slaMinutes: number;
  defaultPriority?: Priority;
  isActive?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  trade?: Trade;
  defaultDurationMin?: number;
  slaMinutes?: number;
  defaultPriority?: Priority;
  isActive?: boolean;
}

export class CategoryService {
  /**
   * GET /api/admin/categories
   * Returns all categories (including inactive ones), ordered by name.
   */
  static async getCategories() {
    return prisma.category.findMany({
      orderBy: { name: "asc" },
    });
  }

  /**
   * Validates duration and SLA bounds:
   * - defaultDurationMin: 5 to 480 (8 hours)
   * - slaMinutes: 30 to 20160 (14 days)
   */
  private static validateBounds(durationMin?: number, slaMinutes?: number) {
    if (durationMin !== undefined) {
      if (!Number.isInteger(durationMin) || durationMin < 5 || durationMin > 480) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "defaultDurationMin must be an integer between 5 and 480 minutes"
        );
      }
    }

    if (slaMinutes !== undefined) {
      if (!Number.isInteger(slaMinutes) || slaMinutes < 30 || slaMinutes > 20160) {
        throw new AppError(
          400,
          "VALIDATION_ERROR",
          "slaMinutes must be an integer between 30 and 20160 minutes (up to 14 days)"
        );
      }
    }
  }

  /**
   * POST /api/admin/categories
   * Creates a new ticket category and logs audit record.
   */
  static async createCategory(actorId: string, input: CreateCategoryInput) {
    const { name, trade, defaultDurationMin, slaMinutes, defaultPriority = Priority.NORMAL, isActive = true } = input;

    if (!name?.trim()) {
      throw new AppError(400, "VALIDATION_ERROR", "Category name is required");
    }

    if (!trade || !Object.values(Trade).includes(trade)) {
      throw new AppError(400, "VALIDATION_ERROR", "Valid trade is required (ELECTRICIAN, PLUMBER, CARPENTER)");
    }

    if (!Object.values(Priority).includes(defaultPriority)) {
      throw new AppError(400, "VALIDATION_ERROR", "Valid defaultPriority is required (NORMAL, URGENT, EMERGENCY)");
    }

    this.validateBounds(defaultDurationMin, slaMinutes);

    const trimmedName = name.trim();

    const existing = await prisma.category.findUnique({
      where: { name: trimmedName },
    });

    if (existing) {
      throw new AppError(409, "CATEGORY_EXISTS", `A category with name "${trimmedName}" already exists`);
    }

    return prisma.$transaction(async (tx) => {
      const category = await tx.category.create({
        data: {
          name: trimmedName,
          trade,
          defaultDurationMin,
          slaMinutes,
          defaultPriority,
          isActive,
        },
      });

      await AuditService.logAction(
        {
          actorId,
          action: "CREATE_CATEGORY",
          entityType: "CATEGORY",
          entityId: category.id,
          payload: {
            name: category.name,
            trade: category.trade,
            defaultDurationMin: category.defaultDurationMin,
            slaMinutes: category.slaMinutes,
            defaultPriority: category.defaultPriority,
            isActive: category.isActive,
          },
        },
        tx
      );

      return category;
    });
  }

  /**
   * PATCH /api/admin/categories/:id
   * Updates an existing category and logs audit record.
   */
  static async updateCategory(actorId: string, categoryId: string, input: UpdateCategoryInput) {
    const category = await prisma.category.findUnique({
      where: { id: categoryId },
    });

    if (!category) {
      throw new AppError(404, "CATEGORY_NOT_FOUND", "Category not found");
    }

    this.validateBounds(input.defaultDurationMin, input.slaMinutes);

    if (input.trade && !Object.values(Trade).includes(input.trade)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid trade specified");
    }

    if (input.defaultPriority && !Object.values(Priority).includes(input.defaultPriority)) {
      throw new AppError(400, "VALIDATION_ERROR", "Invalid defaultPriority specified");
    }

    if (input.name && input.name.trim() !== category.name) {
      const nameConflict = await prisma.category.findUnique({
        where: { name: input.name.trim() },
      });
      if (nameConflict && nameConflict.id !== categoryId) {
        throw new AppError(409, "CATEGORY_EXISTS", `Category "${input.name.trim()}" already exists`);
      }
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.category.update({
        where: { id: categoryId },
        data: {
          name: input.name?.trim(),
          trade: input.trade,
          defaultDurationMin: input.defaultDurationMin,
          slaMinutes: input.slaMinutes,
          defaultPriority: input.defaultPriority,
          isActive: input.isActive,
        },
      });

      await AuditService.logAction(
        {
          actorId,
          action: "UPDATE_CATEGORY",
          entityType: "CATEGORY",
          entityId: updated.id,
          payload: {
            previous: {
              name: category.name,
              trade: category.trade,
              defaultDurationMin: category.defaultDurationMin,
              slaMinutes: category.slaMinutes,
              defaultPriority: category.defaultPriority,
              isActive: category.isActive,
            },
            updated: {
              name: updated.name,
              trade: updated.trade,
              defaultDurationMin: updated.defaultDurationMin,
              slaMinutes: updated.slaMinutes,
              defaultPriority: updated.defaultPriority,
              isActive: updated.isActive,
            },
          },
        },
        tx
      );

      return updated;
    });
  }
}
