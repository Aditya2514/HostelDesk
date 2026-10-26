import React from "react";
import { Link } from "react-router-dom";
import { useAuth, getDashboardRoute } from "../context/AuthContext";
import { HelpCircle, ArrowLeft } from "lucide-react";

export const NotFoundPage: React.FC = () => {
  const { user } = useAuth();
  const homeRoute = getDashboardRoute(user?.role);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center px-4 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 mb-6">
        <HelpCircle className="w-8 h-8" />
      </div>
      <h1 className="text-3xl font-extrabold text-white tracking-tight mb-2">
        404 — Page Not Found
      </h1>
      <p className="text-slate-400 max-w-md text-sm mb-8">
        The requested path does not exist on HostelDesk.
      </p>
      <Link
        to={homeRoute}
        className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition shadow-lg shadow-indigo-600/25"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Return to Dashboard</span>
      </Link>
    </div>
  );
};
