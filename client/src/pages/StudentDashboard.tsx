import React from "react";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { PlusCircle, Ticket, Clock, CheckCircle2, Home } from "lucide-react";

export const StudentDashboard: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome & Room Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8 relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 relative z-10">
            <div>
              <span className="text-xs font-semibold text-indigo-400 tracking-wider uppercase mb-1 block">
                Student Resident Portal
              </span>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Welcome back, {user?.name.split(" ")[0]}!
              </h1>
              <p className="text-slate-400 text-sm mt-1 flex items-center space-x-2">
                <Home className="w-4 h-4 text-indigo-400" />
                <span>
                  Occupant of{" "}
                  <strong className="text-slate-200">
                    {user?.currentRoom?.displayName || "Assigned Room"}
                  </strong>{" "}
                  (Floor {user?.currentRoom?.floor || "3"})
                </span>
              </p>
            </div>

            <button
              disabled
              title="Ticket creation unlocks in Phase 2"
              className="inline-flex items-center justify-center space-x-2 px-5 py-3 rounded-xl bg-indigo-600/50 text-indigo-200 cursor-not-allowed font-semibold text-sm border border-indigo-500/20"
            >
              <PlusCircle className="w-4 h-4" />
              <span>Raise Complaint (Phase 2)</span>
            </button>
          </div>
        </div>

        {/* Phase 1 Shell Empty State */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 sm:p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 mx-auto mb-5 shadow-lg shadow-indigo-500/10">
            <Ticket className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Student Ticket Queue</h2>
          <p className="text-slate-400 max-w-lg mx-auto text-sm leading-relaxed mb-6">
            Your active and past complaints will appear here. In Phase 2, you'll be able to raise room complaints (shared with roommates) or common-area issues, see live schedule simulations with predicted arrival times (p50–p80), and confirm fixes via your 4-digit completion code.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Clock className="w-5 h-5 text-indigo-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Transparent ETAs</div>
              <div className="text-xs text-slate-400 mt-1">Simulated finish ranges based on staff queues</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Home className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Room-Centric Model</div>
              <div className="text-xs text-slate-400 mt-1">Both you and your roommate can view and confirm</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <CheckCircle2 className="w-5 h-5 text-purple-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">4-Digit Verification</div>
              <div className="text-xs text-slate-400 mt-1">Staff cannot close without your completion code</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
