import React, { createContext, useContext } from "react";
import type { Product, SiteConfig } from "../api";

export const SiteContext = createContext<{ site: SiteConfig; products: Product[] }>({ site: {} as SiteConfig, products: [] });
export const useSite = () => useContext(SiteContext);
export const SiteProvider = ({ value, children }: { value: { site: SiteConfig; products: Product[] }; children: React.ReactNode }) => <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
