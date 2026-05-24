import React, { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Upload, Shield, Copy, ArrowLeft, Tags, Building2, Percent, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function BrandingAdmin() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [branding, setBranding] = useState(null);
  const [signupCode, setSignupCode] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierTagline, setSupplierTagline] = useState("");
  const [defaultPricingMode, setDefaultPricingMode] = useState("margin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const [b, s] = await Promise.all([
          axios.get(`${API}/branding`),
          axios.get(`${API}/admin/signup-code?token=${encodeURIComponent(token)}`),
        ]);
        setBranding(b.data);
        setSupplierName(b.data.supplier_name || "");
        setSupplierTagline(b.data.supplier_tagline || "");
        setDefaultPricingMode(b.data.default_pricing_mode || "margin");
        setSignupCode(s.data.signup_code);
      } catch (e) {
        setError(
          e.response?.status === 403
            ? "Invalid admin token. Check your URL ?token=... and try again."
            : "Failed to load. " + (e.response?.data?.detail || e.message)
        );
      }
    })();
  }, [token]);

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F4F5]">
        <div className="card p-8 max-w-md w-full">
          <Shield className="w-10 h-10 text-[#F97316] mb-4" />
          <h1 className="font-heading text-2xl text-[#09090B] mb-2">Branding Admin</h1>
          <p className="text-sm text-[#52525B]">
            This URL requires an admin token. Append <code className="font-mono">?token=YOUR_TOKEN</code> to the URL. The token lives in <code className="font-mono">backend/.env</code> as <code className="font-mono">SUPPLIER_ADMIN_TOKEN</code>.
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F4F5]">
        <div className="card p-8 max-w-md w-full">
          <h1 className="font-heading text-2xl text-[#EF4444] mb-2">Access denied</h1>
          <p className="text-sm text-[#52525B]">{error}</p>
        </div>
      </div>
    );
  }

  if (!branding) {
    return <div className="p-10 text-center text-[#52525B]">Loading…</div>;
  }

  const uploadLogo = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/admin/upload-logo?token=${encodeURIComponent(token)}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setBranding({ ...branding, supplier_logo_url: data.url });
      toast.success("Supplier logo uploaded");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveBranding = async () => {
    setBusy(true);
    try {
      const { data } = await axios.put(
        `${API}/admin/branding?token=${encodeURIComponent(token)}`,
        { supplier_name: supplierName, supplier_tagline: supplierTagline }
      );
      setBranding(data);
      toast.success("Branding saved");
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const savePricingDefault = async (mode) => {
    setBusy(true);
    try {
      const { data } = await axios.put(
        `${API}/admin/branding?token=${encodeURIComponent(token)}`,
        { default_pricing_mode: mode }
      );
      setBranding(data);
      setDefaultPricingMode(data.default_pricing_mode || "margin");
      toast.success(`Default pricing set to ${mode}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  const logoUrl = branding.supplier_logo_url
    ? `${process.env.REACT_APP_BACKEND_URL}${branding.supplier_logo_url}`
    : null;

  return (
    <div className="min-h-screen bg-[#F4F4F5]">
      <header className="bg-[#09090B] text-white">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-[#F97316]" />
            <div>
              <div className="font-heading text-lg">Branding Admin</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                Supplier-only · do not share this URL
              </div>
            </div>
          </div>
          <Link to="/" className="text-white/70 hover:text-white text-sm">
            <ArrowLeft className="w-4 h-4 inline" /> Back to app
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Signup code */}
        <div className="card p-6" data-testid="signup-code-card">
          <div className="section-tag mb-3">Contractor Access Code</div>
          <p className="text-sm text-[#52525B] mb-3">
            Give this code to any contractor you want to grant access. They&apos;ll enter it when creating a new account.
          </p>
          <div className="flex items-stretch gap-2">
            <div className="flex-1 bg-[#09090B] text-[#F97316] font-mono-num text-2xl tracking-[0.3em] px-5 flex items-center">
              {signupCode}
            </div>
            <button
              className="btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(signupCode);
                toast.success("Copied");
              }}
            >
              <Copy className="w-4 h-4" /> Copy
            </button>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-[#A1A1AA] mt-3">
            To rotate: change SIGNUP_CODE in <span className="font-mono-num">backend/.env</span> &amp; restart backend.
          </p>
        </div>

        {/* Supplier brand */}
        <div className="card p-6">
          <div className="section-tag mb-3">Supplier Name &amp; Tagline</div>
          <div className="space-y-4">
            <div>
              <label className="label">Supplier name</label>
              <input
                className="input"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                data-testid="supplier-name-input"
              />
            </div>
            <div>
              <label className="label">Tagline (sales contact / phone)</label>
              <input
                className="input"
                value={supplierTagline}
                onChange={(e) => setSupplierTagline(e.target.value)}
                data-testid="supplier-tagline-input"
              />
            </div>
            <button className="btn-primary" onClick={saveBranding} disabled={busy} data-testid="save-branding-btn">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {/* Default pricing mode */}
        <div className="card p-6" data-testid="default-pricing-card">
          <div className="flex items-center gap-3 mb-3">
            <Percent className="w-5 h-5 text-[#F97316]" />
            <div className="section-tag">Default Pricing Mode</div>
          </div>
          <p className="text-sm text-[#52525B] mb-4">
            Sets how new estimates calculate sell price for every contractor by default.
            Each contractor can still toggle per-estimate, but new estimates start in this mode.
          </p>
          <div
            className="inline-flex border border-[#E4E4E7] rounded-sm overflow-hidden text-sm font-bold uppercase tracking-wider"
            data-testid="default-pricing-toggle"
          >
            <button
              type="button"
              disabled={busy}
              className={`px-5 py-2 transition ${
                defaultPricingMode === "margin"
                  ? "bg-[#09090B] text-white"
                  : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
              }`}
              onClick={() => savePricingDefault("margin")}
              data-testid="default-pricing-margin"
            >
              Margin
            </button>
            <button
              type="button"
              disabled={busy}
              className={`px-5 py-2 transition border-l border-[#E4E4E7] ${
                defaultPricingMode === "markup"
                  ? "bg-[#09090B] text-white"
                  : "bg-white text-[#52525B] hover:bg-[#F4F4F5]"
              }`}
              onClick={() => savePricingDefault("markup")}
              data-testid="default-pricing-markup"
            >
              Markup
            </button>
          </div>
          <div className="mt-3 text-[11px] text-[#71717A] font-mono-num">
            {defaultPricingMode === "margin"
              ? "Margin: sell = base ÷ (1 − %)  — 30% gives a ×1.429 multiplier"
              : "Markup: sell = base × (1 + %)  — 30% gives a ×1.300 multiplier"}
          </div>
        </div>

        {/* Supplier logo */}
        <div className="card p-6">
          <div className="section-tag mb-3">Supplier Logo</div>
          <p className="text-sm text-[#52525B] mb-4">
            Appears on the Login page and (optionally) in the quote footer.
          </p>
          <div className="flex items-center gap-5">
            <div className="w-28 h-28 border-2 border-[#E4E4E7] bg-[#09090B] flex items-center justify-center overflow-hidden">
              {logoUrl ? (
                <img src={logoUrl} alt="Supplier logo" className="w-full h-full object-contain" data-testid="supplier-logo-preview" />
              ) : (
                <div className="font-heading text-[#F97316] text-5xl">
                  {(supplierName || "A").charAt(0)}
                </div>
              )}
            </div>
            <div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
              <button className="btn-primary" onClick={() => fileRef.current?.click()} disabled={busy} data-testid="upload-supplier-logo-btn">
                <Upload className="w-4 h-4" /> {logoUrl ? "Replace" : "Upload"} Logo
              </button>
              {logoUrl && (
                <button
                  className="btn-ghost text-[#EF4444] mt-2"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const { data } = await axios.put(
                        `${API}/admin/branding?token=${encodeURIComponent(token)}`,
                        { supplier_logo_url: "" }
                      );
                      setBranding(data);
                      toast.success("Logo removed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-[#A1A1AA] text-center pt-4">
          Bookmark this URL — it&apos;s how you&apos;ll come back to update branding.
        </div>

        {/* Pricing Tiers */}
        <PricingTiersPanel token={token} />

        {/* Contractors → Tier assignment */}
        <CompaniesPanel token={token} />
      </main>
    </div>
  );
}

function PricingTiersPanel({ token }) {
  const [tiers, setTiers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editTier, setEditTier] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = React.useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/admin/tiers?token=${encodeURIComponent(token)}`);
      setTiers(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const openEdit = async (tierId) => {
    setEditingId(tierId);
    const { data } = await axios.get(`${API}/admin/tiers/${tierId}?token=${encodeURIComponent(token)}`);
    setEditTier(data);
  };

  const updateItem = (si, ii, key, val) => {
    setEditTier((t) => {
      const next = JSON.parse(JSON.stringify(t));
      next.sections[si].items[ii][key] = key === "name" || key === "unit" ? val : Number(val) || 0;
      return next;
    });
  };

  const saveTier = async () => {
    setBusy(true);
    try {
      await axios.put(`${API}/admin/tiers/${editingId}?token=${encodeURIComponent(token)}`, {
        sections: editTier.sections,
      });
      toast.success(`${editTier.name} prices saved`);
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-6 mt-6" data-testid="tiers-panel">
      <div className="flex items-center gap-3 mb-4">
        <Tags className="w-5 h-5 text-[#F97316]" />
        <div className="section-tag">Pricing Tiers</div>
      </div>
      <p className="text-sm text-[#52525B] mb-4">
        Material prices each contractor sees, by tier. Labor numbers shown here are the
        defaults — contractors can override labor per estimate. Click a tier to edit prices.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {tiers.map((t) => (
          <button
            key={t.id}
            className={`p-4 border-2 text-left transition-all ${editingId === t.id ? "border-[#F97316] bg-orange-50" : "border-[#E4E4E7] hover:border-[#09090B]"}`}
            onClick={() => openEdit(t.id)}
            data-testid={`tier-${t.name}`}
          >
            <div className="text-[10px] uppercase tracking-wider text-[#A1A1AA]">Tier</div>
            <div className="font-heading text-lg text-[#09090B]">{t.name}</div>
            <div className="text-xs text-[#52525B] mt-1">
              {(t.sections || []).reduce((s, x) => s + (x.items || []).length, 0)} items
            </div>
          </button>
        ))}
      </div>

      {editTier && (
        <div className="border-t border-[#E4E4E7] pt-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-heading text-xl">{editTier.name}</h3>
            <button className="btn-primary" onClick={saveTier} disabled={busy} data-testid="save-tier-btn">
              {busy ? "Saving…" : "Save Tier"}
            </button>
          </div>
          {editTier.sections.map((s) => {
            const si = editTier.sections.indexOf(s);
            return (
              <div key={s.title} className="mb-4 border border-[#E4E4E7]">
                <div className="bg-[#FAFAFA] px-3 py-2 text-xs uppercase tracking-wider font-bold text-[#52525B]">
                  {s.title}
                </div>
                {s.items.map((it) => {
                  const ii = s.items.indexOf(it);
                  return (
                    <div key={it.name} className="grid grid-cols-12 gap-2 px-3 py-1 border-t border-[#E4E4E7] items-center">
                      <div className="col-span-6 text-sm">{it.name}</div>
                      <div className="col-span-1 text-[10px] text-[#A1A1AA] uppercase">{it.unit}</div>
                      <div className="col-span-2">
                        <input
                          className="input num h-8 text-sm"
                          type="number"
                          step="0.01"
                          value={it.mat}
                          onChange={(e) => updateItem(si, ii, "mat", e.target.value)}
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          className="input num h-8 text-sm"
                          type="number"
                          step="0.01"
                          value={it.lab}
                          onChange={(e) => updateItem(si, ii, "lab", e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompaniesPanel({ token }) {
  const [companies, setCompanies] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [busy, setBusy] = useState({});

  const load = React.useCallback(async () => {
    try {
      const [co, t] = await Promise.all([
        axios.get(`${API}/admin/companies?token=${encodeURIComponent(token)}`),
        axios.get(`${API}/admin/tiers?token=${encodeURIComponent(token)}`),
      ]);
      setCompanies(co.data);
      setTiers(t.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const assign = async (companyId, tierId) => {
    setBusy((b) => ({ ...b, [companyId]: true }));
    try {
      await axios.put(`${API}/admin/companies/${companyId}/tier?token=${encodeURIComponent(token)}`, {
        price_tier_id: tierId,
      });
      toast.success("Tier updated");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy((b) => ({ ...b, [companyId]: false }));
    }
  };

  const remove = async (company) => {
    const typed = window.prompt(
      `This will permanently delete "${company.name}", its ${company.estimate_count} estimate(s), and all of its team accounts.\n\n` +
      `Type the company name exactly to confirm:`
    );
    if (typed === null) return; // user cancelled
    if (typed.trim() !== company.name) {
      toast.error("Name did not match. Nothing was deleted.");
      return;
    }
    setBusy((b) => ({ ...b, [company.id]: true }));
    try {
      const { data } = await axios.delete(
        `${API}/admin/companies/${company.id}?token=${encodeURIComponent(token)}`
      );
      toast.success(
        `Deleted ${data.company_name} (${data.estimates_deleted} estimates, ${data.users_deleted} users)`
      );
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || e.message);
    } finally {
      setBusy((b) => ({ ...b, [company.id]: false }));
    }
  };

  return (
    <div className="card p-6 mt-6" data-testid="companies-panel">
      <div className="flex items-center gap-3 mb-4">
        <Building2 className="w-5 h-5 text-[#F97316]" />
        <div className="section-tag">Contractor Companies ({companies.length})</div>
      </div>
      <p className="text-sm text-[#52525B] mb-4">
        Assign each contractor to a pricing tier. Changing a tier takes effect on their
        next estimate. Existing saved estimates keep their original prices.
      </p>
      <div className="border border-[#E4E4E7] max-h-[500px] overflow-y-auto">
        <div className="grid grid-cols-12 gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-[#A1A1AA] font-bold bg-[#FAFAFA] sticky top-0">
          <div className="col-span-4">Company</div>
          <div className="col-span-3">Tier</div>
          <div className="col-span-2 text-right">Estimates</div>
          <div className="col-span-2 text-right">Created</div>
          <div className="col-span-1 text-right">&nbsp;</div>
        </div>
        {companies.map((c) => (
          <div key={c.id} className="grid grid-cols-12 gap-3 px-3 py-2 border-t border-[#E4E4E7] items-center text-sm">
            <div className="col-span-4">
              <div className="font-semibold text-[#09090B]">{c.name}</div>
              <div className="text-[10px] text-[#A1A1AA] font-mono-num">{c.invite_code}</div>
            </div>
            <div className="col-span-3">
              <select
                className="input h-9 text-sm"
                value={c.price_tier_id || ""}
                onChange={(e) => assign(c.id, e.target.value)}
                disabled={busy[c.id]}
                data-testid={`tier-select-${c.id}`}
              >
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 text-right font-mono-num">{c.estimate_count}</div>
            <div className="col-span-2 text-right text-xs text-[#A1A1AA]">
              {new Date(c.created_at).toLocaleDateString()}
            </div>
            <div className="col-span-1 text-right">
              <button
                type="button"
                onClick={() => remove(c)}
                disabled={busy[c.id]}
                className="p-1.5 text-[#A1A1AA] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-sm transition disabled:opacity-40 disabled:cursor-not-allowed"
                title={`Delete ${c.name}`}
                data-testid={`delete-company-${c.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
