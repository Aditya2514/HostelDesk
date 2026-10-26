import { z } from "zod";
import { LocationType, Priority, TicketStatus } from "@prisma/client";

export const createTicketSchema = z.object({
  locationType: z.nativeEnum(LocationType),
  categoryId: z.string().min(1, "Category is required"),
  title: z
    .string()
    .trim()
    .min(5, "Title must be at least 5 characters")
    .max(100, "Title must be at most 100 characters"),
  description: z
    .string()
    .trim()
    .min(10, "Description must be at least 10 characters")
    .max(1000, "Description must be at most 1000 characters"),
  floor: z.number().int().min(1).max(4).optional(),
  commonSpot: z
    .string()
    .trim()
    .min(2, "Common spot must be at least 2 characters")
    .max(60, "Common spot must be at most 60 characters")
    .optional(),
  joinExistingCheck: z.boolean().default(true).optional(),
}).refine(
  (data) => {
    if (data.locationType === LocationType.COMMON) {
      return data.floor !== undefined && data.commonSpot !== undefined && data.commonSpot.length >= 2;
    }
    return true;
  },
  {
    message: "Floor (1-4) and common spot (2-60 characters) are required for common area complaints",
    path: ["commonSpot"],
  }
);

export const updatePrioritySchema = z.object({
  priority: z.nativeEnum(Priority),
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

export const reassignTicketSchema = z.object({
  staffId: z.string().min(1, "Staff member ID is required"),
});

export const rejectTicketSchema = z.object({
  reason: z.string().trim().min(5, "A reason of at least 5 characters is required"),
});

export const addCommentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Comment cannot be empty")
    .max(500, "Comment cannot exceed 500 characters"),
});

export const listTicketsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(TicketStatus).optional(),
  categoryId: z.string().optional(),
  priority: z.nativeEnum(Priority).optional(),
  floor: z.coerce.number().int().min(1).max(4).optional(),
  locationType: z.nativeEnum(LocationType).optional(),
  assignedToId: z.string().optional(),
  search: z.string().trim().optional(),
});
