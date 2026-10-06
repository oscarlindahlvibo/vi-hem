# Färdigbyggt installationspaket för befintlig server

Paketet innehåller färdigbyggda Vite-appar för Vi-hem och vibofast.se, den enda nya
formulärfunktionen, Nginx-konfiguration samt installation med backup och kontroller.
Det körs manuellt. Skriptet använder uttryckligen serverns rootless Docker-socket
`/run/user/1000/docker.sock`, även under sudo. Inget hämtas eller mergas automatiskt från GitHub.

Packa upp paketet på servern och kör först från dess katalog:

```sh
bash driftsatt-vibofast.sh --check
```

Kör därefter ett steg i taget:

```sh
sudo bash driftsatt-vibofast.sh --install-backend
sudo bash driftsatt-vibofast.sh --publish-admin
```

Backendsteget kan köras av stackägaren vibo utan sudo. Det tar backup till
`/home/vibo/atm-personal-supabase/volumes/vibofast-backups/` (privat katalog, 0700),
eller `/var/backups/vibofast/` vid körning som root. Därefter installerar det
profilskydd och hemsidetillägg atomiskt, binder Vibogruppen AB och lägger in initialt
sidinnehåll. Alla aktiva administratörer i organisationen får åtkomst automatiskt.
Det installerar bara `vihem-vibofast-enquiry` och skapar dess egen anropshemlighet.
Befintliga RLS-policyer och andra appars tabeller ändras inte. Profilskyddet begränsar
INSERT/UPDATE på Vi-hems profiler enligt DEPLOYMENT.md; testa kontohanteringen.

Funktionscontainern återskapas för den nya miljövariabeln; under det korta bytet kan
även övriga Edge Functions vara otillgängliga. Databas, auth, storage och övriga
containrar startas inte om. Alla andra funktionskataloger behålls. Nya env-variabeln
läggs i befintlig compose-konfiguration så att vanlig framtida deploy behåller den.
Om funktionskontrollen misslyckas återställs dess tidigare konfiguration; databasens
additiva tillägg lämnas kvar. Återställ aldrig hela den delade databasen automatiskt.

Öppna Vi-hem och kontrollera hemsideadministrationen innan nästa steg. Fyll i bilder
och annonstexter för verkliga lediga/uppsagda objekt och kontrollera telefon, policyer
samt sidinnehåll. Initialinstallationen publicerar inga demoannonser.

När innehåll och integration är kontrollerade:

```sh
sudo bash driftsatt-vibofast.sh --publish-site
```

Hemsidesteg sparar Nginx-konfiguration, bevarar hela den gamla WordPress-katalogen och
aktiverar en separat release. De fyra befintliga WordPress-bilderna för sidinnehåll
fortsätter fungera via en begränsad bildrutt; nya bilder hanteras i Vi-hem/Supabase.
HTTPS använder befintliga certifikat. Nginx-test körs före omladdning och fel återställer
konfiguration och tidigare release automatiskt.

Kontrollen jämför även inspelade serverfiler och funktionscontainerns miljö mot
sparad Compose-konfiguration, utan att visa hemliga värden. Direktändringar på
servern stoppar installationen tills paketet uppdaterats.

GitHub main måste motsvara paketets basversion. Om Claude eller någon annan har
pushat nya ändringar stoppar skriptet; Codex ska då bygga ett nytt paket med senaste
ändringarna. Att senare köra den vanliga Vi-hem-deployen från en main-gren utan detta
förslag skulle ersätta administrationen igen. Förslaget behöver därför införas i main
innan det blir er ordinarie release. Ingen main-merge är gjord av detta paket.

## Verifierat inför leverans

- Vi-hem och hemsidan klarar TypeScript-kontroll och produktionsbygge.
- PostgreSQL-tester täcker publicering, datum och administratörsbehörigheter.
- Hela SQL-installern har testats inklusive rollback vid fel och stopp vid omkörning.
- Hemside-Nginx-konfigurationen klarar nginx -t med testcertifikat i isolerad container.
  Befintliga riktiga certifikat kontrolleras vid det manuella Nginx-testet.
- Alla fyra äldre sidbilder finns på servern.
- Scriptens syntax och ändringen för dedikerad hemlighet är lokalt testade.

Detta ersätter inte kontroll av riktiga inloggningar, formulär och annonser efter
backendinstallation. Använd först staging om en sådan finns. Paketet är inte deployat.
