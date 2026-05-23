import React, { createContext, useContext, useEffect, useState } from "react";
import api from "./api";

const BrandingCtx = createContext({});

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({
    supplier_name: "Loading…",
    supplier_tagline: "",
    supplier_logo_url: null,
  });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/branding");
        setBranding(data);
      } catch (e) {
        // Public endpoint should always be reachable; log so misconfig is visible
        // eslint-disable-next-line no-console
        console.warn("Failed to load /api/branding — using defaults", e);
      }
    })();
  }, []);

  return <BrandingCtx.Provider value={branding}>{children}</BrandingCtx.Provider>;
}

export const useBranding = () => useContext(BrandingCtx);
