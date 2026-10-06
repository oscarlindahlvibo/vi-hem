# Vad som återstår

Codex förbereder och kontrollerar koden, databasinstallationen, initialt innehåll,
redaktörsbehörighet, formulärfunktionen, byggen, Nginx-konfiguration och återställning.
Server, domänkonfiguration och befintliga certifikatsökvägar är identifierade.

Alla aktiva administratörer i Vibogruppen AB får åtkomst automatiskt.
Oscar behöver kontrollera verksamhetsuppgifter och
annonsunderlag som inte finns i Vi-hem, samt utföra den manuella driftsättningen som
han uttryckligen reserverat. Bilder och annonstexter som redan finns kan förberedas
av Codex; nya underlag behöver komma från verksamheten.

## Förberedd publicering av hemsidan

`vibofast.se.conf` är en konfiguration för befintlig server och Vite-routing.
`publicera-hemsida.sh` installerar bara webbplatsen. Den gamla WordPress-katalogen
bevaras. Tidigare Nginx-konfiguration sparas och återställs automatiskt om Nginx-test
eller omladdning misslyckas. Skriptet har syntaxkontrollerats lokalt; --apply är inte
kört eller verifierat på produktionsservern.

Detta är inte ännu ett komplett driftsättningsskript för backend. Före publicering
behöver databasens tillägg och profilskydd, Vi-hem-administration och formulärfunktion
installeras och kontrolleras. Det gemensamma deployskriptet ska inte köras för att
bara publicera hemsidan eftersom det hanterar flera andra appar och migrationer.

DNS-uppslag på den lokala datorn gav en privat adress; detta kan vara lokal DNS.
Offentlig DNS och HTTPS måste kontrolleras utifrån före lansering.
