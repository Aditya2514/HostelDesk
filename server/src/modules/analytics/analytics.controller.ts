import { Request, Response, NextFunction } from "express";
import { AnalyticsService } from "./analytics.service";
import { analyticsQuerySchema } from "./analytics.schema";

export class AnalyticsController {
  static async getOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const query = analyticsQuerySchema.parse(req.query);
      const data = await AnalyticsService.getOverview(req.user!, query.days, query.blockId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  static async getStaff(req: Request, res: Response, next: NextFunction) {
    try {
      const query = analyticsQuerySchema.parse(req.query);
      const data = await AnalyticsService.getStaff(req.user!, query.days, query.blockId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  static async getPredictionTrend(req: Request, res: Response, next: NextFunction) {
    try {
      const query = analyticsQuerySchema.parse(req.query);
      const data = await AnalyticsService.getPredictionTrend(req.user!, query.days, query.blockId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  static async getRepeatRooms(req: Request, res: Response, next: NextFunction) {
    try {
      const query = analyticsQuerySchema.parse(req.query);
      const data = await AnalyticsService.getRepeatRooms(req.user!, query.days, query.blockId);
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
}
