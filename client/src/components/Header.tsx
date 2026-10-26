import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { LogOut, Bell, Building2, Check, ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export const Header: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Poll notifications every 30 seconds (stateless polling, no websockets)
  const { data: notifData, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () =>
      api.get<{
        notifications: Array<{
          id: string;
          ticketId?: string;
          type: string;
          message: string;
          readAt?: string | null;
          createdAt: string;
        }>;
        unreadCount: number;
      }>("/api/notifications"),
    refetchInterval: 30000,
  });

  const unreadCount = notifData?.unreadCount ?? 0;
  const notifications = notifData?.notifications ?? [];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const handleNotificationClick = async (notif: { id: string; ticketId?: string; readAt?: string | null }) => {
    if (!notif.readAt) {
      try {
        await api.post(`/api/notifications/${notif.id}/read`);
        refetch();
      } catch {
        // continue
      }
    }
    setShowNotifications(false);
    if (notif.ticketId) {
      navigate(`/tickets/${notif.ticketId}`);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post("/api/notifications/read-all");
      refetch();
    } catch {
      // continue
    }
  };

  const getRoleBadge = () => {
    switch (user?.role) {
      case "STUDENT":
        return (
          <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
            Student
          </span>
        );
      case "STAFF":
        return (
          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
            Staff · {user.trade}
          </span>
        );
      case "WARDEN":
        return (
          <span className="bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
            Warden · Block {user.blockName || "Assigned"}
          </span>
        );
      case "CHIEF_WARDEN":
        return (
          <span className="bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
            Chief Warden
          </span>
        );
      case "ADMIN":
        return (
          <span className="bg-rose-500/10 text-rose-400 border border-rose-500/20 text-xs px-2.5 py-0.5 rounded-full font-medium">
            Administrator
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-slate-900/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div
          onClick={() => navigate("/")}
          className="flex items-center space-x-3 cursor-pointer"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg text-white tracking-tight">HostelDesk</span>
              <span className="bg-slate-800 text-slate-400 text-[10px] font-mono px-1.5 py-0.5 rounded">
                v1.0
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">Campus Complaint & Facility SLA Engine</p>
          </div>
        </div>

        {/* User Info & Actions */}
        <div className="flex items-center space-x-3 sm:space-x-4">
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

          {/* Interactive Notification Bell */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              title="Notifications"
              className="relative min-w-[44px] min-h-[44px] flex items-center justify-center p-2 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-slate-900">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Notification Dropdown */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                <div className="p-3.5 border-b border-slate-800 flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-semibold text-sm text-white">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="bg-indigo-500/20 text-indigo-400 text-xs px-2 py-0.5 rounded-full font-bold">
                        {unreadCount} unread
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllRead}
                      className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center space-x-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Mark all read</span>
                    </button>
                  )}
                </div>

                <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
                  {notifications.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      No notifications yet
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        onClick={() => handleNotificationClick(notif)}
                        className={`p-3.5 cursor-pointer transition hover:bg-slate-800/60 flex items-start space-x-3 ${
                          !notif.readAt ? "bg-indigo-950/20" : ""
                        }`}
                      >
                        <div
                          className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                            !notif.readAt ? "bg-indigo-500" : "bg-transparent"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs ${!notif.readAt ? "text-slate-200 font-medium" : "text-slate-400"}`}>
                            {notif.message}
                          </p>
                          <span className="text-[10px] text-slate-500 mt-1 block">
                            {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        {notif.ticketId && (
                          <ExternalLink className="w-3.5 h-3.5 text-slate-600 hover:text-slate-400 flex-shrink-0 mt-1" />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Logout button (min 44px tap target) */}
          <button
            onClick={handleLogout}
            title="Log out"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center space-x-1.5 px-3 py-1.5 rounded-lg text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 transition"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </div>
      </div>
    </header>
  );
};
