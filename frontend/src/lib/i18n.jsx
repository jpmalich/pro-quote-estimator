// Lightweight i18n for the estimator. Two languages: en (default) + es.
// - Translations live in dictionaries.js to keep this file focused on plumbing.
// - Lang persists to localStorage (`lang` key) per-device.
// - `useT()` returns a `t(key, vars?)` function. Unknown keys fall back to the
//   key itself, so missing strings are obvious during dev.
import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { dict } from "./dictionaries";

const LangContext = createContext({ lang: "en", setLang: () => {}, t: (k) => k });

const STORAGE_KEY = "ui-lang-v1";
const VALID = new Set(["en", "es"]);

function readInitial() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VALID.has(stored)) return stored;
    // Fall back to browser preference once
    const nav = (typeof navigator !== "undefined" && navigator.language) || "en";
    if (nav.toLowerCase().startsWith("es")) return "es";
  } catch (err) {
    // SSR or localStorage disabled (private mode, blocked cookies, etc.)
    console.warn("[i18n] readInitial failed:", err?.message || err);
  }
  return "en";
}

export function LangProvider({ children, initial }) {
  const [lang, setLangState] = useState(initial || readInitial);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, lang); }
    catch (err) { console.warn("[i18n] persist failed:", err?.message || err); }
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    if (VALID.has(next)) setLangState(next);
  }, []);

  const t = useCallback(
    (key, vars) => {
      const table = dict[lang] || dict.en;
      let str = table[key];
      if (str == null) str = dict.en[key]; // fall back to EN
      if (str == null) return key;          // last resort: key itself
      if (vars) {
        for (const k of Object.keys(vars)) {
          str = str.split(`{${k}}`).join(String(vars[k]));
        }
      }
      return str;
    },
    [lang]
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang() {
  return useContext(LangContext);
}

export function useT() {
  return useContext(LangContext).t;
}

// Standalone helper for non-React code (e.g. email building outside the tree).
export function tFor(lang, key, vars) {
  const table = dict[lang] || dict.en;
  let str = table[key] ?? dict.en[key] ?? key;
  if (vars) {
    for (const k of Object.keys(vars)) {
      str = str.split(`{${k}}`).join(String(vars[k]));
    }
  }
  return str;
}
