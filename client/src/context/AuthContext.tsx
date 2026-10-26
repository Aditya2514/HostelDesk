import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Role } from "../types/auth";
import { api } from "../lib/api";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  getDashboardRoute: (role?: Role) => string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function getDashboardRoute(role?: Role): string {
  switch (role) {
    case "STUDENT":
      return "/student";
    case "STAFF":
      return "/staff";
    case "WARDEN":
    case "CHIEF_WARDEN":
      return "/warden";
    case "ADMIN":
      return "/admin";
    default:
      return "/login";
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>("/api/auth/me");
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string): Promise<User> => {
    const data = await api.post<{ user: User }>("/api/auth/login", { email, password });
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        logout,
        refreshUser,
        getDashboardRoute,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
