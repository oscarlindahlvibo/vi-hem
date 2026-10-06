export interface FaqCategory {
  id: string;
  slug: string;
  title: string;
  icon: string;
  description: string;
  articles: FaqArticle[];
}

export interface FaqArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string[];
  updatedAt?: string;
}

export let faqCategories: FaqCategory[] = [
  {
    id: '1',
    slug: 'inomhusmiljo',
    title: 'Inomhusmiljö',
    icon: 'Thermometer',
    description: 'Temperatur, ventilation och hur du skapar ett bra inomhusklimat.',
    articles: [
      {
        id: '1-1',
        slug: 'temperatur-i-lagenheten',
        title: 'Så mäter du temperaturen i din lägenhet',
        excerpt:
          'Om du upplever att det är kallt i din lägenhet kan du börja med att mäta temperaturen på rätt sätt.',
        content: [
          'Om du upplever att det är kallt i din lägenhet kan du börja med att mäta temperaturen:',
          '1. Placera termometern i mitten av rummet och 1 meter ovanför golvet.',
          '2. Låt termometern ligga stilla i minst 10 minuter innan du avläser.',
          '3. Mät på flera ställen i lägenheten för att få en helhetsbild.',
          'Den normala rumstemperaturen ska vara cirka 20–21 grader Celsius. Om temperaturen avviker mycket, kontakta oss via felanmälan.',
        ],
      },
      {
        id: '1-2',
        slug: 'ventilation',
        title: 'Ventilation och luftkvalitet',
        excerpt:
          'Bra ventilation är viktigt för ett hälsosamt inomhusklimat. Så här fungerar det i din lägenhet.',
        content: [
          'Bra ventilation är viktigt för ett hälsosamt inomhusklimat och för att undvika fukt och mögel.',
          'Våra fastigheter har mekanisk eller självdragsventilation. Se till att ventiler inte blockeras av möbler eller prylar.',
          'Vädra gärna regelbundet genom att öppna fönstret helt i 5–10 minuter, särskilt i sovrum och badrum.',
          'Om du misstänker att ventilationen inte fungerar som den ska, gör en felanmälan så att vi kan undersöka saken.',
        ],
      },
    ],
  },
  {
    id: '2',
    slug: 'varme',
    title: 'Värme',
    icon: 'Flame',
    description: 'Hur värmesystemet fungerar och vad du gör om det är för kallt eller varmt.',
    articles: [
      {
        id: '2-1',
        slug: 'hur-värmen-fungerar',
        title: 'Så fungerar värmesystemet',
        excerpt:
          'El, vatten och värme ingår i hyran. Så här är värmesystemet uppbyggt i våra fastigheter.',
        content: [
          'El, vatten och värme ingår i hyran för samtliga Vibo Fastigheters lägenheter och lokaler.',
          'Värmesystemet är inställt för att hålla en behaglig och jämn temperatur i lägenheten. Termostater på elementen reglerar temperaturen per rum.',
          'För att spara energi och hålla en jämn temperatur: håll dörrar öppna mellan rum så att värmen kan sprida sig, och undvik att täcka över elementen med möbler eller gardiner.',
        ],
      },
      {
        id: '2-2',
        slug: 'for-kallt-eller-varmt',
        title: 'Det är för kallt eller för varmt – vad gör jag?',
        excerpt:
          'Steg för steg: vad du själv kan göra och när du ska felanmäla.',
        content: [
          'Om det är för kallt:',
          '1. Kontrollera att termostaten på elementet är öppen och inte stängd.',
          '2. Se till att inga möbler eller gardiner blockerar elementen.',
          '3. Mät temperaturen enligt anvisningarna under "Inomhusmiljö".',
          '4. Om temperaturen fortfarande är för låg – gör en felanmälan.',
          'Om det är för varmt:',
          '1. Sänk termostaten på elementet.',
          '2. Vädra genom att öppna fönstret helt i 5–10 minuter.',
          '3. Om problemet kvarstår – kontakta oss.',
        ],
      },
    ],
  },
  {
    id: '3',
    slug: 'vatten-och-el',
    title: 'Vatten & El',
    icon: 'Zap',
    description: 'Vattenavstängning, elavbrott och andra tekniska frågor.',
    articles: [
      {
        id: '3-1',
        slug: 'vattenavbrott',
        title: 'Vattenavbrott eller läcka',
        excerpt:
          'Vad du gör om vattnet plötsligt försvinner eller om du upptäcker en läcka.',
        content: [
          'Om vattnet försvinner:',
          'Kontrollera om det är ett allmänt avbrott i området. Hör med grannar eller kontakta kommunen.',
          'Om du upptäcker en läcka:',
          '1. Stäng av huvudkranen i din lägenhet omedelbart.',
          '2. Kontakta oss via felanmälan eller journumret vid akuta läckor.',
          '3. Flytta värdeföremål och möbler bort från vattnet om möjligt.',
        ],
      },
      {
        id: '3-2',
        slug: 'elavbrott',
        title: 'Elavbrott i lägenheten',
        excerpt:
          'Vad du gör om strömmen försvinner och hur du säkerställer säkerheten.',
        content: [
          'Vid elavbrott:',
          '1. Kontrollera proppsäkringen i din lägenhet. Om en säkring har löst ut, försök återställa den.',
          '2. Kontrollera om det är ett allmänt strömavbrott i området.',
          '3. Om problemet kvarstår – kontakta oss via felanmälan.',
          'Vid akuta elproblem utanför kontorstid, ring journumret: 010-214 61 10.',
        ],
      },
    ],
  },
  {
    id: '4',
    slug: 'nycklar-och-utlasning',
    title: 'Nycklar & Utlåsning',
    icon: 'Key',
    description: 'Tappat nycklar, låst dig ute eller behöver extra nyckel?',
    articles: [
      {
        id: '4-1',
        slug: 'ar-du-utelast',
        title: 'Har du låst dig ute?',
        excerpt:
          'Så här gör du om du har låst dig ute från din lägenhet – kontorstid och jour.',
        content: [
          'Om du har låst dig ute från din lägenhet kan du få hjälp på följande sätt:',
          'Kontorstid (vardagar kl. 7.00–16.00):',
          'Ring 010-214 61 10 eller mejla kontakt@vibofast.se.',
          'Journummer (övrig tid):',
          'Ring 010-214 61 10.',
          'Observera att om din låscylinder behöver bytas står du som hyresgäst själv för kostnaden.',
        ],
      },
      {
        id: '4-2',
        slug: 'tappade-nycklar',
        title: 'Tappade eller extra nycklar',
        excerpt:
          'Vad du gör om du har tappat en nyckel eller behöver en extra nyckel.',
        content: [
          'Har du tappat en nyckel?',
          'Kontakta oss omedelbart så att vi kan byta låscylinder om det behövs. Detta för din och dina grannars säkerhet.',
          'Behöver du en extra nyckel?',
          'Kontakta oss under kontorstid så hjälper vi dig. En extra nyckel kan medföra en mindre avgift.',
        ],
      },
    ],
  },
  {
    id: '5',
    slug: 'inflyttning',
    title: 'Inflyttning',
    icon: 'LogIn',
    description: 'Allt du behöver veta innan du flyttar in hos Vibo.',
    articles: [
      {
        id: '5-1',
        slug: 'innan-du-flyttar-in',
        title: 'Innan du flyttar in – checklista',
        excerpt:
          'Stort grattis till din nya bostad! Här är vad du behöver ordna innan inflyttningen.',
        content: [
          'Stort grattis till din nya bostad! Inför en flytt finns det en del att tänka på. Här är en checklista för att hjälpa dig på väg:',
          '1. Teckna hemförsäkring – det är ett krav för att hyra hos oss.',
          '2. Gör en adressändran hos Skatteverket i god tid innan flytt.',
          '3. Skicka in flyttanmälan till din nuvarande hyresvärd om du har en.',
          '4. Beställ flyttkartonger och börja packa i tid.',
          '5. Boka flytthjälp om du behöver.',
          '6. Avtal och nyckelutlämning sker i samband med inflyttningen. Du får mer information från oss när tiden närmar sig.',
          '7. Skapa ett konto i hyresgästportalen på app.vi-hem.se så kan du hantera din lägenhet, göra felanmälan, boka tvättider och chatta med oss.',
        ],
      },
      {
        id: '5-2',
        slug: 'nyckel-och-avtal',
        title: 'Nyckelutlämning och avtal',
        excerpt:
          'Hur det går till när du hämtar nycklar och skriver under ditt hyresavtal.',
        content: [
          'I samband med inflyttningen får du nycklar till din nya bostad och skriver under ditt hyresavtal.',
          'Du får information om tid och plats för nyckelutlämning från oss i god tid innan inflyttning.',
          'Kom ihåg att ta med legitimation vid nyckelutlämningen.',
        ],
      },
    ],
  },
  {
    id: '6',
    slug: 'utflyttning',
    title: 'Utflyttning',
    icon: 'LogOut',
    description: 'När det är dags att flytta – vad du behöver veta och göra.',
    articles: [
      {
        id: '6-1',
        slug: 'checklista-utflyttning',
        title: 'Checklista för utflyttning',
        excerpt:
          'Se till att all utrustning finns på plats och att lägenheten är välstädad.',
        content: [
          'När det är dags att flytta från din lägenhet finns det några saker du behöver tänka på:',
          '1. Säg upp din lägenhet i hyresgästportalen på app.vi-hem.se i god tid innan flytt.',
          '2. Se till att all utrustning som hör till lägenheten finns på plats, t.ex. hatthylla, gardinbeslag och innerdörrar.',
          '3. Lägg inte heltäckande mattor över parkett – ta bort dem innan utflyttning.',
          '4. Lägenheten ska vara välstädad och tömd vid utflyttning.',
          '5. Lämna tillbaka alla nycklar till oss.',
          '6. Gör en flyttanmälan till Skatteverket.',
          '7. Avsluta ditt elavtal om du har ett separat sådant.',
          'Om du är osäker på vad som gäller, kontakta oss i god tid innan flytt så hjälper vi dig.',
        ],
      },
    ],
  },
  {
    id: '7',
    slug: 'felanmalan-och-jour',
    title: 'Felanmälan & Jour',
    icon: 'Wrench',
    description: 'Hur du felanmäler och når oss vid akuta problem.',
    articles: [
      {
        id: '7-1',
        slug: 'gor-en-felanmalan',
        title: 'Så gör du en felanmälan',
        excerpt:
          'Vid fel i din lägenhet eller fastighet – så här anmäler du det till oss.',
        content: [
          'Om du upptäcker ett fel i din lägenhet eller i fastigheten ska du göra en felanmälan så snabbt som möjligt.',
          'Felanmälan gör du enklast i vår hyresgästportal på app.vi-hem.se. Där kan du beskriva felet, bifoga bilder och följa status på din anmälan.',
          'Du kan också ringa 010-214 61 10 eller mejla kontakt@vibofast.se under kontorstid (vardagar kl. 7.00–16.00).',
          'Akut felanmälan utanför kontorstid:',
          'Ring journumret 010-214 61 10. Exempel på akuta fel: vattenläcka, strömavbrott, uppvärmning som inte fungerar vintertid, eller skador som utgör en säkerhetsrisk.',
          'Mindre fel som inte kräver omedelbar åtgärd anmäls lämpligast via app.vi-hem.se eller under kontorstid.',
        ],
      },
      {
        id: '7-2',
        slug: 'jourinformation',
        title: 'Jourinformation',
        excerpt:
          'Vid akuta problem utanför kontorstid – så når du oss.',
        content: [
          'Kontorstid (vardagar kl. 7.00–16.00):',
          'Ring 010-214 61 10 eller mejla kontakt@vibofast.se.',
          'Journummer (övrig tid):',
          'Ring 010-214 61 10.',
          'Jour gäller endast för akuta ärenden som inte kan vänta till nästa vardag. Exempel: vattenläcka, elementfel på vintern, hissfel, eller fara för person eller egendom.',
          'För icke-akuta ärenden vänligen använd hyresgästportalen på app.vi-hem.se eller vänta till kontorstid.',
        ],
      },
    ],
  },
  {
    id: '8',
    slug: 'hyra-och-betalning',
    title: 'Hyra & Betalning',
    icon: 'CreditCard',
    description: 'Frågor om hyra, fakturor, autogiro och betalningsterminer.',
    articles: [
      {
        id: '8-1',
        slug: 'hur-betalar-jag-hyran',
        title: 'Hur betalar jag hyran?',
        excerpt:
          'Information om betalningssätt, autogiro och fakturor.',
        content: [
          'Hyran betalas månadsvis i förskott. Du får en hyresavin som betalas senast sista vardagen månaden före förfallodagen.',
          'Betalningssätt:',
          '• Autogiro – rekommenderas för smidig betalning varje månad.',
          '• Bankgiro eller plusgiro – se din hyresavin för aktuellt nummer.',
          'Du kan också hantera din hyra och betalningar via hyresgästportalen på app.vi-hem.se.',
          'Om du har frågor om din faktura eller betalning, kontakta oss under kontorstid.',
        ],
      },
      {
        id: '8-2',
        slug: 'ungdomsrabatt',
        title: 'Ungdomsrabatt',
        excerpt:
          'Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.',
        content: [
          'Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.',
          'Rabatten dras av automatiskt om du uppfyller ålderskravet vid avtalstillfället.',
          'För frågor om ungdomsrabatt, kontakta oss under kontorstid.',
        ],
      },
    ],
  },
  {
    id: '8b',
    slug: 'hyresgastportalen',
    title: 'Hyresgästportalen (VI-HEM)',
    icon: 'Smartphone',
    description: 'Hantera din lägenhet, felanmälan, tvättider och chatt – allt på app.vi-hem.se.',
    articles: [
      {
        id: '8b-1',
        slug: 'kom-igang-med-vi-hem',
        title: 'Kom igång med VI-HEM',
        excerpt:
          'I hyresgästportalen på app.vi-hem.se hanterar du din lägenhet, felanmälan, tvättider och chattar med oss.',
        content: [
          'Som hyresgäst hos Vibo Fastigheter har du tillgång till hyresgästportalen på app.vi-hem.se. Där kan du:',
          '• Administrera din lägenhet och dina uppgifter',
          '• Göra felanmälan och följa status',
          '• Säger upp din lägenhet vid flytt',
          '• Boka tvättider',
          '• Chatta direkt med oss vid frågor',
          'Har du inte fått inbjudan eller har problem att logga in? Kontakta oss under kontorstid så hjälper vi dig.',
        ],
      },
      {
        id: '8b-2',
        slug: 'boka-tvattider',
        title: 'Boka tvättider',
        excerpt:
          'I hyresgästportalen på app.vi-hem.se bokar du tvättider i tvättstugan.',
        content: [
          'Tvättider bokas via hyresgästportalen på app.vi-hem.se. Där ser du tillgängliga tider och kan boka det som passar dig.',
          'Tänk på att hålla tiden du bokat och städa upp efter dig i tvättstugan så att nästa hyresgäst får det trivsligt.',
          'Har du problem att boka eller inte ser några lediga tider? Kontakta oss under kontorstid.',
        ],
      },
    ],
  },
  {
    id: '9',
    slug: 'vanliga-fragor',
    title: 'Vanliga frågor',
    icon: 'HelpCircle',
    description: 'Bra att veta om att bo hos Vibo Fastigheter.',
    articles: [
      {
        id: '9-1',
        slug: 'rökforbud',
        title: 'Rökförbud i lägenheter och lokaler',
        excerpt:
          'I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning.',
        content: [
          'I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning.',
          'Detta gäller både cigaretter, vattenpipa, e-cigaretter och liknande. Förbudet gäller i både lägenhet och på allmänna ytor i fastigheten.',
          'Om du har frågor om rökförbudet, kontakta oss gärna.',
        ],
      },
      {
        id: '9-2',
        slug: 'husdjur',
        title: 'Husdjur i lägenheten',
        excerpt:
          'Regler kring husdjur i våra lägenheter.',
        content: [
          'Husdjur är välkomna i våra lägenheter. Som djurägare ansvarar du för att ditt djur inte stör grannar eller skadar lägenheten.',
          'Tänk på att hundar ska rastas utomhus och att kattsand inte får spolas i toaletten.',
          'Om du har frågor om husdjur, kontakta oss.',
        ],
      },
      {
        id: '9-3',
        slug: 'uthyrningspolicy',
        title: 'Vår uthyrningspolicy',
        excerpt:
          'Vi söker skötsamma hyresgäster som visar hänsyn till bostaden och sina grannar.',
        content: [
          'Vi söker skötsamma hyresgäster som visar hänsyn till både bostaden och sina grannar.',
          'En individuell prövning görs i varje enskilt fall och du behöver uppfylla vissa grundläggande krav för att kunna hyra bostad hos oss.',
          'För frågor om vår uthyrningspolicy, kontakta oss under kontorstid.',
        ],
      },
    ],
  },
];

export function getFaqCategoryBySlug(slug: string): FaqCategory | undefined {
  return faqCategories.find((c) => c.slug === slug);
}

export function getFaqArticleBySlug(
  categorySlug: string,
  articleSlug: string,
): { category: FaqCategory; article: FaqArticle } | undefined {
  const category = getFaqCategoryBySlug(categorySlug);
  if (!category) return undefined;
  const article = category.articles.find((a) => a.slug === articleSlug);
  if (!article) return undefined;
  return { category, article };
}

export function getAllFaqArticles(): {
  category: FaqCategory;
  article: FaqArticle;
}[] {
  return faqCategories.flatMap((category) =>
    category.articles.map((article) => ({ category, article })),
  );
}

export function setFaqCategories(value: typeof faqCategories) { faqCategories = value; }
