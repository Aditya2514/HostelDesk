import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { StatusBadge, PriorityBadge } from "../components/StatusBadge";
import {
  Wrench,
  Clock,
  MapPin,
  Play,
  CheckCircle2,
  AlertCircle,
  Calendar,
  ChevronRight,
} from "lucide-react";

export const StaffDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  // Fetch assigned tickets
  const { data: ticketsData, isLoading } = useQuery({
    queryKey: ["staff-tickets"],
    queryFn: () => api.get<{ tickets: any[] }>("/api/tickets?limit=50"),
  });

  const tickets = ticketsData?.tickets ?? [];

  // Start work mutation
  const startWorkMutation = useMutation({
    mutationFn: (ticketId: string) => api.post(`/api/tickets/${ticketId}/start`),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ["staff-tickets"] });
    },
    onError: (err: any) => {
      setActionError(err.message || "Failed to start work");
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Staff Trade & Shift Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-amber-950/30 to-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-amber-400 tracking-wider uppercase mb-1 block">
                Field Technician Console
              </span>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                {user?.name}
              </h1>
              <p className="text-slate-400 text-sm mt-1 flex items-center space-x-2">
                <Wrench className="w-4 h-4 text-amber-400" />
                <span>
                  Trade: <strong className="text-amber-300">{user?.trade}</strong> · Queue: {tickets.length} Tasks
                </span>
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-xs">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300 font-medium">Standard Shift (9:00 – 18:00)</span>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Assigned Job Queue */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">Your Assigned Tasks</h2>
          <span className="text-xs text-slate-400">Ordered by Priority then Age</span>
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-4 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center">
            <CheckCircle2 className="w-12 h-12 text-slate-600 mx-auto mb-3" />
            <h3 className="text-base font-bold text-white mb-1">Queue is Clear!</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              You have no pending jobs assigned to your queue at this moment. New issues in {user?.trade} will automatically appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {tickets.map((ticket) => (
              <div
                key={ticket.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 transition shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div
                  onClick={() => navigate(`/tickets/${ticket.id}`)}
                  className="flex-1 cursor-pointer"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-mono text-xs font-bold text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                      {ticket.code}
                    </span>
                    <StatusBadge status={ticket.status} />
                    <PriorityBadge priority={ticket.priority} />
                    <span className="text-xs text-slate-400">· {ticket.category?.name}</span>
                  </div>

                  <h3 className="text-base font-bold text-white mb-1.5 hover:text-amber-400 transition">
                    {ticket.title}
                  </h3>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center space-x-1">
                      <MapPin className="w-3.5 h-3.5 text-indigo-400" />
                      <strong className="text-slate-300">
                        {ticket.locationType === "ROOM"
                          ? `${ticket.block?.name}-${ticket.room?.number}`
                          : `Floor ${ticket.floor} (${ticket.commonSpot})`}
                      </strong>
                    </span>

                    <span className="flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-rose-400" />
                      <span>Due: {new Date(ticket.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>

                    <span className="flex items-center space-x-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{new Date(ticket.createdAt).toLocaleDateString()}</span>
                    </span>
                  </div>
                </div>

                {/* Mobile-friendly Action Buttons */}
                <div className="flex items-center space-x-2 pt-3 sm:pt-0 border-t sm:border-t-0 border-slate-800">
                  {ticket.status === "ASSIGNED" && (
                    <button
                      onClick={() => startWorkMutation.mutate(ticket.id)}
                      disabled={startWorkMutation.isPending}
                      className="flex-1 sm:flex-initial inline-flex items-center justify-center space-x-1.5 px-4 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-amber-600/20 transition disabled:opacity-50"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Start Work</span>
                    </button>
                  )}

                  <button
                    onClick={() => navigate(`/tickets/${ticket.id}`)}
                    className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition"
                    title="View Ticket Details"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
