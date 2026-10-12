import React, { createContext, useContext } from "react";
import type { Course, Site } from "./api";
export const SiteContext = createContext<{ site: Site; courses: Course[] }>({ site: {} as Site, courses: [] });
export const useSite = () => useContext(SiteContext);
export const SiteProvider = ({ value, children }: { value: { site: Site; courses: Course[] }; children: React.ReactNode }) => <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
