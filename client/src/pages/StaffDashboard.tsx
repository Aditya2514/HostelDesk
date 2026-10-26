import React from "react";
import { Header } from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { Wrench, Camera, ShieldCheck, Clock, MapPin } from "lucide-react";

export const StaffDashboard: React.FC = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <Header />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Staff Trade & Shift Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-amber-950/30 to-slate-900 border border-slate-800 rounded-2xl p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-xs font-semibold text-amber-400 tracking-wider uppercase mb-1 block">
                Staff Field Console
              </span>
              <h1 className="text-2xl font-extrabold text-white tracking-tight">
                {user?.name}
              </h1>
              <p className="text-slate-400 text-sm mt-1 flex items-center space-x-2">
                <Wrench className="w-4 h-4 text-amber-400" />
                <span>
                  Trade: <strong className="text-amber-300">{user?.trade}</strong> · Active Shift (9:00 - 18:00)
                </span>
              </p>
            </div>

            <div className="flex items-center space-x-2 bg-slate-800/80 px-4 py-2.5 rounded-xl border border-slate-700/60 text-xs">
              <Clock className="w-4 h-4 text-emerald-400" />
              <span className="text-slate-300 font-medium">Status: Ready for Jobs</span>
            </div>
          </div>
        </div>

        {/* Phase 1 Shell Empty State */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-8 sm:p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto mb-5 shadow-lg shadow-amber-500/10">
            <Wrench className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Staff Job Queue</h2>
          <p className="text-slate-400 max-w-lg mx-auto text-sm leading-relaxed mb-6">
            Your assigned jobs for your trade ({user?.trade}) will appear here, ordered by priority (URGENT &gt; NORMAL &gt; LOW) and creation time. In Phase 2 &amp; 4, you will tap "Start work", report locked rooms with a required door photo, and resolve tasks by entering the student's 4-digit code.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto text-left">
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <MapPin className="w-5 h-5 text-amber-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Fast Navigation</div>
              <div className="text-xs text-slate-400 mt-1">Exact room or common spot with issue description</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <Camera className="w-5 h-5 text-indigo-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Proof of Completion</div>
              <div className="text-xs text-slate-400 mt-1">Required after-photo uploaded directly to server</div>
            </div>
            <div className="p-4 rounded-xl bg-slate-800/40 border border-slate-800">
              <ShieldCheck className="w-5 h-5 text-emerald-400 mb-2" />
              <div className="text-xs font-semibold text-slate-300">Verified Resolution</div>
              <div className="text-xs text-slate-400 mt-1">Student 4-digit code confirms fix at location</div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
