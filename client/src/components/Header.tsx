import React from "react";
import { useAuth } from "../context/AuthContext";
import { LogOut, Bell, Building2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getRoleBadge = () => {
    switch (user?.role) {
      case "STUDENT":
        return <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">Student</span>;
      case "STAFF":
        return <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">Staff · {user.trade}</span>;
      case "WARDEN":
        return <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">Warden · Block {user.blockName || "Assigned"}</span>;
      case "CHIEF_WARDEN":
        return <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">Chief Warden</span>;
      case "ADMIN":
        return <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">Administrator</span>;
      default:
        return null;
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg text-white tracking-tight">HostelDesk</span>
              <span className="bg-slate-800 text-slate-400 text-[10px] font-mono px-1.5 py-0.5 rounded">v1.0</span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Campus Complaint & Facility SLA Engine</p>
          </div>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          {/* User metadata */}
          <div className="hidden md:flex flex-col items-end">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold text-slate-200">{user?.name}</span>
              {getRoleBadge()}
            </div>
            <div className="flex items-center space-x-2 text-xs text-slate-400 mt-0.5">
              {user?.currentRoom && (
                <span className="text-slate-300 font-mono bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700/60">
                  {user.currentRoom.displayName}
                </span>
              )}
              <span>{user?.email}</span>
            </div>
          </div>

          {/* Notification bell placeholder */}
          <button
            title="Notifications (in-app)"
            className="relative p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition"
          >
            <Bell className="w-5 h-5" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-500 ring-2 ring-slate-900"></span>
          </button>

          {/* Logout button */}
          <button
            onClick={handleLogout}
            title="Log out"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
