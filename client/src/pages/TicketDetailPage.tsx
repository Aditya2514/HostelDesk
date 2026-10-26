import React, { useState, useRef } from "react";
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
  Key,
  Camera,
  Upload,
  DoorClosed,
  PauseCircle,
  AlertTriangle,
  ShieldCheck,
  X,
} from "lucide-react";
import { formatFriendlyIst } from "../lib/formatTime";

export const TicketDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Basic interaction states
  const [commentText, setCommentText] = useState("");
  const [priorityModal, setPriorityModal] = useState(false);
  const [newPriority, setNewPriority] = useState<"LOW" | "NORMAL" | "URGENT">("URGENT");
  const [priorityReason, setPriorityReason] = useState("");
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showWhyEstimate, setShowWhyEstimate] = useState(false);

  // Evidence & Resolution states
  const [resolutionCode, setResolutionCode] = useState("");
  const [disputeModal, setDisputeModal] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [falseClaimModal, setFalseClaimModal] = useState(false);
  const [falseClaimReason, setFalseClaimReason] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [holdModal, setHoldModal] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [codeRefusedModal, setCodeRefusedModal] = useState(false);
  const [codeRefusedReason, setCodeRefusedReason] = useState("");
  const [roomLockedModal, setRoomLockedModal] = useState(false);
  const [wardenProblemModal, setWardenProblemModal] = useState(false);
  const [wardenProblemNote, setWardenProblemNote] = useState("");

  // Photo uploads & Lightbox
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [photoUploadSuccess, setPhotoUploadSuccess] = useState<string | null>(null);
  const [activeLightboxImg, setActiveLightboxImg] = useState<{ url: string; kind: string; title: string } | null>(null);
  const afterPhotoInputRef = useRef<HTMLInputElement>(null);
  const doorPhotoInputRef = useRef<HTMLInputElement>(null);

  // Fetch ticket details
  const { data: ticketData, isLoading: isTicketLoading, error: ticketError } = useQuery({
    queryKey: ["ticket", id],
    queryFn: () => api.get<{ ticket: any }>(`/api/tickets/${id}`),
    enabled: Boolean(id),
  });

  const ticket = ticketData?.ticket;

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

  // Fetch completion code (only for room tickets while IN_PROGRESS, requested by student)
  const isStudent = user?.role === "STUDENT";
  const isRoomTicket = ticket?.locationType === "ROOM";
  const isInProgress = ticket?.status === "IN_PROGRESS";

  const { data: codeData } = useQuery({
    queryKey: ["ticket-completion-code", id],
    queryFn: () => api.get<{ code: string; message: string }>(`/api/tickets/${id}/completion-code`),
    enabled: Boolean(id && isStudent && isRoomTicket && isInProgress),
    retry: false,
  });

  // Fetch candidate access slots (when AWAITING_ACCESS)
  const isAwaitingAccess = ticket?.status === "AWAITING_ACCESS";
  const { data: accessSlotsData, isLoading: isSlotsLoading } = useQuery({
    queryKey: ["ticket-access-slots", id],
    queryFn: () => api.get<{ slots: Array<{ slotStart: string; slotEnd: string; label: string }> }>(`/api/tickets/${id}/access-slots`),
    enabled: Boolean(id && isAwaitingAccess && isStudent),
  });

  const events = eventsData?.events ?? [];
  const comments = commentsData?.comments ?? [];
  const accessSlots = accessSlotsData?.slots ?? [];

  const invalidateTicket = () => {
    queryClient.invalidateQueries({ queryKey: ["ticket", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-events", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-comments", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-eta-explanation", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-completion-code", id] });
    queryClient.invalidateQueries({ queryKey: ["ticket-access-slots", id] });
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

  // Resolve Mutation (Staff)
  const resolveMutation = useMutation({
    mutationFn: (data: { code?: string }) => api.post(`/api/tickets/${id}/resolve`, data),
    onSuccess: () => {
      setActionError(null);
      setResolutionCode("");
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to resolve ticket");
    },
  });

  // Confirm Mutation (Student)
  const confirmMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/confirm`),
    onSuccess: () => {
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to confirm resolution");
    },
  });

  // Dispute Mutation (Student)
  const disputeMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/dispute`, { reason }),
    onSuccess: () => {
      setDisputeModal(false);
      setDisputeReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to submit dispute");
    },
  });

  // Access Response Mutation (Student)
  const accessMutation = useMutation({
    mutationFn: (payload: { option: "COMING_15" | "SLOT"; slotStart?: string }) =>
      api.post(`/api/tickets/${id}/access`, payload),
    onSuccess: () => {
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to submit access response");
    },
  });

  // False Locked Claim Dispute Mutation (Student)
  const disputeLockedClaimMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/disputes/locked-claim`, { reason }),
    onSuccess: () => {
      setFalseClaimModal(false);
      setFalseClaimReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to dispute locked claim");
    },
  });

  // Room Locked Mutation (Staff)
  const roomLockedMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/room-locked`),
    onSuccess: () => {
      setRoomLockedModal(false);
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to report room locked");
    },
  });

  // Hold Mutation (Staff)
  const holdMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/hold`, { reason }),
    onSuccess: () => {
      setHoldModal(false);
      setHoldReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to place ticket on hold");
    },
  });

  // Resume Mutation (Staff)
  const resumeMutation = useMutation({
    mutationFn: () => api.post(`/api/tickets/${id}/resume`),
    onSuccess: () => {
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to resume ticket");
    },
  });

  // Code Refused Dispute Mutation (Staff)
  const codeRefusedMutation = useMutation({
    mutationFn: (reason: string) => api.post(`/api/tickets/${id}/disputes/code-refused`, { reason }),
    onSuccess: () => {
      setCodeRefusedModal(false);
      setCodeRefusedReason("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to report code refusal");
    },
  });

  // Warden Check Mutation (Warden)
  const wardenCheckMutation = useMutation({
    mutationFn: (payload: { result: "OK" | "PROBLEM"; note?: string }) =>
      api.post(`/api/tickets/${id}/warden-check`, payload),
    onSuccess: () => {
      setWardenProblemModal(false);
      setWardenProblemNote("");
      setActionError(null);
      invalidateTicket();
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to record warden check");
    },
  });

  // Handle Photo Upload via Cloudinary
  const handleUploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>, role: "BEFORE" | "AFTER" | "DOOR") => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("photo", file);
    formData.append("role", role);

    try {
      setIsUploadingPhoto(true);
      setActionError(null);
      await api.upload(`/api/tickets/${id}/attachments`, formData);
      setPhotoUploadSuccess(`${role} photo successfully uploaded!`);
      setTimeout(() => setPhotoUploadSuccess(null), 4000);
      invalidateTicket();
    } catch (err: any) {
      setActionError(err.message || "Failed to upload photo. Check format and size.");
    } finally {
      setIsUploadingPhoto(false);
      e.target.value = "";
    }
  };

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

  // 48-Hour Dispute Window Calculation
  const isWithinDisputeWindow = ticket.resolvedAt
    ? new Date(ticket.resolvedAt).getTime() + 48 * 3600 * 1000 > Date.now()
    : false;
  const disputeHoursRemaining = ticket.resolvedAt
    ? Math.max(0, Math.round((new Date(ticket.resolvedAt).getTime() + 48 * 3600 * 1000 - Date.now()) / (3600 * 1000)))
    : 0;

  // Attachments partitioned by kind
  const attachments = ticket.attachments ?? [];
  const afterPhotos = attachments.filter((a: any) => a.kind === "AFTER");
  const doorPhotos = attachments.filter((a: any) => a.kind === "DOOR");

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

        {photoUploadSuccess && (
          <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-start space-x-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <span>{photoUploadSuccess}</span>
          </div>
        )}

        {/* =========================================================================
            STUDENT COMPLETION CODE CARD (For room tickets in progress)
            ========================================================================= */}
        {isStudent && isRoomTicket && isInProgress && codeData?.code && (
          <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-indigo-950/80 via-slate-900 to-indigo-950/50 border-2 border-indigo-500/40 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start space-x-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 flex-shrink-0">
                  <Key className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      Private Verification Code
                    </span>
                    <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full font-semibold">
                      Room Occupants Only
                    </span>
                  </div>
                  <h3 className="text-lg font-extrabold text-white">
                    Share only after inspecting the repair
                  </h3>
                  <p className="text-xs text-slate-300 max-w-xl mt-1 leading-relaxed">
                    The technician cannot mark this room repair as complete without this code. Do NOT provide it until the work is fully finished and inspected.
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center justify-center bg-slate-950 border border-indigo-500/40 px-6 py-3.5 rounded-2xl shadow-inner">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-0.5">
                  Completion Code
                </span>
                <span className="text-3xl font-black font-mono tracking-[0.25em] text-indigo-300">
                  {codeData.code}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            STUDENT AWAITING ACCESS PANEL (Locked room response & slots)
            ========================================================================= */}
        {isStudent && isAwaitingAccess && (
          <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-amber-950/80 via-slate-900 to-amber-950/50 border-2 border-amber-500/40 shadow-2xl">
            <div className="flex items-start space-x-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 flex-shrink-0">
                <DoorClosed className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    Access Required
                  </span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-semibold">
                    Visit #{ticket.lockedVisitCount || 1}
                  </span>
                </div>
                <h3 className="text-lg font-extrabold text-white">
                  Technician visited your room but found it locked
                </h3>
                <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                  The repair technician was unable to enter your room. SLA deadline is paused until you confirm availability.
                </p>
              </div>
            </div>

            {/* Locked room options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5 pt-4 border-t border-slate-800">
              {/* Option A: Quick 15 min return */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-amber-400" />
                    <span>I'll be there in 15 minutes</span>
                  </h4>
                  <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                    {(ticket.lockedVisitCount || 0) >= 2
                      ? "Quick 15-minute return is disabled after 2 locked visits. Please schedule an appointment slot instead."
                      : "Technician will be placed on highest priority to return immediately once you reach your room."}
                  </p>
                </div>
                <button
                  onClick={() => accessMutation.mutate({ option: "COMING_15" })}
                  disabled={(ticket.lockedVisitCount || 0) >= 2 || accessMutation.isPending}
                  className="w-full py-2.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-amber-600/20"
                >
                  Confirm: I'll be in my room (15 min)
                </button>
              </div>

              {/* Option B: Choose a 30-min slot */}
              <div className="p-4 rounded-xl bg-slate-800/60 border border-slate-700/80 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-indigo-400" />
                    <span>Schedule Room Access Slot</span>
                  </h4>
                  <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                    Select a 30-minute window during technician working shifts over the next 3 days:
                  </p>
                  {isSlotsLoading ? (
                    <div className="py-4 text-center text-xs text-slate-500">Loading available shift slots...</div>
                  ) : accessSlots.length === 0 ? (
                    <div className="py-4 text-center text-xs text-amber-400">No shift slots available. Contact warden.</div>
                  ) : (
                    <select
                      value={selectedSlot}
                      onChange={(e) => setSelectedSlot(e.target.value)}
                      className="w-full p-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white mb-3"
                    >
                      <option value="">Select available 30-minute window...</option>
                      {accessSlots.map((slot) => (
                        <option key={slot.slotStart} value={slot.slotStart}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <button
                  onClick={() => selectedSlot && accessMutation.mutate({ option: "SLOT", slotStart: selectedSlot })}
                  disabled={!selectedSlot || accessMutation.isPending}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-indigo-600/20"
                >
                  Confirm Selected Slot
                </button>
              </div>
            </div>

            {/* Option C: False claim dispute */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
              <span className="text-slate-400">Were you in your room when the technician visited?</span>
              <button
                onClick={() => setFalseClaimModal(true)}
                className="text-rose-400 hover:text-rose-300 font-semibold underline transition ml-2"
              >
                Report False Locked Claim
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            STUDENT CONFIRM & DISPUTE ACTIONS (Resolved or Closed within 48h)
            ========================================================================= */}
        {isStudent && (ticket.status === "RESOLVED" || ticket.status === "AWAITING_VERIFICATION" || (ticket.status === "CLOSED" && isWithinDisputeWindow)) && (
          <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-indigo-950/60 border-2 border-emerald-500/30 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                    Work Completed by Technician
                  </span>
                  {ticket.resolvedAt && (
                    <span className="text-[10px] bg-slate-800 text-slate-300 border border-slate-700 px-2 py-0.5 rounded-full font-medium">
                      {isWithinDisputeWindow ? `Dispute window: ${disputeHoursRemaining}h remaining` : "Dispute window expired"}
                    </span>
                  )}
                </div>
                <h3 className="text-lg font-extrabold text-white">
                  {ticket.status === "CLOSED" ? "Ticket Closed" : "Please confirm the repair was done properly"}
                </h3>
                <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                  If the issue was fixed, you can confirm it. If the problem persists or was poorly done, you can dispute it within 48 hours to reopen the complaint.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {ticket.status !== "CLOSED" && (
                  <button
                    onClick={() => confirmMutation.mutate()}
                    disabled={confirmMutation.isPending}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirm Resolution</span>
                  </button>
                )}

                {isWithinDisputeWindow && (
                  <button
                    onClick={() => setDisputeModal(true)}
                    className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold text-xs transition"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span>{ticket.status === "CLOSED" ? "Reopen with Dispute" : "Report Problem"}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            STAFF WORKFLOW & EVIDENCE CONTROLS
            ========================================================================= */}
        {isStaffAssigned && (
          <div className="mb-8 p-6 rounded-2xl bg-gradient-to-br from-amber-950/60 via-slate-900 to-slate-900 border-2 border-amber-500/30 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Technician Execution Console</h3>
                  <p className="text-xs text-slate-400">
                    Status: <strong className="text-amber-400">{ticket.status}</strong> · Location: {ticket.locationType}
                  </p>
                </div>
              </div>

              {ticket.status === "ON_HOLD" && (
                <button
                  onClick={() => resumeMutation.mutate()}
                  disabled={resumeMutation.isPending}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg transition disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  <span>Resume Work (Parts Arrived)</span>
                </button>
              )}
            </div>

            {ticket.status === "IN_PROGRESS" && (
              <div className="space-y-5">
                {/* 1. Photo Evidence Section */}
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Camera className="w-4 h-4 text-emerald-400" />
                      <span>Repair Evidence Photo (Cloudinary)</span>
                    </span>
                    {afterPhotos.length > 0 && (
                      <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>After photo uploaded</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mb-3">
                    Upload a clear photo of the completed repair. Required for common area tickets before resolution.
                  </p>

                  <div className="flex items-center gap-3">
                    <input
                      type="file"
                      ref={afterPhotoInputRef}
                      onChange={(e) => handleUploadPhoto(e, "AFTER")}
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                    />
                    <button
                      onClick={() => afterPhotoInputRef.current?.click()}
                      disabled={isUploadingPhoto}
                      className="inline-flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs font-semibold transition disabled:opacity-50"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isUploadingPhoto ? "Uploading to Cloud..." : "Select & Upload After Photo"}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Completion Resolution Section */}
                <div className="p-4 rounded-xl bg-slate-800/50 border border-slate-700/60">
                  <span className="text-xs font-bold text-white block mb-1">
                    {isRoomTicket ? "Room Completion Verification Code" : "Resolve Common Area Ticket"}
                  </span>
                  <p className="text-xs text-slate-400 mb-3">
                    {isRoomTicket
                      ? "Ask the student occupant for their 4-digit verification code after they inspect your repair."
                      : "Ensure an AFTER photo is uploaded above before marking this common area ticket as resolved."}
                  </p>

                  {isRoomTicket ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="text"
                        maxLength={4}
                        pattern="[0-9]*"
                        value={resolutionCode}
                        onChange={(e) => setResolutionCode(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="4-digit code"
                        className="w-36 px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl font-mono text-center text-lg tracking-widest text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                      <button
                        onClick={() => resolveMutation.mutate({ code: resolutionCode })}
                        disabled={resolutionCode.length !== 4 || resolveMutation.isPending}
                        className="inline-flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Verify Code &amp; Mark Resolved</span>
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => resolveMutation.mutate({})}
                      disabled={resolveMutation.isPending}
                      className="inline-flex items-center space-x-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-emerald-600/20 transition disabled:opacity-40"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Mark Common Ticket Resolved</span>
                    </button>
                  )}
                </div>

                {/* 3. Secondary Workflow Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {isRoomTicket && (
                    <>
                      <button
                        onClick={() => setRoomLockedModal(true)}
                        className="inline-flex items-center space-x-1.5 px-3 py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 rounded-xl text-xs font-semibold transition"
                      >
                        <DoorClosed className="w-3.5 h-3.5" />
                        <span>Room Locked (Photo Required)</span>
                      </button>

                      <button
                        onClick={() => setCodeRefusedModal(true)}
                        className="inline-flex items-center space-x-1.5 px-3 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 rounded-xl text-xs font-semibold transition"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Occupant Refused Code</span>
                      </button>
                    </>
                  )}

                  <button
                    onClick={() => setHoldModal(true)}
                    className="inline-flex items-center space-x-1.5 px-3 py-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/20 rounded-xl text-xs font-semibold transition"
                  >
                    <PauseCircle className="w-3.5 h-3.5" />
                    <span>Waiting for Parts (Hold)</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            WARDEN OPTIONAL VERIFICATION (Closed tickets)
            ========================================================================= */}
        {isWarden && ticket.status === "CLOSED" && (
          <div className="mb-8 p-5 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-xs font-bold text-indigo-400 uppercase tracking-wider block mb-0.5">
                  Warden Quality Inspection
                </span>
                <h3 className="text-base font-extrabold text-white">
                  Audit Closed Repair (Optional)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Log an official verification or report an unresolved problem to reopen the ticket.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => wardenCheckMutation.mutate({ result: "OK" })}
                  disabled={wardenCheckMutation.isPending}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-xl shadow-lg transition disabled:opacity-50"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Verified OK</span>
                </button>

                <button
                  onClick={() => setWardenProblemModal(true)}
                  className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold text-xs rounded-xl transition"
                >
                  <AlertCircle className="w-4 h-4" />
                  <span>Report Problem</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TICKET HEADER CARD
            ========================================================================= */}
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
                {ticket.reopenCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-rose-500/15 text-rose-400 border border-rose-500/30 font-bold">
                    Reopened ×{ticket.reopenCount}
                  </span>
                )}
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
                <span>Schedule &amp; Duration Calculation</span>
              </div>
              <p className="leading-relaxed">
                Based on <strong>{etaData.estimate?.n ?? 0} similar {ticket.category?.name} repairs</strong> in {etaData.estimate?.scope === "BLOCK" ? `Block ${ticket.block?.name}` : "hostel"} (typical {etaData.estimate?.observedMedian ?? etaData.estimate?.defaultDuration ?? 45} min of work).
                {etaData.jobsAhead?.length > 0 ? (
                  <span> <strong>{etaData.jobsAhead.length} jobs</strong> ahead of yours in queue.</span>
                ) : (
                  <span> Your ticket is next up in queue!</span>
                )}
                {etaData.shiftToday ? (
                  <span> {etaData.assignee?.name || "Technician"} {etaData.shiftToday.summary || `shift today ends at ${etaData.shiftToday.endFormatted}`}.</span>
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

        {/* =========================================================================
            PHOTO EVIDENCE GALLERY
            ========================================================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Camera className="w-5 h-5 text-indigo-400" />
              <h3 className="text-base font-bold text-white">
                Photo Evidence ({attachments.length})
              </h3>
            </div>
            {isStudent && ticket.status !== "CLOSED" && (
              <div>
                <input
                  type="file"
                  id="before-photo-input"
                  onChange={(e) => handleUploadPhoto(e, "BEFORE")}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                />
                <label
                  htmlFor="before-photo-input"
                  className="cursor-pointer inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Add Photo</span>
                </label>
              </div>
            )}
          </div>

          {attachments.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
              No photos attached to this ticket yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {attachments.map((att: any) => (
                <div
                  key={att.id}
                  onClick={() => setActiveLightboxImg({ url: att.url, kind: att.kind, title: `${att.kind} photo by ${att.uploader?.name || 'User'}` })}
                  className="group relative rounded-xl overflow-hidden border border-slate-800 bg-slate-950 aspect-video cursor-pointer hover:border-indigo-500/50 transition shadow-md"
                >
                  <img
                    src={att.url}
                    alt={att.kind}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent opacity-80" />
                  <div className="absolute top-2 left-2">
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                        att.kind === "AFTER"
                          ? "bg-emerald-500/80 text-white"
                          : att.kind === "DOOR"
                          ? "bg-amber-500/80 text-white"
                          : "bg-indigo-500/80 text-white"
                      }`}
                    >
                      {att.kind}
                    </span>
                  </div>
                  <div className="absolute bottom-2 left-2 right-2 text-[10px] text-slate-300 truncate">
                    <span>{att.uploader?.name || "Uploaded"}</span> ·{" "}
                    <span className="text-slate-400">
                      {new Date(att.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* =========================================================================
            DISPUTES HISTORY (If any)
            ========================================================================= */}
        {ticket.disputes && ticket.disputes.length > 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 mb-8 shadow-xl">
            <h3 className="text-base font-bold text-white mb-4 flex items-center space-x-2">
              <AlertTriangle className="w-5 h-5 text-rose-400" />
              <span>Disputes &amp; Escalations ({ticket.disputes.length})</span>
            </h3>

            <div className="space-y-3">
              {ticket.disputes.map((d: any) => (
                <div
                  key={d.id}
                  className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 text-xs"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-rose-400 uppercase tracking-wider text-[11px]">
                        {d.type.replace(/_/g, " ")}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        d.status === "OPEN" ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"
                      }`}>
                        {d.status}
                      </span>
                    </div>
                    <span className="text-slate-500 text-[10px]">
                      {new Date(d.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-slate-300 mb-2">
                    <strong className="text-slate-400">Claim:</strong> {d.reason}
                  </p>
                  {d.decision && (
                    <div className="mt-2 pt-2 border-t border-slate-800 text-[11px] text-indigo-300">
                      <strong>Warden Decision ({d.decision}):</strong> {d.decisionNote || "No note provided"}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* =========================================================================
            2-COLUMN SECTION: TIMELINE + COMMENTS
            ========================================================================= */}
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

        {/* =========================================================================
            MODALS
            ========================================================================= */}

        {/* Student Dispute Modal */}
        {disputeModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Report Problem / Dispute Resolution</h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Explain why this repair is unsatisfactory or incomplete. This will immediately reopen the complaint and alert the warden and technical team.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Problem Description (Min 5 chars)
                  </label>
                  <textarea
                    rows={4}
                    value={disputeReason}
                    onChange={(e) => setDisputeReason(e.target.value)}
                    placeholder="e.g. Tap still leaks when turned on..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setDisputeModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => disputeMutation.mutate(disputeReason.trim())}
                    disabled={disputeReason.trim().length < 5 || disputeMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Submit Dispute
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* False Claim Dispute Modal */}
        {falseClaimModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Report False Locked Claim</h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                If you or a roommate were present in the room when the technician claimed it was locked, please explain:
              </p>
              <div className="space-y-4">
                <div>
                  <textarea
                    rows={4}
                    value={falseClaimReason}
                    onChange={(e) => setFalseClaimReason(e.target.value)}
                    placeholder="e.g. My roommate and I were inside studying and nobody knocked..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setFalseClaimModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => disputeLockedClaimMutation.mutate(falseClaimReason.trim())}
                    disabled={falseClaimReason.trim().length < 5 || disputeLockedClaimMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Submit Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Staff Room Locked Modal (Requires Door Photo) */}
        {roomLockedModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2">
                <DoorClosed className="w-5 h-5 text-amber-400" />
                <span>Report Room Locked</span>
              </h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                HostelDesk rules require a photographic proof (door with room number) taken on site to prevent false locked claims.
              </p>

              <div className="space-y-4">
                <div className="p-3 bg-slate-800/60 rounded-xl border border-slate-700/60">
                  <span className="text-xs font-semibold text-slate-300 block mb-2">
                    Door Photo Evidence:
                  </span>
                  {doorPhotos.length > 0 ? (
                    <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Door photo ready ({doorPhotos.length} on file)</span>
                    </div>
                  ) : (
                    <div>
                      <input
                        type="file"
                        ref={doorPhotoInputRef}
                        onChange={(e) => handleUploadPhoto(e, "DOOR")}
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                      />
                      <button
                        onClick={() => doorPhotoInputRef.current?.click()}
                        disabled={isUploadingPhoto}
                        className="w-full py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-xl text-xs transition disabled:opacity-50"
                      >
                        {isUploadingPhoto ? "Uploading Door Photo..." : "Upload Door Photo Now"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setRoomLockedModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => roomLockedMutation.mutate()}
                    disabled={doorPhotos.length === 0 || roomLockedMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Confirm Room Locked
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Staff Hold Modal */}
        {holdModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Place Ticket On Hold</h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Provide a valid reason (e.g. waiting for spare tap parts from central inventory). SLA accounting will pause until work is resumed.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Reason for Hold (Min 5 chars)
                  </label>
                  <textarea
                    rows={3}
                    value={holdReason}
                    onChange={(e) => setHoldReason(e.target.value)}
                    placeholder="e.g. Specific ceramic disc cartridge not in stock, requisitioned from central store..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setHoldModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => holdMutation.mutate(holdReason.trim())}
                    disabled={holdReason.trim().length < 5 || holdMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Place On Hold
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Staff Code Refused Modal */}
        {codeRefusedModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Report Occupant Refused Code</h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                If the work is fully finished with photo evidence but the student refuses to provide their 4-digit completion code, report it to the warden for arbitration.
              </p>
              <div className="space-y-4">
                <div>
                  <textarea
                    rows={3}
                    value={codeRefusedReason}
                    onChange={(e) => setCodeRefusedReason(e.target.value)}
                    placeholder="Explain the situation..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setCodeRefusedModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => codeRefusedMutation.mutate(codeRefusedReason.trim())}
                    disabled={codeRefusedReason.trim().length < 5 || codeRefusedMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Submit Report to Warden
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Warden Problem Modal */}
        {wardenProblemModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Warden Problem Report</h3>
              <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                Describe the defect or incomplete work observed. This ticket will be reopened immediately and reassigned to preferred staff.
              </p>
              <div className="space-y-4">
                <div>
                  <textarea
                    rows={4}
                    value={wardenProblemNote}
                    onChange={(e) => setWardenProblemNote(e.target.value)}
                    placeholder="e.g. Paint finish incomplete, electrical switch still sparking..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setWardenProblemModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => wardenCheckMutation.mutate({ result: "PROBLEM", note: wardenProblemNote.trim() })}
                    disabled={wardenProblemNote.trim().length < 3 || wardenCheckMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Reopen Ticket
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Lightbox Modal */}
        {activeLightboxImg && (
          <div
            onClick={() => setActiveLightboxImg(null)}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-4xl max-h-[90vh] flex flex-col items-center"
            >
              <button
                onClick={() => setActiveLightboxImg(null)}
                className="absolute -top-10 right-0 p-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={activeLightboxImg.url}
                alt={activeLightboxImg.kind}
                className="max-w-full max-h-[80vh] rounded-xl object-contain shadow-2xl border border-slate-800"
              />
              <div className="mt-3 text-xs text-slate-300 font-semibold flex items-center space-x-2">
                <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  {activeLightboxImg.kind} Photo
                </span>
                <span>{activeLightboxImg.title}</span>
              </div>
            </div>
          </div>
        )}

        {/* Existing Priority & Reject Modals */}
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
