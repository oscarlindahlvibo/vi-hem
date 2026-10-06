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

Cron kör varje minut och behandlar högst sex lägenheter åt gången, med en lease som hindrar samtidiga manuella körningar. Varje fastighet uppdateras normalt inom ungefär 15 minuter för nuvarande sju fastigheter och 64 lägenheter. Knappen Skapa mappar och synka alla kör alla steg direkt. Nya lägenheter/fastigheter tas med automatiskt. Senaste synkning och fel visas i Vi-hem.

Google-tokenen använder `drive.file` för att skapa de egna mapparna och `drive.readonly` för att läsa även bilder som användare lagt dit manuellt. Servicekontot behöver åtkomst till den valda mappen/enheten. Om Workspace-delegering används anges användaradressen i inställningen och dessa scopes måste vara godkända i Google Admin. Inga Google-nycklar eller access-token exponeras i frontend.

Google-dokumentation: [Shared drives](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives), [files.list](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list), [scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

Migration: 20261006160000_vihem_vibofast_drive_images.sql. Kör endast denna nya migration på en redan installerad instans. Privat databasbackup och registrering av exakt checksumma i befintlig deployhistorik krävs vid manuell installation. Cron är inaktiv i praktiken tills Drive aktiveras; huvudmappen får aldrig gissas.
