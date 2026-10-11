// Opt-in release restriction; absent in normal builds. Server authorization remains mandatory.
export const betaExternalRestricted = import.meta.env.VITE_VIHEM_BETA_RESTRICT_EXTERNAL === 'true';
export const betaArchiveNotice = 'I denna beta är nya besiktningsbilder och slutprotokoll tillfälligt avstängda. Textutkast kan sparas och äldre dokument finns kvar.';
export const betaInvoiceNotice = 'PDF-hämtning från Accounted är tillfälligt avstängd i denna beta. Fakturauppgifterna och originaldokumenten ändras inte.';

export const betaLegacyFileNotice = 'Äldre chatt-, besiktnings-, arbetsorder- och fordonsbilagor är tillfälligt spärrade i denna beta medan privat åtkomst färdigställs. Filerna bevaras. Nya chattbilagor använder privat lagring.';
