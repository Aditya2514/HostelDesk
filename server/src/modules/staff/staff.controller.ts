import { Request, Response, NextFunction } from "express";
import { StaffService } from "./staff.service";

export class StaffController {
  static async getSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      const schedule = await StaffService.getSchedule(req.params.id, req.user!);
      res.status(200).json(schedule);
    } catch (error) {
      next(error);
    }
  }
}
