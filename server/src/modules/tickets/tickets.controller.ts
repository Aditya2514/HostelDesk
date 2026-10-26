import { Request, Response, NextFunction } from "express";
import {
  createTicketSchema,
  updatePrioritySchema,
  reassignTicketSchema,
  rejectTicketSchema,
  addCommentSchema,
  listTicketsQuerySchema,
} from "./tickets.schema";
import { TicketsService } from "./tickets.service";
import { AppError } from "../../lib/errors";

export class TicketsController {
  static async create(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = createTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const ticket = await TicketsService.createTicket(req.user!, parsed.data);
      res.status(201).json({ ticket });
    } catch (error) {
      next(error);
    }
  }

  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = listTicketsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid filters");
      }

      const result = await TicketsService.listTickets(req.user!, parsed.data);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const ticket = await TicketsService.getTicket(req.params.id, req.user!);
      res.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }

  static async getCompletionCode(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.getCompletionCode(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const events = await TicketsService.getTicketEvents(req.params.id, req.user!);
      res.status(200).json({ events });
    } catch (error) {
      next(error);
    }
  }

  static async follow(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.followTicket(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async start(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.startWork(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async resolve(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.resolveTicket(req.params.id, req.user!, req.body?.code);
      res.status(200).json({
        success: true,
        ticket: {
          id: result.id,
          status: result.status,
          resolutionMethod: result.resolutionMethod,
          resolvedAt: result.resolvedAt,
          actualWorkMinutes: result.actualWorkMinutes,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async confirm(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.confirmTicket(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async dispute(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.disputeTicket(req.params.id, req.user!, req.body?.reason);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async roomLocked(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.reportRoomLocked(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async getAccessSlots(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.getAccessSlots(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async respondAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.respondAccess(req.params.id, req.user!, req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async disputeLockedClaim(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.disputeLockedClaim(req.params.id, req.user!, req.body?.reason);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async hold(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.holdTicket(req.params.id, req.user!, req.body?.reason);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async resume(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.resumeTicket(req.params.id, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async codeRefused(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.reportCodeRefused(req.params.id, req.user!, req.body?.reason);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async wardenCheck(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await TicketsService.wardenCheck(req.params.id, req.user!, req.body);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async updatePriority(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = updatePrioritySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const ticket = await TicketsService.updatePriority(
        req.params.id,
        parsed.data.priority,
        parsed.data.reason,
        req.user!
      );
      res.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }

  static async reassign(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = reassignTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const ticket = await TicketsService.reassign(req.params.id, parsed.data.staffId, req.user!);
      res.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }

  static async assign(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = reassignTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const ticket = await TicketsService.assignTicket(req.params.id, parsed.data.staffId, req.user!);
      res.status(200).json({ ticket });
    } catch (error) {
      next(error);
    }
  }

  static async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = rejectTicketSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const result = await TicketsService.rejectTicket(req.params.id, parsed.data.reason, req.user!);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  static async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = addCommentSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message || "Invalid payload");
      }

      const comment = await TicketsService.addComment(req.params.id, parsed.data.body, req.user!);
      res.status(201).json({ comment });
    } catch (error) {
      next(error);
    }
  }

  static async getComments(req: Request, res: Response, next: NextFunction) {
    try {
      const comments = await TicketsService.getComments(req.params.id, req.user!);
      res.status(200).json({ comments });
    } catch (error) {
      next(error);
    }
  }

  static async getEtaExplanation(req: Request, res: Response, next: NextFunction) {
    try {
      const explanation = await TicketsService.getEtaExplanation(req.params.id, req.user!);
      res.status(200).json(explanation);
    } catch (error) {
      next(error);
    }
  }
}
