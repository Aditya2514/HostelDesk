import React, { useState } from "react";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import {
  Settings,
  Clock,
  RotateCcw,
  FastForward,
  Building,
  Users,
  CheckCircle,
  AlertCircle,
  Calendar,
} from "lucide-react";

export const AdminDashboard: React.FC = () => {
  const { user } = useAuth();
  const [offsetMinutes, setOffsetMinutes] = useState<number>(0);
  const [currentClock, setCurrentClock] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

  const handleAdvance = async (minutes: number) => {
    setIsUpdating(true);
    setStatusMsg(null);
    try {
      const res = await api.post<{ currentClock: string; offsetMinutes: number }>(
        "/api/admin/demo/advance-time",
        { minutes }
      );
      setOffsetMinutes(res.offsetMinutes);
      setCurrentClock(res.currentClock);
      setStatusMsg({
        type: "success",
        text: `Advanced clock by ${minutes} min! Total demo offset: +${res.offsetMinutes} min.`,
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: err?.message || "Failed to advance clock",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleReset = async () => {
    setIsUpdating(true);
    setStatusMsg(null);
    try {
      const res = await api.post<{ currentClock: string; offsetMinutes: number }>(
        "/api/admin/demo/reset-time"
      );
      setOffsetMinutes(res.offsetMinutes);
      setCurrentClock(res.currentClock);
      setStatusMsg({
        type: "success",
        text: "Clock offset reset to real time (0 minutes).",
      });
    } catch (err: any) {
      setStatusMsg({
        type: "error",
        text: err?.message || "Failed to reset clock",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Admin Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-rose-950/30 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-rose-400 tracking-wider uppercase mb-1 block">
                Hostel Administration Console
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                System Administrator
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                Manage hostel blocks, occupancy, staff shifts, categories, and test time simulations.
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-xs">
              <Settings className="w-4 h-4 text-rose-400" />
              <span className="text-slate-300 font-medium">Logged in: {user?.email}</span>
            </div>
          </div>
        </div>

        {/* Demo Time Travel Controls (Section 4 Cross-cutting rule 1) */}
        {isDemoMode && (
          <div className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-6 mb-8 relative overflow-hidden shadow-xl shadow-indigo-500/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center space-x-2">
                  <Clock className="w-5 h-5 text-indigo-400" />
                  <h3 className="text-base font-bold text-white">Demo Clock Controller (Time Travel)</h3>
                  <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold">
                    ADMIN ONLY
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Injectable clock service allows advancing time in demo mode to showcase SLA escalations and auto-closure without waiting hours.
                </p>
              </div>

              <div className="flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-700 text-xs">
                <span className="text-slate-400">Current Offset:</span>
                <span className="font-mono font-bold text-indigo-400">+{offsetMinutes} min</span>
              </div>
            </div>

            {statusMsg && (
              <div
                className={`mb-4 p-3 rounded-xl text-xs flex items-center space-x-2 ${
                  statusMsg.type === "success"
                    ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                }`}
              >
                {statusMsg.type === "success" ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                )}
                <span>{statusMsg.text}</span>
              </div>
            )}

            {currentClock && (
              <div className="mb-4 text-xs font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
                Server Clock (UTC): <span className="text-slate-200">{currentClock}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleAdvance(15)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition disabled:opacity-50"
              >
                <FastForward className="w-3.5 h-3.5 text-indigo-400" />
                <span>+15 min</span>
              </button>

              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleAdvance(60)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition disabled:opacity-50"
              >
                <FastForward className="w-3.5 h-3.5 text-indigo-400" />
                <span>+1 Hour</span>
              </button>

              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleAdvance(240)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition disabled:opacity-50"
              >
                <FastForward className="w-3.5 h-3.5 text-amber-400" />
                <span>+4 Hours (SLA Breach)</span>
              </button>

              <button
                type="button"
                disabled={isUpdating}
                onClick={() => handleAdvance(1440)}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition disabled:opacity-50"
              >
                <FastForward className="w-3.5 h-3.5 text-rose-400" />
                <span>+24 Hours (Escalate to Chief)</span>
              </button>

              <button
                type="button"
                disabled={isUpdating}
                onClick={handleReset}
                className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 border border-rose-500/20 transition disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset to Real Clock</span>
              </button>
            </div>
          </div>
        )}

        {/* Phase 1 Shell Empty State */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 sm:p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400 mx-auto mb-5 shadow-lg shadow-rose-500/10">
            <Building className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Hostel Office Management</h2>
          <p className="text-slate-400 max-w-lg mx-auto text-sm leading-relaxed mb-6">
            In Phase 6, you will manage campus configuration: bulk CSV import for semester student room occupancy, staff shift scheduling rotas, category default SLAs, and room maintenance history.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Users className="w-5 h-5 text-indigo-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Occupancy Import (Phase 6)</div>
              <div className="text-xs text-slate-400 mt-1">Upload CSV of student room assignments with valid dates</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Calendar className="w-5 h-5 text-amber-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Staff Shift Rota</div>
              <div className="text-xs text-slate-400 mt-1">Configure morning/evening shift windows per trade</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Settings className="w-5 h-5 text-rose-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Category SLA Tuning</div>
              <div className="text-xs text-slate-400 mt-1">Edit default durations and urgent SLA response limits</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
