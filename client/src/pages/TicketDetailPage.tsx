import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import {
  ArrowLeft,
  Clock,
  User,
  MapPin,
  Calendar,
  Send,
  Play,
  XCircle,
  Flag,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { formatFriendlyIst } from "../lib/formatTime";

export const TicketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [commentText, setCommentText] = useState("");
  const [priorityModal, setPriorityModal] = useState(false);
  const [newPriority, setNewPriority] = useState<"LOW" | "NORMAL" | "URGENT">("URGENT");
  const [priorityReason, setPriorityReason] = useState("");

  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const [actionError, setActionError] = useState<string | null>(null);
  const [showWhyEstimate, setShowWhyEstimate] = useState(false);

  // Fetch ticket details
  const { data: ticketData, isLoading: isTicketLoading, error: ticketError } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.get<{ ticket: any }>(`/api/tickets/${id}`),
    enabled: Boolean(id),
  });

  // Fetch ETA explanation
  const { data: etaData } = useQuery({
    queryKey: ["ticket-eta-explanation", id],
    queryFn: () => api.get<any>(`/api/tickets/${id}/eta-explanation`),
    enabled: Boolean(id),
  });

  // Fetch events timeline
  const { data: eventsData } = useQuery({
    queryKey: ["ticket-events", id],
    queryFn: () => api.get<{ events: any[] }>(`/api/tickets/${id}/events`),
    enabled: Boolean(id),
  });

  // Fetch comments
  const { data: commentsData } = useQuery({
    queryKey: ["ticket-comments", id],
    queryFn: () => api.get<{ comments: any[] }>(`/api/tickets/${id}/comments`),
    enabled: Boolean(id),
  });

  const ticket = ticketData?.ticket;
  const events = eventsData?.events ?? [];
  const comments = commentsData?.comments ?? [];

  const invalidateTicket = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-events", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-comments", id] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  // Mutations
  const startWorkMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/start`),
    onSuccess: () => {
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to start work");
    },
  });

  const followMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/follow`),
    onSuccess: () => {
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to join ticket");
    },
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => api.post(`/api/tickets/${id}/comments`, { body }),
    onSuccess: () => {
      setCommentText("");
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["ticket-comments", id] });
      queryClient.invalidateQueries({ queryKey: ["ticket-events", id] });
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to post comment");
    },
  });

  const updatePriorityMutation = useMutation({
    mutationFn: () =>
      api.patch(`/api/tickets/${id}/priority`, {
        priority: newPriority,
        reason: priorityReason,
      }),
    onSuccess: () => {
      setPriorityModal(false);
      setPriorityReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to change priority");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () =>
      api.post(`/api/tickets/${id}/reject`, {
        reason: rejectReason,
      }),
    onSuccess: () => {
      setRejectModal(false);
      setRejectReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to reject ticket");
    },
  });

  if (isTicketLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <Header />
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (ticketError || !ticket) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
          <XCircle className="w-12 h-12 text-rose-500 mb-3" />
          <h2 className="text-xl font-bold text-white mb-1">Ticket Not Found</h2>
          <p className="text-sm text-slate-400 mb-6">
            You may not have permission to view this ticket or it may not exist.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="px-4 py-2 bg-slate-800 text-sm font-semibold rounded-xl text-slate-200 hover:bg-slate-700 transition"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const isStaffAssigned = user?.role === "STAFF" && ticket.assignedToId === user.id;
  const isWarden = ["WARDEN", "CHIEF_WARDEN", "ADMIN"].includes(user?.role || "");
  const canStartWork = isStaffAssigned && ticket.status === "ASSIGNED";
  const canFollow =
    user?.role === "STUDENT" &&
    ticket.locationType === "COMMON" &&
    !ticket.isFollowing &&
    ticket.raisedById !== user.id;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Navigation back */}
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 mb-6 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>

        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-start space-x-2">
            <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Ticket Header Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-800/80 pb-6 mb-6">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {ticket.code}
                </span>
                <StatusBadge status={ticket.status} />
                <PriorityBadge priority={ticket.priority} />
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/60">
                  {ticket.category?.name}
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                {ticket.title}
              </h1>
            </div>

            {/* Actions Bar */}
            <div className="flex flex-wrap items-center gap-2">
              {canStartWork && (
                <button
                  onClick={() => startWorkMutation.mutate()}
                  disabled={startWorkMutation.isPending}
                  className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm shadow-lg shadow-amber-600/20 transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  <span>Start Work</span>
                </button>
              )}

              {canFollow && (
                <button
                  onClick={() => followMutation.mutate()}
                  disabled={followMutation.isPending}
                  className="inline-flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/20 transition disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Join Complaint</span>
                </button>
              )}

              {isWarden && ticket.status !== "CLOSED" && ticket.status !== "REJECTED" && (
                <>
                  <button
                    onClick={() => setPriorityModal(true)}
                    className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-semibold transition"
                  >
                    <Flag className="w-3.5 h-3.5 text-amber-400" />
                    <span>Priority</span>
                  </button>

                  <button
                    onClick={() => setRejectModal(true)}
                    className="inline-flex items-center space-x-1 px-3 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 text-xs font-semibold transition"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Reject</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Prominent ETA Banner */}
          <div className="mb-6 p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/60 border border-indigo-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-lg shadow-indigo-950/30">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 flex-shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[11px] uppercase font-bold tracking-wider text-indigo-400">
                  Estimated Completion Range
                </div>
                <div className="text-base sm:text-lg font-extrabold text-white">
                  {ticket.etaP50At ? (
                    <>
                      Likely by <span className="text-emerald-400">{formatFriendlyIst(ticket.etaP50At)}</span>
                      {ticket.etaP80At && (
                        <span className="text-slate-400 text-xs sm:text-sm font-normal">
                          {" "}· latest around {formatFriendlyIst(ticket.etaP80At)}
                        </span>
                      )}
                    </>
                  ) : ticket.status === "RAISED" ? (
                    <span className="text-amber-400 text-sm">Waiting for assignment</span>
                  ) : ticket.status === "ON_HOLD" || ticket.status === "AWAITING_ACCESS" ? (
                    <span className="text-amber-400 text-sm">ETA paused: Awaiting room access or parts</span>
                  ) : (
                    <span className="text-slate-400 text-sm">Status: {ticket.status}</span>
                  )}
                </div>
              </div>
            </div>

            {ticket.etaP50At && (
              <button
                onClick={() => setShowWhyEstimate(!showWhyEstimate)}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition self-start sm:self-center"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>{showWhyEstimate ? "Hide Explanation" : "Why this estimate?"}</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showWhyEstimate ? "rotate-180" : ""}`} />
              </button>
            )}
          </div>

          {/* Collapsible Why This Estimate Panel */}
          {showWhyEstimate && etaData && (
            <div className="mb-6 p-5 rounded-2xl bg-slate-800/80 border border-slate-700 text-xs text-slate-300 space-y-3.5 animate-in fade-in duration-200">
              <div className="font-semibold text-white text-sm flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-indigo-400" />
                <span>Schedule & Duration Calculation</span>
              </div>
              <p className="leading-relaxed">
                Based on <strong>{etaData.estimate?.n ?? 0} similar {ticket.category?.name} repairs</strong> in {etaData.estimate?.scope === "BLOCK" ? `Block ${ticket.block?.name}` : "hostel"} (typical {etaData.estimate?.observedMedian ?? etaData.estimate?.defaultDuration ?? 45} min of work).
                {etaData.jobsAhead?.length > 0 ? (
                  <span> <strong>{etaData.jobsAhead.length} jobs</strong> ahead of yours in queue.</span>
                ) : (
                  <span> Your ticket is next up in queue!</span>
                )}
                {etaData.shiftToday ? (
                  <span> {etaData.assignee?.name || "Technician"}'s shift today ends at {etaData.shiftToday.endFormatted}.</span>
                ) : (
                  <span> Staff is on duty according to scheduled shift windows.</span>
                )}
              </p>

              {etaData.jobsAhead?.length > 0 && (
                <div>
                  <div className="font-bold text-slate-400 uppercase text-[10px] tracking-wider mb-1.5">
                    Jobs Scheduled Ahead (Anonymized)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {etaData.jobsAhead.map((j: any, idx: number) => (
                      <div key={idx} className="px-2.5 py-1 bg-slate-900 border border-slate-700/80 rounded-lg flex items-center space-x-2">
                        <span className="font-mono text-slate-300 font-bold">{j.code}</span>
                        <PriorityBadge priority={j.priority} />
                        <span className="text-slate-500">~{j.estMinutes}m</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {etaData.history?.length > 0 && (
                <div>
                  <div className="font-bold text-slate-400 uppercase text-[10px] tracking-wider mb-1.5">
                    Prediction History (Last 5 Updates)
                  </div>
                  <div className="space-y-1">
                    {etaData.history.map((h: any, idx: number) => (
                      <div key={idx} className="flex items-center justify-between text-[11px] text-slate-400 py-0.5 border-b border-slate-700/40 last:border-0">
                        <span>{formatFriendlyIst(h.createdAt)}</span>
                        <span className="text-slate-300 font-medium">Predicted completion: {formatFriendlyIst(h.predictedP50At)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Details Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">Location</span>
              <div className="font-semibold text-slate-200 flex items-center space-x-1">
                <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {ticket.locationType === "ROOM"
                    ? `${ticket.block?.name}-${ticket.room?.number}`
                    : `Floor ${ticket.floor} (${ticket.commonSpot})`}
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">Assigned Staff</span>
              <div className="font-semibold text-slate-200 flex items-center space-x-1">
                <User className="w-3.5 h-3.5 text-amber-400" />
                <span>{ticket.assignedTo ? `${ticket.assignedTo.name} (${ticket.assignedTo.trade})` : "Unassigned"}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">Due Deadline (SLA)</span>
              <div className="font-semibold text-slate-200 flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5 text-rose-400" />
                <span>{new Date(ticket.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>

            <div className="p-3 bg-slate-800/40 rounded-xl border border-slate-800">
              <span className="text-slate-500 block mb-1">Reported</span>
              <div className="font-semibold text-slate-200 flex items-center space-x-1">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="mt-6 pt-6 border-t border-slate-800/80">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Issue Description
            </h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed">
              {ticket.description}
            </p>
          </div>
        </div>

        {/* 2-Column Section: Timeline + Comments */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Events Timeline */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
            <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
              <Clock className="w-5 h-5 text-indigo-400" />
              <span>Audit Trail Timeline</span>
            </h3>

            <div className="space-y-4 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-slate-800">
              {events.length === 0 ? (
                <p className="text-xs text-slate-500">No events logged yet.</p>
              ) : (
                events.map((evt) => (
                  <div key={evt.id} className="relative flex items-start space-x-3.5 text-xs">
                    <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center flex-shrink-0 z-10 text-indigo-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 bg-slate-800/40 p-3 rounded-xl border border-slate-800/80">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-bold text-slate-200">{evt.type}</span>
                        <span className="text-[10px] text-slate-500">
                          {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-slate-400">{evt.note || "Status updated"}</p>
                      {evt.actor && (
                        <span className="text-[10px] text-indigo-400 mt-1 block">
                          By: {evt.actor.name} ({evt.actor.role})
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Comments Section */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col">
            <h3 className="text-base font-bold text-white mb-4">
              Discussion &amp; Updates ({comments.length})
            </h3>

            {/* Comments List */}
            <div className="flex-1 space-y-3.5 max-h-96 overflow-y-auto mb-4 pr-1">
              {comments.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">
                  No comments yet. Roommates, staff, and wardens can communicate here.
                </div>
              ) : (
                comments.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl bg-slate-800/50 border border-slate-800 text-xs"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-slate-200">
                        {c.author?.name}{" "}
                        <span className="text-[10px] text-slate-400 font-normal">
                          ({c.author?.role})
                        </span>
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {new Date(c.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-slate-300 leading-relaxed">{c.body}</p>
                  </div>
                ))
              )}
            </div>

            {/* Comment Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (commentText.trim()) commentMutation.mutate(commentText.trim());
              }}
              className="mt-auto"
            >
              <div className="relative">
                <input
                  type="text"
                  maxLength={500}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write a message or update..."
                  className="w-full pl-3.5 pr-11 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || commentMutation.isPending}
                  className="absolute right-1.5 top-1.5 p-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white disabled:opacity-40 transition"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Change Priority Modal */}
        {priorityModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Change Ticket Priority</h3>
              <p className="text-xs text-slate-400 mb-4">
                Note: SLA deadlines remain category-based according to domain rules.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Priority Level
                  </label>
                  <select
                    value={newPriority}
                    onChange={(e: any) => setNewPriority(e.target.value)}
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    <option value="URGENT">URGENT</option>
                    <option value="NORMAL">NORMAL</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Reason for Change (Required)
                  </label>
                  <textarea
                    rows={3}
                    value={priorityReason}
                    onChange={(e) => setPriorityReason(e.target.value)}
                    placeholder="Explain why this ticket's priority was adjusted..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setPriorityModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => updatePriorityMutation.mutate()}
                    disabled={priorityReason.trim().length < 5 || updatePriorityMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Confirm Change
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Reject Modal */}
        {rejectModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Reject Complaint</h3>
              <p className="text-xs text-slate-400 mb-4">
                Provide a clear reason why this complaint is invalid or not a hostel issue.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Rejection Reason (Required)
                  </label>
                  <textarea
                    rows={3}
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setRejectModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => rejectMutation.mutate()}
                    disabled={rejectReason.trim().length < 5 || rejectMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Reject Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
