import { z } from "zod";

export const analyticsQuerySchema = z.object({
  days: z
    .preprocess((val) => (val ? Number(val) : 30), z.number().int().min(1).max(90))
    .default(30),
  blockId: z.string().optional(),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
