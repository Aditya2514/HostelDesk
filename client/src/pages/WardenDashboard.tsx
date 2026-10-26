import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

export const WardenDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isChief = user?.role === "CHIEF_WARDEN" || user?.role === "ADMIN";

  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [priorityFilter, setPriorityFilter] = useState<string>("");
  const [floorFilter, setFloorFilter] = useState<string>("");
  const [search, setSearch] = useState<string>("");

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
                  ? "Campus-wide complaint oversight, trade reassignments, and second-level escalations"
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
                className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300"
              >
                <option value="">All Statuses</option>
                <option value="RAISED">Raised (Unassigned)</option>
                <option value="ASSIGNED">Assigned</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="AWAITING_ACCESS">Awaiting Access</option>
                <option value="ON_HOLD">On Hold</option>
                <option value="RESOLVED">Resolved</option>
                <option value="CLOSED">Closed</option>
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
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300"
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
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl text-xs text-slate-300"
            >
              <option value="">All Floors</option>
              <option value="1">Floor 1</option>
              <option value="2">Floor 2</option>
              <option value="3">Floor 3</option>
              <option value="4">Floor 4</option>
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
              className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold"
            >
              Reset Filters
            </button>
          )}
        </div>

        {/* Tickets Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
          {isLoading ? (
            <div className="py-20 flex justify-center">
              <div className="w-8 h-8 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="py-16 text-center text-xs text-slate-500">
              No tickets matching the selected filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-800/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Code</th>
                    <th className="py-3 px-4">Issue Title</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Location</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Assignee</th>
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
                      <td className="py-3 px-4 font-mono font-bold text-slate-300 whitespace-nowrap">
                        {t.code}
                      </td>
                      <td className="py-3 px-4 font-semibold text-white max-w-xs truncate">
                        {t.title}
                      </td>
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {t.category?.name}
                      </td>
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        <span className="flex items-center space-x-1">
                          <MapPin className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
                          <span>
                            {t.locationType === "ROOM"
                              ? `${t.block?.name}-${t.room?.number}`
                              : `Fl ${t.floor} (${t.commonSpot})`}
                          </span>
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <PriorityBadge priority={t.priority} />
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                        {t.assignedTo ? `${t.assignedTo.name} (${t.assignedTo.trade})` : (
                          <span className="text-rose-400 font-semibold">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/tickets/${t.id}`);
                          }}
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition"
                          title="Open ticket details"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination Controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
              <span>
                Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} tickets)
              </span>
              <div className="flex items-center space-x-2">
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => setPage(pagination.page - 1)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => setPage(pagination.page + 1)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 transition"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};
