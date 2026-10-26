import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth, getDashboardRoute } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { StudentDashboard } from "./pages/StudentDashboard";
import { StaffDashboard } from "./pages/StaffDashboard";
import { WardenDashboard } from "./pages/WardenDashboard";
import { AdminDashboard } from "./pages/AdminDashboard";
import { TicketDetailPage } from "./pages/TicketDetailPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { NotFoundPage } from "./pages/NotFoundPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retry once on network/server errors, but never on 4xx (a 404 or 403 won't fix itself,
      // and retrying only delays the error message the user should see).
      retry: (failureCount, error: any) => {
        if (error?.status >= 400 && error?.status < 500) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

const RootRedirect: React.FC = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <div className="w-10 h-10 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
        <p className="text-sm tracking-wide">Loading HostelDesk...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={getDashboardRoute(user.role)} replace />;
};

import { useLocation } from "react-router-dom";

const RouteTitle: React.FC = () => {
  const location = useLocation();

  React.useEffect(() => {
    const path = location.pathname;
    let title = "HostelDesk — Room & Facility Complaint Management";

    if (path === "/login") {
      title = "Sign In — HostelDesk";
    } else if (path === "/student") {
      title = "Student Portal — HostelDesk";
    } else if (path === "/staff") {
      title = "Technician Queue — HostelDesk";
    } else if (path === "/warden") {
      title = "Warden Control Center — HostelDesk";
    } else if (path === "/admin") {
      title = "Admin Management — HostelDesk";
    } else if (path.startsWith("/tickets/")) {
      title = "Ticket Details — HostelDesk";
    } else if (path === "/forbidden") {
      title = "403 Access Forbidden — HostelDesk";
    }
    document.title = title;
  }, [location.pathname]);

  return null;
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <RouteTitle />
          <Routes>
            <Route path="/" element={<RootRedirect />} />
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/student"
              element={
                <ProtectedRoute allowedRoles={["STUDENT"]}>
                  <StudentDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/tickets/:id"
              element={
                <ProtectedRoute>
                  <TicketDetailPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/staff"
              element={
                <ProtectedRoute allowedRoles={["STAFF"]}>
                  <StaffDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/warden"
              element={
                <ProtectedRoute allowedRoles={["WARDEN", "CHIEF_WARDEN"]}>
                  <WardenDashboard />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute allowedRoles={["ADMIN"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="/403" element={<ForbiddenPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
