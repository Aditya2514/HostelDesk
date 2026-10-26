import { Request, Response, NextFunction } from "express";
import { DisputesService } from "./disputes.service";
import { DisputeStatus } from "@prisma/client";

export class DisputesController {
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const statusFilter = req.query.status as DisputeStatus | undefined;
      const disputes = await DisputesService.listDisputes(req.user!, statusFilter);
      res.status(200).json({ disputes });
    } catch (error) {
      next(error);
    }
  }

  static async decide(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await DisputesService.decideDispute(req.params.id, req.user!, req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
}
