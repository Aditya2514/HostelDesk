import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma";
import { requireAuth } from "../../middleware/auth.middleware";

export const categoryRouter = Router();

categoryRouter.use(requireAuth);

categoryRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.status(200).json({ categories });
  } catch (error) {
    next(error);
  }
});
