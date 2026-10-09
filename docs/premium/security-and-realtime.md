# Säkerhet och realtid – kontrollpunkt 2

## Arbetsorderkommentarer: separat produktionshotfix rekommenderas

2026-10-09 gjordes en läsande metadatafråga i produktion (READ ONLY; inga kommentarer, personuppgifter eller filer hämtades). Produktionspolicyn `Staff can read work order comments` kontrollerar enbart staff/admin/superadmin. INSERT kontrollerar egen avsändare och roll, men inte åtkomst till arbetsordern. Den restriktiva rättningen finns inte i produktion. Arbetsorderns befintliga SELECT-policy har korrekt organisationsvillkor och explicit superadminundantag.

Slutsats: den redan reproducerade cross-org-luckan i QA gäller även den nuvarande produktionspolicyn. **Planera en separat säkerhetshotfix, utan att invänta premiumprojektet.** Ingen produktionsändring har utförts. Ingen åtkomstincident har undersökts eller konstaterats; detta är en policyanalys och en reproducerad QA-sårbarhet.

Hotfixens enda migration är `20261009130000_work_order_comment_isolation.sql`. Den kräver inte profilbilder, nya UI-komponenter eller chattmigrationerna. Additiva restriktiva policyer begränsar befintliga permissiva policyer med aktiv profil, personalroll och föräldraåtkomst genom arbetsorderns RLS. Ägarvillkor gäller skrivning. Anonym åtkomst nekas. Inga data ändras eller raderas.

Verifierat med verkliga JWT i isolerad QA:
- Egen organisations personal läser interna och kundsynliga kommentarer.
- Hyresgäst, annan organisations administratör och anonym nekas.
- Annan organisations arbetsorder och förfalskad avsändare nekas vid INSERT.
- Inaktiv personal nekas både läsning och INSERT.
- Aktiv superadmins uttryckligen befintliga åtkomst över organisationsgränsen bevaras.
- Tillfälligt ändrad QA-profil återställdes i finally.

Före manuell hotfix: spara aktuella policydefinitioner, jämför parent-RLS med granskad metadata, upprepa prov mot en aktuell schemakopia och kör migrationen i transaktion med ON_ERROR_STOP. Kontrollera personalens kommentarer och det befintliga kundsynliga felanmälningsflödet efteråt. Kör inte övriga premiummigrationer samtidigt av bekvämlighet. Att rulla tillbaka restriktiva policyer återöppnar sårbarheten och får inte vara rutinåtgärd.

Metadatarevisionen noterade även äldre permissiva profil-UPDATE-policyer som behöver en separat behörighetsrevision (inklusive skydd av roll/organisation). Denna hotfix ändrar dem inte och certifierar inte hela systemets säkerhet.

## Intermittent återanslutning: reproducerad beredskapsgräns

`scripts/premium/realtime-rejoin.mjs` körde tolv cykler med verklig self-hosted Realtime, två autentiserade QA-klienter och syntetiska meddelanden. Första cykeln: socket SUBSCRIBED vid 15 ms, postgres_changes system ok först vid 2164 ms. Meddelandet som skrevs däremellan gav inget liveevent men fanns exakt i autentiserad historik. Alla tolv meddelanden efter CDC-ready gav liveevent; alla historikhämtningar fungerade. Övriga cykler hade cirka 4–9 ms mellan socket och CDC-ready.

Det tidigare integrationsprovet väntade bara på SUBSCRIBED vid återanslutning, trots att initial prenumeration redan väntade på CDC-ready. Provet är nu korrigerat att kontrollera båda gränserna och historiken. Det är inte en godtyckligt längre sleep eller borttagen assertion. Fullständig chattintegration passerade efter rättningen.

Appens befintliga `useChat` synkroniserar vid både SUBSCRIBED och postgres_changes ok samt vid foreground/online och periodiskt. Detta bevaras. Sena callbacks efter avmontering ignoreras nu även i inboxens systemhandler/refresh.

Avgränsning: rotorsaken till det observerade provfelet är reproducerad. Tolv SDK-cykler är inte ett bevis på obegränsad robusthet eller fysisk mobilbakgrundshantering. Två verkliga browserklienter, långvariga avbrott, byte av konversation under återanslutning och iOS/Android-bakgrund ska fortfarande verifieras innan full releasegodkännande.
