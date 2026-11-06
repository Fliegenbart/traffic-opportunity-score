import React, { createContext, useContext, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

export type TenantId = "tyrnon";

export interface TenantConfig {
  id: TenantId;
  appName: string;
}

const TENANTS: Record<TenantId, TenantConfig> = {
  tyrnon: {
    id: "tyrnon",
    appName: "Ladepark-Check",
  },
};

function getTenantIdFromUrl(): TenantId {
  try {
    const tenantParam = new URLSearchParams(window.location.search).get("tenant");
    if (tenantParam && tenantParam in TENANTS) {
      return tenantParam as TenantId;
    }
  } catch {
    // noop
  }
  return "tyrnon";
}

function getEmbedModeFromUrl(pathname: string): boolean {
  if (pathname.startsWith("/embed")) return true;
  try {
    const embedParam = new URLSearchParams(window.location.search).get("embed");
    return embedParam === "1" || embedParam === "true";
  } catch {
    return false;
  }
}

type TenantContextValue = {
  tenant: TenantConfig;
  embed: boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const [pathname] = useLocation();

  const value = useMemo<TenantContextValue>(() => {
    const id = getTenantIdFromUrl();
    return {
      tenant: TENANTS[id],
      embed: getEmbedModeFromUrl(pathname),
    };
  }, [pathname]);

  useEffect(() => {
    document.documentElement.dataset.tenant = value.tenant.id;
    document.documentElement.dataset.embed = value.embed ? "1" : "0";
  }, [value.tenant.id, value.embed]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error("useTenant must be used within TenantProvider");
  }
  return ctx;
}
