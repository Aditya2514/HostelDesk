import React from "react";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { Shield, AlertTriangle, BarChart3, CheckSquare } from "lucide-react";

export const WardenDashboard: React.FC = () => {
  const { user } = useAuth();
  const isChief = user?.role === "CHIEF_WARDEN";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Warden Console Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase mb-1 block">
                {isChief ? "Hostel Campus Oversight" : `Block ${user?.blockName || "A"} Console`}
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                {isChief ? "Chief Warden Dashboard" : `Warden Dashboard — Block ${user?.blockName}`}
              </h1>
              <p className="text-slate-400 text-sm mt-1">
                {isChief
                  ? "Campus-wide second-level escalations, trade analytics, and cross-block oversight"
                  : `First-level SLA escalations, reprioritisation, and dispute arbitration for Block ${user?.blockName}`}
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-xs">
              <Shield className="w-4 h-4 text-indigo-400" />
              <span className="text-slate-300 font-medium">
                Scope: {isChief ? "All Blocks (A, B, C)" : `Block ${user?.blockName}`}
              </span>
            </div>
          </div>
        </div>

        {/* Phase 1 Shell Empty State */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 sm:p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto mb-5 shadow-lg shadow-indigo-500/10">
            <Shield className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Warden Oversight & Escalation Console</h2>
          <p className="text-slate-400 max-w-lg mx-auto text-sm leading-relaxed mb-6">
            In Phase 2 & 5, live tickets for {isChief ? "all hostel blocks" : `Block ${user?.blockName}`} will stream into this view. You will manage SLA breach alerts (Level 1 block escalation, Level 2 chief escalation), adjudicate locked-room false claims, and adjust priorities when urgent student needs arise.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <AlertTriangle className="w-5 h-5 text-rose-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">SLA Breach Escalations</div>
              <div className="text-xs text-slate-400 mt-1">Automatic escalation when clock exceeds category SLA</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <CheckSquare className="w-5 h-5 text-amber-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Dispute Arbitration</div>
              <div className="text-xs text-slate-400 mt-1">Review door photos and fix disputes within 48h window</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <BarChart3 className="w-5 h-5 text-indigo-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Block Analytics (Phase 6)</div>
              <div className="text-xs text-slate-400 mt-1">Repeat-issue rooms, staff reliability, prediction accuracy</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
