import React from "react";

export type TicketStatus =
  | "RAISED"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "AWAITING_ACCESS"
  | "ON_HOLD"
  | "RESOLVED"
  | "AWAITING_VERIFICATION"
  | "CLOSED"
  | "REOPENED"
  | "REJECTED";

export type Priority = "LOW" | "NORMAL" | "URGENT";

interface StatusBadgeProps {
  status: TicketStatus;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className = "" }) => {
  const getBadgeStyle = () => {
    switch (status) {
      case "RAISED":
        return "bg-sky-500/10 text-sky-400 border-sky-500/20";
      case "ASSIGNED":
        return "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
      case "IN_PROGRESS":
        return "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse";
      case "AWAITING_ACCESS":
        return "bg-yellow-500/10 text-yellow-400 border-yellow-500/20";
      case "ON_HOLD":
        return "bg-purple-500/10 text-purple-400 border-purple-500/20";
      case "RESOLVED":
        return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "AWAITING_VERIFICATION":
        return "bg-teal-500/10 text-teal-400 border-teal-500/20";
      case "CLOSED":
        return "bg-slate-800 text-slate-400 border-slate-700";
      case "REOPENED":
        return "bg-pink-500/10 text-pink-400 border-pink-500/20";
      case "REJECTED":
        return "bg-rose-500/10 text-rose-400 border-rose-500/20";
      default:
        return "bg-slate-800 text-slate-400 border-slate-700";
    }
  };

  const getLabel = () => {
    switch (status) {
      case "IN_PROGRESS":
        return "In Progress";
      case "AWAITING_ACCESS":
        return "Awaiting Access";
      case "ON_HOLD":
        return "On Hold";
      case "AWAITING_VERIFICATION":
        return "Awaiting Verification";
      default:
        return status.charAt(0) + status.slice(1).toLowerCase();
    }
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getBadgeStyle()} ${className}`}
    >
      {getLabel()}
    </span>
  );
};

export const PriorityBadge: React.FC<{ priority: Priority; className?: string }> = ({
  priority,
  className = "",
}) => {
  switch (priority) {
    case "URGENT":
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/15 text-rose-400 border border-rose-500/30 uppercase tracking-wider ${className}`}
        >
          Urgent
        </span>
      );
    case "NORMAL":
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wider ${className}`}
        >
          Normal
        </span>
      );
    case "LOW":
      return (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700 uppercase tracking-wider ${className}`}
        >
          Low
        </span>
      );
  }
};
