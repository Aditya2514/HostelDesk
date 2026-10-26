import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import {
  TrendingDown,
  AlertTriangle,
  Clock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  RotateCw,
  Sparkles,
  MapPin,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { formatFriendlyIst } from "../lib/formatTime";

interface AnalyticsViewProps {
  onSelectStaff?: (staffId: string) => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ onSelectStaff }) => {
  const { user } = useAuth();
  const isChiefOrAdmin = user?.role === "CHIEF_WARDEN" || user?.role === "ADMIN";

  const [days, setDays] = useState<number>(30);
  const [selectedBlockId, setSelectedBlockId] = useState<string>("");
  const [sortField, setSortField] = useState<"score" | "resolved" | "sla" | "locked">("score");
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  // Query overview
  const {
    data: overview,
    isLoading: isOverviewLoading,
    error: overviewError,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ["analytics-overview", days, selectedBlockId],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (selectedBlockId) p.set("blockId", selectedBlockId);
      return api.get<any>(`/api/analytics/overview?${p.toString()}`);
    },
  });

  // Query staff reliability
  const {
    data: staffData,
    isLoading: isStaffLoading,
    error: staffError,
    refetch: refetchStaff,
  } = useQuery({
    queryKey: ["analytics-staff", days, selectedBlockId],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (selectedBlockId) p.set("blockId", selectedBlockId);
      return api.get<any>(`/api/analytics/staff?${p.toString()}`);
    },
  });

  // Query prediction trend
  const {
    data: trendData,
    isLoading: isTrendLoading,
    error: trendError,
    refetch: refetchTrend,
  } = useQuery({
    queryKey: ["analytics-prediction-trend", days, selectedBlockId],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (selectedBlockId) p.set("blockId", selectedBlockId);
      return api.get<any>(`/api/analytics/prediction-trend?${p.toString()}`);
    },
  });

  // Query repeat rooms
  const {
    data: repeatRoomsData,
    isLoading: isRepeatLoading,
    error: repeatError,
    refetch: refetchRepeat,
  } = useQuery({
    queryKey: ["analytics-repeat-rooms", days, selectedBlockId],
    queryFn: () => {
      const p = new URLSearchParams({ days: String(days) });
      if (selectedBlockId) p.set("blockId", selectedBlockId);
      return api.get<any>(`/api/analytics/repeat-rooms?${p.toString()}`);
    },
  });

  const isLoading = isOverviewLoading || isStaffLoading || isTrendLoading || isRepeatLoading;
  const hasError = overviewError || staffError || trendError || repeatError;

  const handleRefreshAll = () => {
    refetchOverview();
    refetchStaff();
    refetchTrend();
    refetchRepeat();
  };

  // Sort staff list
  const staffList = staffData?.staff ? [...staffData.staff] : [];
  staffList.sort((a, b) => {
    let valA = 0;
    let valB = 0;
    if (sortField === "score") {
      valA = a.reliabilityScore ?? -1;
      valB = b.reliabilityScore ?? -1;
    } else if (sortField === "resolved") {
      valA = a.resolvedCount;
      valB = b.resolvedCount;
    } else if (sortField === "sla") {
      valA = a.slaMetRate;
      valB = b.slaMetRate;
    } else if (sortField === "locked") {
      valA = a.lockedVisitRate;
      valB = b.lockedVisitRate;
    }
    return sortAsc ? valA - valB : valB - valA;
  });

  const handleSort = (field: "score" | "resolved" | "sla" | "locked") => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 rounded-xl p-4 shadow-sm backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Time Window:</span>
          {[7, 14, 30, 60, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                days === d
                  ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/20"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
              }`}
            >
              {d} Days
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Block filter for Chief Warden and Admin */}
          {isChiefOrAdmin && overview?.blocks && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Block:</span>
              <select
                value={selectedBlockId}
                onChange={(e) => setSelectedBlockId(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="">All Blocks</option>
                {overview.blocks.map((b: any) => (
                  <option key={b.id} value={b.id}>
                    Block {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleRefreshAll}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
            title="Refresh analytics data"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {hasError && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>Failed to load some analytics metrics. Please retry or adjust filters.</span>
          </div>
          <button
            onClick={handleRefreshAll}
            className="px-3 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 text-xs font-medium rounded-lg"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Open Tickets */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Open Tickets</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
              Live
            </span>
          </div>
          <div className="text-3xl font-bold text-white mb-1">
            {overview?.openTicketsCount ?? (isOverviewLoading ? "..." : 0)}
          </div>
          <div className="text-xs text-slate-400">
            {overview?.openTicketsByStatus
              ? `${overview.openTicketsByStatus.IN_PROGRESS || 0} in progress, ${overview.openTicketsByStatus.AWAITING_ACCESS || 0} locked`
              : "Active tickets needing resolution"}
          </div>
        </div>

        {/* KPI 2: Deadline Breach Rate */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Deadline Breach Rate</span>
            <AlertTriangle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-bold text-amber-400 mb-1">
            {overview?.deadlineBreachPercentage !== undefined
              ? `${overview.deadlineBreachPercentage}%`
              : isOverviewLoading
              ? "..."
              : "0%"}
          </div>
          <div className="text-xs text-slate-400">
            {overview?.breachStats
              ? `${overview.breachStats.totalBreached} breached of ${overview.breachStats.totalEvaluated} tickets evaluated`
              : "Closed past due + open overdue"}
          </div>
        </div>

        {/* KPI 3: Avg Resolution Time */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Avg Resolution Time</span>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-400 mb-1">
            {overview?.avgResolutionTimeByCategory?.length
              ? `${Math.round(
                  overview.avgResolutionTimeByCategory.reduce((acc: number, c: any) => acc + c.avgHours, 0) /
                    overview.avgResolutionTimeByCategory.length
                )}h`
              : isOverviewLoading
              ? "..."
              : "N/A"}
          </div>
          <div className="text-xs text-slate-400">
            Active work time (excludes paused minutes)
          </div>
        </div>

        {/* KPI 4: Escalations & Synthetic share */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Escalations</span>
            {overview?.syntheticShare > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-medium">
                <Sparkles className="w-3 h-3" />
                {Math.round(overview.syntheticShare * 100)}% Synthetic
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-3xl font-bold text-rose-400">
              {overview?.escalationsByLevel
                ? (overview.escalationsByLevel[1] || 0) + (overview.escalationsByLevel[2] || 0)
                : isOverviewLoading
                ? "..."
                : 0}
            </span>
            <span className="text-xs text-slate-400">
              (L1: {overview?.escalationsByLevel?.[1] || 0}, L2: {overview?.escalationsByLevel?.[2] || 0})
            </span>
          </div>
          <div className="text-xs text-slate-400">Tickets requiring warden intervention</div>
        </div>
      </div>

      {/* Prediction Accuracy Trend (Recharts LineChart) */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 className="text-base font-semibold text-white flex items-center gap-2">
              <TrendingDown className="w-5 h-5 text-indigo-400" />
              <span>Weekly Prediction Error Trend</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Average absolute error in minutes between predicted P50 completion time and actual resolved time
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-xs font-medium">
              <Sparkles className="w-3 h-3" />
              Includes synthetic history data
            </span>
          </div>
        </div>

        {isTrendLoading ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
            <p className="text-xs">Computing weekly trend error...</p>
          </div>
        ) : !trendData?.weeks || trendData.weeks.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-slate-400">
            <HelpCircle className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">No prediction history recorded in this time window</p>
          </div>
        ) : (
          <div className="h-72 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData.weeks} margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.5} />
                <XAxis
                  dataKey="weekLabel"
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  dy={10}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={12}
                  tickLine={false}
                  unit="m"
                  domain={[0, "auto"]}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-slate-900 border border-slate-700 p-3 rounded-lg shadow-xl text-xs">
                          <p className="font-semibold text-white mb-1">{label}</p>
                          <p className="text-indigo-400">
                            Avg Error: <span className="font-mono font-bold">{data.avgErrorMinutes} min</span>
                          </p>
                          <p className="text-slate-400 mt-1">
                            Completed Tickets: <span className="font-mono">{data.ticketCount}</span>
                          </p>
                          {data.syntheticCount > 0 && (
                            <p className="text-slate-500 text-[10px] mt-0.5">
                              ({data.syntheticCount} synthetic tickets)
                            </p>
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="avgErrorMinutes"
                  name="Avg Error (min)"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={{ fill: "#6366f1", r: 4 }}
                  activeDot={{ r: 6, fill: "#818cf8" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Staff Reliability Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-white">Staff Reliability & Performance</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Composite reliability score: 35% code verification, 30% SLA met, 20% reopen-free, 15% prediction accuracy
              </p>
            </div>
            <span className="text-xs text-slate-400 italic">Click a staff row to view their shift schedule</span>
          </div>
        </div>

        {isStaffLoading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-400">
            <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-3" />
            <p className="text-xs">Evaluating staff reliability metrics...</p>
          </div>
        ) : staffList.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-sm">No active staff members found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Staff Member</th>
                  <th className="py-3 px-4 font-semibold">Trade</th>
                  <th
                    className="py-3 px-4 font-semibold cursor-pointer hover:text-white"
                    onClick={() => handleSort("resolved")}
                  >
                    <div className="flex items-center gap-1">
                      <span>Jobs Resolved</span>
                      {sortField === "resolved" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th
                    className="py-3 px-4 font-semibold cursor-pointer hover:text-white"
                    onClick={() => handleSort("score")}
                  >
                    <div className="flex items-center gap-1">
                      <span>Reliability Score</span>
                      {sortField === "score" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="py-3 px-4 font-semibold">Code Verified</th>
                  <th
                    className="py-3 px-4 font-semibold cursor-pointer hover:text-white"
                    onClick={() => handleSort("sla")}
                  >
                    <div className="flex items-center gap-1">
                      <span>SLA Met</span>
                      {sortField === "sla" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                  <th className="py-3 px-4 font-semibold">Reopen Rate</th>
                  <th className="py-3 px-4 font-semibold">Median Error</th>
                  <th
                    className="py-3 px-4 font-semibold cursor-pointer hover:text-white"
                    onClick={() => handleSort("locked")}
                  >
                    <div className="flex items-center gap-1">
                      <span>Locked Visits</span>
                      {sortField === "locked" && (sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {staffList.map((s: any) => (
                  <tr
                    key={s.staffId}
                    onClick={() => onSelectStaff && onSelectStaff(s.staffId)}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4 font-medium text-white group-hover:text-indigo-300">
                      <div>{s.name}</div>
                      <div className="text-[11px] text-slate-400 font-normal">{s.email}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        {s.trade}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                      {s.resolvedCount}
                    </td>
                    <td className="py-3.5 px-4">
                      {s.reliabilityScore !== null ? (
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-mono font-bold ${
                              s.reliabilityScore >= 80
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : s.reliabilityScore >= 60
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {s.reliabilityScore}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">
                          Insufficient Data ({s.resolvedCount}/5)
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {s.codeVerifiedPercentage}%
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {s.slaMetPercentage}%
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {s.reopenPercentage}%
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-300">
                      {s.medianPredictionErrorMinutes !== null ? `${s.medianPredictionErrorMinutes}m` : "N/A"}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-300">
                          {s.totalLockedVisits} ({Math.round(s.lockedVisitRate * 100)}%)
                        </span>
                        {s.isLockedVisitOutlier && (
                          <span
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-medium"
                            title="Locked-visit rate is > 2x the median for this trade"
                          >
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                            Outlier
                          </span>
                        )}
                        {s.upheldFalseLockDisputes > 0 && (
                          <span
                            className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 text-[10px] font-medium"
                            title={`${s.upheldFalseLockDisputes} false locked-room dispute(s) upheld by warden`}
                          >
                            {s.upheldFalseLockDisputes} false claim
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Repeat-Issue Rooms Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <MapPin className="w-4 h-4 text-rose-400" />
                <span>Repeat-Issue Rooms (≥ 3 tickets of same trade in window)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Pinpoints chronic infrastructure flaws requiring root-cause repair or renovation
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-mono">
              {repeatRoomsData?.repeatRooms?.length || 0} Rooms Flagged
            </span>
          </div>
        </div>

        {isRepeatLoading ? (
          <div className="p-8 text-center text-slate-400">
            <div className="w-6 h-6 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs">Scanning room history...</p>
          </div>
        ) : !repeatRoomsData?.repeatRooms || repeatRoomsData.repeatRooms.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
            <p className="text-sm text-slate-300 font-medium">No repeat-issue rooms detected</p>
            <p className="text-xs text-slate-400 mt-0.5">
              No rooms had 3 or more complaints of the same trade within the selected {days}-day window.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4 font-semibold">Room</th>
                  <th className="py-3 px-4 font-semibold">Block & Floor</th>
                  <th className="py-3 px-4 font-semibold">Trade</th>
                  <th className="py-3 px-4 font-semibold">Complaints Count</th>
                  <th className="py-3 px-4 font-semibold">Latest Incident</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {repeatRoomsData.repeatRooms.map((room: any) => (
                  <tr key={`${room.roomId}-${room.trade}`} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">
                      Room {room.roomNumber}
                    </td>
                    <td className="py-3 px-4 text-slate-300">
                      Block {room.blockName}, Floor {room.floor}
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                        {room.trade}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-rose-500/15 text-rose-400 border border-rose-500/20">
                        {room.count} complaints
                      </span>
                    </td>
                    <td className="py-3 px-4 text-slate-400 font-mono">
                      {formatFriendlyIst(room.latestTicketDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
