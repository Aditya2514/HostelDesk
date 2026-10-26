import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import {
  Shield,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  ArrowUpRight,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  X,
  ExternalLink,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { formatFriendlyIst } from "../lib/formatTime";
import { AnalyticsView } from "../components/AnalyticsView";

export const WardenDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isChief = user?.role === "CHIEF_WARDEN" || user?.role === "ADMIN";

  const [activeTab, setActiveTab] = useState<"tickets" | "schedules" | "disputes" | "analytics">("tickets");
  const [selectedStaffId, setSelectedStaffId] = useState<string>("");

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Dispute arbitration modal state
  const [disputeStatusFilter, setDisputeStatusFilter] = useState<string>("OPEN");
  const [selectedDispute, setSelectedDispute] = useState<any | null>(null);
  const [decisionType, setDecisionType] = useState<"UPHELD" | "REJECTED">("UPHELD");
  const [decisionNote, setDecisionNote] = useState<string>("");
  const [decisionError, setDecisionError] = useState<string | null>(null);

  // Build query string
  const queryParams = new URLSearchParams();
  queryParams.set("page", page.toString());
  queryParams.set("limit", "15");
  if (statusFilter) queryParams.set("status", statusFilter);
  if (priorityFilter) queryParams.set("priority", priorityFilter);
  if (floorFilter) queryParams.set("floor", floorFilter);
  if (search.trim()) queryParams.set("search", search.trim());

  // Fetch tickets
  const { data, isLoading } = useQuery({
    queryKey: ["warden-tickets", page, statusFilter, priorityFilter, floorFilter, search],
    queryFn: () => api.get<{ tickets: any[]; pagination: any }>(`/api/tickets?${queryParams.toString()}`),
  });

  const tickets = data?.tickets ?? [];
  const pagination = data?.pagination;

  // Fetch all staff members for the schedules tab
  const { data: staffListData } = useQuery({
    queryKey: ["staff-list"],
    queryFn: () => api.get<{ staff: any[] }>("/api/staff"),
  });
  const staffMembers = staffListData?.staff ?? [];

  // Current staff member selection
  const effectiveStaffId = selectedStaffId || (staffMembers.length > 0 ? staffMembers[0].id : "");

  // Fetch schedule for the selected staff member
  const { data: scheduleData, isLoading: isScheduleLoading } = useQuery({
    queryKey: ["staff-schedule", effectiveStaffId],
    queryFn: () => api.get<{ staff: any; shifts: any[]; jobs: any[] }>(`/api/staff/${effectiveStaffId}/schedule`),
    enabled: !!effectiveStaffId && activeTab === "schedules",
  });
  const plannedJobs = scheduleData?.jobs ?? [];

  // Fetch disputes
  const { data: disputesData, isLoading: isDisputesLoading } = useQuery({
    queryKey: ["disputes", disputeStatusFilter],
    queryFn: () =>
      api.get<{ disputes: any[] }>(
        `/api/disputes${disputeStatusFilter ? `?status=${disputeStatusFilter}` : ""}`
      ),
    enabled: activeTab === "disputes",
  });
  const disputes = (disputesData as any)?.disputes ?? (Array.isArray(disputesData) ? disputesData : []);

  // Decide dispute mutation
  const decideMutation = useMutation({
    mutationFn: ({ disputeId, payload }: { disputeId: string; payload: { decision: "UPHELD" | "REJECTED"; note?: string } }) =>
      api.post(`/api/disputes/${disputeId}/decide`, payload),
    onSuccess: () => {
      setSelectedDispute(null);
      setDecisionNote("");
      setDecisionError(null);
      queryClient.invalidateQueries({ queryKey: ["disputes"] });
      queryClient.invalidateQueries({ queryKey: ["warden-tickets"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err: any) => {
      setDecisionError(err.message || "Failed to record dispute decision");
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Warden Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase mb-1 block">
                {isChief ? "Hostel Campus Administration" : `Block ${user?.blockName || "A"} Console`}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {isChief ? "Chief Warden Console" : `Block ${user?.blockName || "A"} Warden Console`}
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                {isChief
                  ? "Campus-wide complaint oversight, trade reassignments, dispute arbitrations, and escalations"
                  : `Monitor active complaints, reassign technicians, and arbitrate room disputes in Block ${user?.blockName || "A"}`}
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-xs">
              <Shield className="w-4 h-4 text-indigo-400" />
              <span className="text-slate-300 font-medium">
                Scope: {isChief ? "All Blocks (A, B, C)" : `Block ${user?.blockName || "A"}`}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center space-x-3 mb-6 border-b border-slate-800 pb-3">
          <button
            onClick={() => setActiveTab("tickets")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center space-x-2 ${
              activeTab === "tickets"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Active Complaints</span>
          </button>

          <button
            onClick={() => setActiveTab("schedules")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center space-x-2 ${
              activeTab === "schedules"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Staff Schedules</span>
          </button>

          <button
            onClick={() => setActiveTab("disputes")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center space-x-2 ${
              activeTab === "disputes"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Disputes &amp; Arbitrations</span>
          </button>

          <button
            onClick={() => setActiveTab("analytics")}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center space-x-2 ${
              activeTab === "analytics"
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Analytics &amp; Performance</span>
          </button>
        </div>

        {activeTab === "tickets" ? (
          <>
            {/* Filter Controls Bar */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 mb-6 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search ticket code or title..."
                    className="w-full pl-9 pr-3.5 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {/* Status Filter */}
                <div className="flex items-center space-x-1.5">
                  <Filter className="w-3.5 h-3.5 text-slate-500" />
                  <select
                    value={statusFilter}
                    onChange={(e) => {
                      setStatusFilter(e.target.value);
                      setPage(1);
                    }}
                    className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">All Statuses</option>
                    <option value="RAISED">Raised</option>
                    <option value="ASSIGNED">Assigned</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="AWAITING_ACCESS">Awaiting Access</option>
                    <option value="ON_HOLD">On Hold</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="AWAITING_VERIFICATION">Awaiting Verification</option>
                    <option value="CLOSED">Closed</option>
                    <option value="REOPENED">Reopened</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>

                {/* Priority Filter */}
                <select
                  value={priorityFilter}
                  onChange={(e) => {
                    setPriorityFilter(e.target.value);
                    setPage(1);
                  }}
                  className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Priorities</option>
                  <option value="URGENT">Urgent</option>
                  <option value="NORMAL">Normal</option>
                  <option value="LOW">Low</option>
                </select>

                {/* Floor Filter */}
                <select
                  value={floorFilter}
                  onChange={(e) => {
                    setFloorFilter(e.target.value);
                    setPage(1);
                  }}
                  className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="">All Floors</option>
                  <option value="0">Ground Floor</option>
                  <option value="1">Floor 1</option>
                  <option value="2">Floor 2</option>
                  <option value="3">Floor 3</option>
                </select>
              </div>

              {(statusFilter || priorityFilter || floorFilter || search) && (
                <button
                  onClick={() => {
                    setStatusFilter("");
                    setPriorityFilter("");
                    setFloorFilter("");
                    setSearch("");
                    setPage(1);
                  }}
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-medium"
                >
                  Clear Filters
                </button>
              )}
            </div>

            {/* Tickets Table / List */}
            {isLoading ? (
              <div className="py-24 flex justify-center">
                <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
                <Shield className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-white mb-1">No Tickets Found</h4>
                <p className="text-xs text-slate-500">
                  No tickets matched your filter criteria. Try adjusting or clearing your filters.
                </p>
              </div>
            ) : (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-900/50 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        <th className="py-3 px-4">Ticket</th>
                        <th className="py-3 px-4">Title &amp; Category</th>
                        <th className="py-3 px-4">Location</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Priority</th>
                        <th className="py-3 px-4">Assigned To</th>
                        <th className="py-3 px-4">SLA Due</th>
                        <th className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {tickets.map((t) => (
                        <tr
                          key={t.id}
                          onClick={() => navigate(`/tickets/${t.id}`)}
                          className="hover:bg-slate-800/40 cursor-pointer transition"
                        >
                          <td className="py-3.5 px-4 font-mono font-bold text-indigo-400 whitespace-nowrap">
                            {t.code}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-semibold text-white truncate max-w-xs">{t.title}</div>
                            <span className="text-[11px] text-slate-500">{t.category?.name}</span>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className="flex items-center space-x-1 text-slate-300">
                              <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                              <span>
                                {t.locationType === "ROOM"
                                  ? `${t.block?.name}-${t.room?.number}`
                                  : `Fl ${t.floor} (${t.commonSpot})`}
                              </span>
                            </span>
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <StatusBadge status={t.status} />
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <PriorityBadge priority={t.priority} />
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap text-slate-300">
                            {t.assignedTo ? (
                              <span>{t.assignedTo.name} ({t.assignedTo.trade})</span>
                            ) : (
                              <span className="text-slate-500 italic">Unassigned</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap text-slate-400">
                            {new Date(t.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <span className="inline-flex items-center text-xs font-semibold text-indigo-400 hover:text-indigo-300">
                              <span>View</span>
                              <ArrowUpRight className="w-3.5 h-3.5 ml-0.5" />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {pagination && pagination.pages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t border-slate-800 text-xs text-slate-400">
                    <div>
                      Showing page <strong className="text-white">{page}</strong> of{" "}
                      <strong className="text-white">{pagination.pages}</strong> ({pagination.total} total)
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setPage((p) => Math.min(pagination.pages, p + 1))}
                        disabled={page === pagination.pages}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : activeTab === "schedules" ? (
          /* Staff Schedules Tab */
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white">Technician Shift Workloads</h3>
                  <p className="text-xs text-slate-400">
                    Inspect the queued jobs, shift windows, and calculated daily sequence per staff member
                  </p>
                </div>

                {/* Staff Member Selector */}
                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Technician:</span>
                  <select
                    value={effectiveStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    {staffMembers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.trade})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {isScheduleLoading ? (
                <div className="py-16 flex justify-center">
                  <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : plannedJobs.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No active jobs scheduled for this technician.
                </div>
              ) : (
                <div className="space-y-3">
                  {plannedJobs.map((job, idx) => (
                    <div
                      key={job.ticketId}
                      onClick={() => navigate(`/tickets/${job.ticketId}`)}
                      className="flex flex-col md:flex-row md:items-center justify-between p-3.5 rounded-xl bg-slate-800/50 hover:bg-slate-800 border border-slate-700/60 cursor-pointer transition gap-3"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <span className="w-7 h-7 rounded-full bg-slate-700 text-indigo-300 font-mono text-xs font-bold flex items-center justify-center flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-xs font-bold text-slate-300">{job.code}</span>
                            <PriorityBadge priority={job.priority} />
                            <StatusBadge status={job.status} />
                          </div>
                          <h5 className="text-xs font-semibold text-white truncate mt-1">
                            {job.title}
                          </h5>
                        </div>
                      </div>

                      <div className="flex items-center justify-between md:justify-end gap-5 text-xs flex-shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-700/50">
                        <div className="text-right">
                          <div className="text-indigo-300 font-semibold flex items-center space-x-1 justify-end">
                            <Clock className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Start: {formatFriendlyIst(job.startAt)}</span>
                          </div>
                          <div className="text-slate-400 text-[11px] mt-0.5">
                            Est. Finish: {formatFriendlyIst(job.finishAt)}
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/tickets/${job.ticketId}`);
                          }}
                          className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 transition"
                          title="Open ticket details"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "analytics" ? (
          /* =========================================================================
              ANALYTICS & PERFORMANCE TAB
              ========================================================================= */
          <AnalyticsView
            onSelectStaff={(staffId) => {
              setSelectedStaffId(staffId);
              setActiveTab("schedules");
            }}
          />
        ) : (
          /* =========================================================================
              DISPUTES & ARBITRATIONS TAB
              ========================================================================= */
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                    <span>Dispute Arbitration Queue</span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Arbitrate technician code refusals, student false locked claims, and unsatisfactory repair escalations
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-xs text-slate-400">Status:</span>
                  <select
                    value={disputeStatusFilter}
                    onChange={(e) => setDisputeStatusFilter(e.target.value)}
                    className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white"
                  >
                    <option value="OPEN">Open (Action Needed)</option>
                    <option value="RESOLVED">Resolved (Audit History)</option>
                    <option value="">All Disputes</option>
                  </select>
                </div>
              </div>

              {isDisputesLoading ? (
                <div className="py-16 flex justify-center">
                  <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                </div>
              ) : disputes.length === 0 ? (
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-xs">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                  <h4 className="text-sm font-bold text-white mb-1">No Active Disputes</h4>
                  <p className="text-slate-500">All room complaints and evidence workflows are in harmony.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {disputes.map((d: any) => (
                    <div
                      key={d.id}
                      className="p-5 rounded-2xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/15 text-rose-400 border border-rose-500/30">
                              {d.type.replace(/_/g, " ")}
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              d.status === "OPEN" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "bg-emerald-500/20 text-emerald-300"
                            }`}>
                              {d.status}
                            </span>
                            <span className="font-mono text-xs font-bold text-indigo-400">
                              {d.ticket?.code}
                            </span>
                          </div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{d.ticket?.title}</span>
                            <button
                              onClick={() => navigate(`/tickets/${d.ticketId}`)}
                              className="text-slate-400 hover:text-indigo-400"
                              title="Open ticket"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </button>
                          </h4>
                          <span className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                            <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                            <span>
                              {d.ticket?.locationType === "ROOM"
                                ? `Block ${d.ticket?.block?.name || "A"} - Room ${d.ticket?.room?.number}`
                                : `Floor ${d.ticket?.floor} (${d.ticket?.commonSpot})`}
                            </span>
                            <span>· Trade: {d.ticket?.category?.trade}</span>
                          </span>
                        </div>

                        <div className="text-xs text-slate-400 text-right">
                          <div>Raised by: <strong className="text-slate-200">{d.raisedBy?.name}</strong> ({d.raisedBy?.role})</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">
                            {new Date(d.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      {/* Dispute statement */}
                      <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-300 mb-3">
                        <strong className="text-slate-400 block mb-1">Reason / Statement:</strong>
                        <p className="leading-relaxed whitespace-pre-wrap">{d.reason}</p>
                      </div>

                      {/* Attached photos on ticket (especially door photos) */}
                      {d.ticket?.attachments && d.ticket.attachments.length > 0 && (
                        <div className="mb-4">
                          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                            Evidence Photos on File:
                          </span>
                          <div className="flex flex-wrap gap-2">
                            {d.ticket.attachments.map((att: any) => (
                              <a
                                key={att.id}
                                href={att.url}
                                target="_blank"
                                rel="noreferrer"
                                className="group relative w-20 h-14 rounded-lg overflow-hidden border border-slate-700 bg-slate-900 block"
                              >
                                <img
                                  src={att.url}
                                  alt={att.kind}
                                  className="w-full h-full object-cover group-hover:scale-105 transition"
                                />
                                <span className="absolute bottom-0 inset-x-0 bg-slate-950/80 text-[9px] text-center font-bold text-white py-0.5">
                                  {att.kind}
                                </span>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Decision Details or Actions */}
                      {d.status === "OPEN" ? (
                        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
                          <button
                            onClick={() => {
                              setSelectedDispute(d);
                              setDecisionType("REJECTED");
                              setDecisionNote("");
                              setDecisionError(null);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-rose-300 border border-rose-500/20 text-xs font-semibold transition"
                          >
                            Reject Dispute
                          </button>
                          <button
                            onClick={() => {
                              setSelectedDispute(d);
                              setDecisionType("UPHELD");
                              setDecisionNote("");
                              setDecisionError(null);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/20 transition"
                          >
                            Uphold Dispute
                          </button>
                        </div>
                      ) : (
                        <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
                          <div className="text-slate-400">
                            Decision:{" "}
                            <strong className={d.decision === "UPHELD" ? "text-emerald-400" : "text-rose-400"}>
                              {d.decision}
                            </strong>
                            {d.decisionNote && <span> — "{d.decisionNote}"</span>}
                          </div>
                          <span className="text-[10px] text-slate-500">
                            Decided: {d.decidedAt ? new Date(d.decidedAt).toLocaleString() : "Yes"}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Dispute Arbitration Decision Modal */}
        {selectedDispute && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-indigo-400" />
                  <span>Arbitrate Dispute: {selectedDispute.ticket?.code}</span>
                </h3>
                <button
                  onClick={() => setSelectedDispute(null)}
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {decisionError && (
                <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  {decisionError}
                </div>
              )}

              <div className="mb-4 p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs space-y-1.5">
                <div>Type: <strong className="text-white">{selectedDispute.type.replace(/_/g, " ")}</strong></div>
                <div>Claim: <span className="text-slate-300">{selectedDispute.reason}</span></div>
                <div className="pt-1 text-[11px] text-amber-300">
                  {decisionType === "UPHELD" && selectedDispute.type === "CODE_REFUSED" && (
                    <span>Upholding this dispute verifies the staff's repair evidence and marks the ticket CLOSED with reason WARDEN_DECISION.</span>
                  )}
                  {decisionType === "UPHELD" && selectedDispute.type === "LOCKED_CLAIM_FALSE" && (
                    <span>Upholding this dispute confirms the student was present. The ticket will be reassigned with a 60-minute priority boost.</span>
                  )}
                  {decisionType === "REJECTED" && (
                    <span>Rejecting will dismiss the dispute and resume or retain the ticket's prior workflow.</span>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Decision Action
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setDecisionType("UPHELD")}
                      className={`py-2 rounded-xl text-xs font-bold transition border ${
                        decisionType === "UPHELD"
                          ? "bg-emerald-600 border-emerald-500 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      Uphold Dispute
                    </button>
                    <button
                      type="button"
                      onClick={() => setDecisionType("REJECTED")}
                      className={`py-2 rounded-xl text-xs font-bold transition border ${
                        decisionType === "REJECTED"
                          ? "bg-rose-600 border-rose-500 text-white"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      Reject Dispute
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Decision Note (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={decisionNote}
                    onChange={(e) => setDecisionNote(e.target.value)}
                    placeholder="Provide rationale for this arbitration decision..."
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500"
                  />
                </div>

                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    onClick={() => setSelectedDispute(null)}
                    className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() =>
                      decideMutation.mutate({
                        disputeId: selectedDispute.id,
                        payload: { decision: decisionType, note: decisionNote.trim() },
                      })
                    }
                    disabled={decideMutation.isPending}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Confirm Arbitration Decision
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
