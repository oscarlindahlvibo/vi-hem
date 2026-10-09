# VI-HEM – designstandard 3.0

En produktfamilj med marinblå identitet, primärblå interaktioner och neutrala vita arbetsytor. Premiumkvalitet kommer från informationshierarki och interaktionsprecision, inte fler skuggor.

## Tokens

CSS-variabler är källa för palett, ytor, radier, skuggor, rytm och animationer. Tailwind-namn vihem refererar till dessa; använd aldrig godtyckliga nya profilfärger. Funktionsfärger rött/grönt/amber får bara signalera verkligt tillstånd. Neutral status är standard. Lokal systemfont ger native-känsla utan nätverksberoende/fontbyte; fontbyte till lokalt Inter kan utvärderas senare med faktisk läsbarhets-/licenskontroll.

Text: sidrubrik 24–28 px, sektionsrubrik 18–20, korttitel 15–16, brödtext/fält 14–16, sekundär text 12–14. Minst 16 px fälttext på touch för att undvika iOS-zoom. Siffror använder tabular-nums när de jämförs. Textbehållare har maxbredd 65–75 tecken; tabeller kan utnyttja hela ytan.

Ytor: en huvudcontainer per arbetsyta, minimera kort i kort. Primär knapp för huvudsakligt nästa steg, sekundär för alternativ, ghost för kontextåtgärd, danger för destruktiv åtgärd. Normal kontrollhöjd 40 px desktop, minst 44 px touch. Ikoner 16–20 px i kontroller, 20–24 i navigation.

## Komponentkontrakt

- Button behåller befintlig API/standard submit-semantik; välj explicit type=button för rena sidoåtgärder. loading sätter disabled och aria-busy. IconButton kräver tillgängligt namn och 44 px touchyta.
- Input/Select/Textarea har stabilt unikt ID, kopplad label och hint/error, aria-invalid samt fungerande fokustillstånd. Sätt inputMode/type/autocomplete för respektive verksamhetsfält.
- Modal/BottomSheet delar fokusfälla, återställning, stackhantering, inert bakgrund, scroll-lås och mobilsafe-area. Endast översta dialogen stängs med Escape. Undvik att fokusera textfält automatiskt på mobil så tangentbordet öppnas ofrivilligt.
- Card är yta; interaktiv Card måste fungera med Enter/Space och fokus, utan att underordnade knappar utlöser kortets huvudåtgärd.
- Avatar ger konsekventa initialer och bildreserv; privata profilbilder ska gå genom behörighetskontrollerad hämtning och sessionsbunden cache, aldrig godtyckliga tredjeparts-URL:er.
- Tabs/SegmentedControl måste erbjuda tangentbordsval och tydlig vald status. Filterchips är filter, inte falska tabpaneler.
- FormSection, FieldGroup och ActionBar organiserar långa formulär; SaveState kommunicerar sparstatus. Dessa får inte smyga in autosignering eller publicering.

## Interaktion och verifiering

Använd :focus-visible. Hover får inte vara enda vägen till åtgärder; på touch finns långtryck och/eller tillgänglig menyknapp. Reducerad rörelse stoppar rörelseanimationer. Klickbara mål har disabled/loading/felåterkoppling. Ett fel får inte radera användarens utkast. Äldre API- och RLS-regler bevaras.

En modul är inte verifierad genom delad komponent/CSS. Kontrollera varje list-/detalj-/formulär-/dialogflöde visuellt och funktionellt med rätt roller. Dokumentera faktisk skärmstorlek och kända begränsningar.
