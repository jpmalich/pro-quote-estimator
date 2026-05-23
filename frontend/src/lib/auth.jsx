import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiError } from "./api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading, false = guest, obj = signed in
  const [error, setError] = useState("");

  const fetchMe = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch {
      setUser(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = async (email, password) => {
    setError("");
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setUser(data);
      return true;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || e.message);
      return false;
    }
  };

  const register = async (email, password, name, company_name, invite_code, signup_code) => {
    setError("");
    try {
      const { data } = await api.post("/auth/register", {
        email, password, name, company_name, invite_code, signup_code,
      });
      setUser(data);
      return true;
    } catch (e) {
      setError(formatApiError(e.response?.data?.detail) || e.message);
      return false;
    }
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      // Server-side logout best-effort; clear local state regardless
      // eslint-disable-next-line no-console
      console.warn("Logout call failed; clearing local session anyway", e);
    }
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, error, login, register, logout, refreshMe: fetchMe }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
