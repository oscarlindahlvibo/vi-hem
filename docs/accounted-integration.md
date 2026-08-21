# Accounted i VI-HEM

Accounted är den externa bokföringsmotorn. VI-HEM fortsätter vara källa för organisationer, bolag, kunder, hyresunderlag, projekt, arbetsorder och avbetalningsplaner. Bokföringssynken sker via `vihem_accounting_sync_queue` och edge functions, aldrig direkt från frontend.

För varje bolag med provider `accounted` anges i **Ekonomi > bokföringskoppling**:

- `Accounted API-bas-URL`, normalt inklusive `/api/v1`.
- `Accounted company-id` för motsvarande bolag i Accounted.
- den krypterade primära API-token/hemligheten.

Testknappen gör ett server-side `GET /companies/{companyId}`. Skrivningar använder Bearer-auth och en unik `Idempotency-Key` per köpost. Ett misslyckat anrop lämnar originalposten i VI-HEM och markerar köposten som `failed` för retry/diagnostik.

Avbetalningsplaner är fortsatt administrativa i VI-HEM och skickas inte automatiskt till Accounted.
