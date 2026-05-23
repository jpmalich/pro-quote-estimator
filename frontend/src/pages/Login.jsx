import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

const BG =
  "https://static.prod-images.emergentagent.com/jobs/f5ca1a54-7ada-4d85-b160-76d5daf2760b/images/d36a236ce8a57df40cb284a048570a3dc3ace340beaf7bd71fddadefd9427f32.png";

export default function Login() {
  const { user, login, register, error } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (user) nav(loc.state?.from?.pathname || "/", { replace: true });
  }, [user, nav, loc]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const ok =
      mode === "login"
        ? await login(email, password)
        : await register(email, password, name);
    setBusy(false);
    if (ok) {
      toast.success(mode === "login" ? "Welcome back" : "Account created");
    }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-white">
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm" data-testid="auth-card">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-11 h-11 bg-[#09090B] text-[#F97316] flex items-center justify-center font-heading text-xl">
              W
            </div>
            <div>
              <div className="font-heading text-xl text-[#09090B] leading-none">
                Wolf & Son
              </div>
              <div className="text-[10px] uppercase tracking-[0.25em] text-[#A1A1AA] mt-1">
                Renovations · Estimator
              </div>
            </div>
          </div>

          <div className="mb-7">
            <div className="text-xs uppercase tracking-[0.2em] text-[#A1A1AA] mb-2">
              {mode === "login" ? "Welcome back" : "Create an account"}
            </div>
            <h1 className="font-heading text-3xl sm:text-4xl text-[#09090B] leading-tight">
              {mode === "login" ? "Sign in to your account" : "Get started in seconds"}
            </h1>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === "register" && (
              <div>
                <label className="label">Name</label>
                <input
                  className="input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  data-testid="name-input"
                />
              </div>
            )}
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                data-testid="email-input"
              />
            </div>
            <div>
              <label className="label">Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                data-testid="password-input"
              />
            </div>
            {error && (
              <div className="text-sm text-[#EF4444] border border-[#EF4444]/30 bg-[#FEF2F2] px-3 py-2" data-testid="auth-error">
                {error}
              </div>
            )}
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy}
              data-testid="auth-submit-btn"
            >
              {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <div className="text-sm text-[#52525B] mt-6">
            {mode === "login" ? (
              <>
                Need an account?{" "}
                <button
                  className="font-semibold text-[#09090B] underline underline-offset-4 decoration-[#F97316]"
                  onClick={() => setMode("register")}
                  data-testid="switch-register"
                >
                  Register
                </button>
              </>
            ) : (
              <>
                Already have one?{" "}
                <button
                  className="font-semibold text-[#09090B] underline underline-offset-4 decoration-[#F97316]"
                  onClick={() => setMode("login")}
                  data-testid="switch-login"
                >
                  Sign in
                </button>
              </>
            )}
          </div>

          <div className="mt-10 text-[11px] text-[#A1A1AA] uppercase tracking-widest">
            Default admin · admin@wolfandson.com / Admin123!
          </div>
        </div>
      </div>
      <div
        className="hidden md:block bg-cover bg-center"
        style={{ backgroundImage: `url(${BG})` }}
        aria-hidden="true"
      />
    </div>
  );
}
