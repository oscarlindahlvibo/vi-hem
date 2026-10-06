# Hemsidebilder från Google Drive

En separat huvudmapp väljs under Vibo hemsida → Bilder från Google Drive. Den ändrar inte Vi-hems befintliga dokumentlagring. Kopplingen använder Vibogruppen AB:s redan krypterade Google-servicekonto.

Struktur under vald mapp:

```
Vibo Fastigheter – hemsidebilder/
  Ekängsvägen 1 – <fastighets-id>/
    Gemensamma bilder/
    Lägenheter/
      Lgh <nummer> – <lägenhets-id>/
```

Alla Vi-hem-fastigheter och lägenheter i den konfigurerade organisationen får mappar. Namn och interna ID:n undviker sammanblandning. Inga hyresgästnamn lagras i mappnamnen. Flyttade/borttagna mappar upptäcks; befintliga mappar med samma interna märkning återanvänds.

Endast JPG, PNG och WebP i respektive bildmapp kopieras till den separata publika Supabase-bucketen `vihem-vibofast-drive-images`. Andra filtyper och undermappar läses inte som hemsidebilder. Max 10 MB/bild. Filnamn sorteras naturligt, exempelvis 01-kök.jpg före 10-balkong.jpg. Lägenhetsbilder och manuellt uppladdade lägenhetsbilder visas före fastighetens gemensamma bilder. Dubletter i bildlistan tas bort.

Drive-originalen och deras delningsbehörigheter ändras aldrig av synkningen. När bilder ändras får cachekopian ny adress. När bilder flyttas eller tas bort uppdateras hemsidans lista efter nästa lyckade fullständiga läsning av den bildmappen. Vid läs-/nedladdningsfel behålls den tidigare listan. Annons utan bilder publiceras inte. Uthyrningsstatus och annonsernas publiceringsval styr fortsatt om annonsen visas.

Cron kör varje minut och behandlar högst sex lägenheter åt gången, med en lease som hindrar samtidiga manuella körningar. Varje fastighet uppdateras normalt inom ungefär 15 minuter för nuvarande sju fastigheter och 64 lägenheter. Knappen Skapa mappar och synka alla startar alltid från första lägenheten och kör alla steg direkt, även om en schemalagd körning redan hunnit behandla delar av fastigheten. Nya lägenheter/fastigheter tas med automatiskt. Senaste synkning och fel visas i Vi-hem.

Google-tokenen använder `drive.file` för att skapa de egna mapparna och `drive.readonly` för att läsa även bilder som användare lagt dit manuellt. Servicekontot behöver åtkomst till den valda mappen/enheten. Om Workspace-delegering används anges användaradressen i inställningen och dessa scopes måste vara godkända i Google Admin. Inga Google-nycklar eller access-token exponeras i frontend.

Google-dokumentation: [Shared drives](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives), [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Migrationer: 20261006160000_vihem_vibofast_drive_images.sql samt 20261006170000_vihem_vibofast_drive_manual_restart.sql. Kör endast nya migrationer på en redan installerad instans. Privat databasbackup och registrering av exakt checksumma i befintlig deployhistorik krävs vid manuell installation. Cron är inaktiv i praktiken tills Drive aktiveras; huvudmappen får aldrig gissas.

## Vald huvudmapp och generell Vi-hem-lagring

Aktiverad huvudmapp: [Vi-Hem server](https://drive.google.com/drive/folders/1kBmSjNNLb9WQYFUZZALXrvm-XHsb3sT1), i delad enhet 0AMOC4dHEz6J8Uk9PVA.

Hemsidans bilder: [Vibo Fastigheter – hemsidebilder](https://drive.google.com/drive/folders/17uo7hkOSn55mdfQktUL5uIZry_U4z0c9).
Övriga filer: [Vibogruppen-AB__38fe702d](https://drive.google.com/drive/folders/1sQ2TBDXM4DPBahnazPQme3NC0qE0opGp).

Alla 7 fastigheter och 64 lägenheter har bildmappar. För övriga filer finns bland annat Dokument, Ekonomi/Underlag, Ekonomi/Avbetalningsplaner, Avtal, Besiktningar/Foton, Arbetsorder, Lager/Artiklar, Uthyrning och Fleet. Befintliga moduler skapar fler undermappar vid behov. Bara mappar för hemsidebilder är bildkälla till den publika webbplatsen.

Servicekontot vihem-415@vibofast-1755590962277.iam.gserviceaccount.com har skrivåtkomst till den valda mappen. Workspace-delegering används inte. Vi-hems inställningar för både hemsidebilder och generell dokumentlagring är aktiverade för Vibogruppen AB. Andra organisationers konfigurationer och OAuth-scopes är bevarade.

Ett fel i den gemensamma frontendhjälparen är rättat: den läser nu enabled från settings.settings enligt backendkontraktet, så att exempelvis arbetsordrar och besiktningar faktiskt använder Drive-arkiveringen när den är aktiverad. Serverfunktionen stöder servicekonto utan felaktig användardelegering och skickar supportsAllDrives vid mappskapande. För Vibo begärs även drive.readonly för att nå den huvudmapp som användaren skapat; andra organisationer behåller sina tidigare scopes.

[Googles krav för servicekonton och mappar](https://developers.google.com/workspace/drive/api/guides/folder).
