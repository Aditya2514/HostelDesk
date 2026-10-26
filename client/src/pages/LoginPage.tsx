import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, getDashboardRoute } from "../context/AuthContext";
import { Building2, Lock, Mail, ArrowRight, Sparkles, AlertCircle } from "lucide-react";

export const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const user = await login(email, password);
      const target = getDashboardRoute(user.role);
      navigate(target, { replace: true });
    } catch (err: any) {
      setError(err?.message || "Invalid email or password");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDemoFill = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword("Demo@1234");
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-indigo-600/15 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-500 flex items-center justify-center shadow-xl shadow-indigo-500/30">
            <Building2 className="w-8 h-8 text-white" />
          </div>
        </div>
        <h2 className="mt-4 text-center text-3xl font-extrabold text-white tracking-tight">
          HostelDesk
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Accountable room complaints & facility SLA tracking
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-slate-900/90 backdrop-blur-xl py-8 px-6 shadow-2xl rounded-2xl border border-slate-800 sm:px-10">
          {error && (
            <div className="mb-6 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm p-3.5 rounded-xl flex items-start space-x-2.5">
              <AlertCircle className="w-5 h-5 flex-shrink-0 text-rose-400 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Campus Email
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Mail className="h-5 h-5" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. student1@hosteldesk.dev"
                  className="block w-full pl-11 pr-4 py-3 bg-slate-800/80 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Password
              </label>
              <div className="relative rounded-xl shadow-sm">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-500">
                  <Lock className="h-5 h-5" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-11 pr-4 py-3 bg-slate-800/80 border border-slate-700/80 rounded-xl text-white placeholder-slate-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center py-3.5 px-4 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-lg shadow-indigo-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="ml-2 w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Demo Accounts Panel */}
          {isDemoMode && (
            <div className="mt-8 pt-6 border-t border-slate-800/80">
              <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-3">
                <Sparkles className="w-4 h-4" />
                <span>Demo Accounts (Password: Demo@1234)</span>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                Click any role to auto-fill credentials:
              </p>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => handleDemoFill("student1@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-emerald-500/40 transition"
                >
                  <div className="font-semibold text-emerald-400">Student 1</div>
                  <div className="text-[11px] text-slate-400 truncate">Room A-301</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("student2@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-emerald-500/40 transition"
                >
                  <div className="font-semibold text-emerald-400">Student 2</div>
                  <div className="text-[11px] text-slate-400 truncate">Roommate</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("plumber1@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-amber-500/40 transition"
                >
                  <div className="font-semibold text-amber-400">Plumber</div>
                  <div className="text-[11px] text-slate-400 truncate">Staff Queue</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("electrician1@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-amber-500/40 transition"
                >
                  <div className="font-semibold text-amber-400">Electrician</div>
                  <div className="text-[11px] text-slate-400 truncate">Staff Queue</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("warden.a@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-indigo-500/40 transition"
                >
                  <div className="font-semibold text-indigo-400">Block A Warden</div>
                  <div className="text-[11px] text-slate-400 truncate">Block Escalations</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("chief@hosteldesk.dev")}
                  className="text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-purple-500/40 transition"
                >
                  <div className="font-semibold text-purple-400">Chief Warden</div>
                  <div className="text-[11px] text-slate-400 truncate">All Blocks</div>
                </button>

                <button
                  type="button"
                  onClick={() => handleDemoFill("admin@hosteldesk.dev")}
                  className="col-span-2 text-left p-2.5 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-rose-500/40 transition"
                >
                  <div className="font-semibold text-rose-400">Hostel Admin</div>
                  <div className="text-[11px] text-slate-400">System configuration, time offset demo, users</div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
