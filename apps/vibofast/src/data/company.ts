export let company = {
  name: 'Vibo Fastigheter',
  legalName: 'Vibogruppen AB',
  tagline: 'Här börjar din hemlängtan',
  description:
    'Vibo Fastigheter hyr ut lägenheter, lokaler, kontor, lager och förråd i Virserum och omnejd. Vi vill att du ska trivas hos oss – i ditt hem, i huset, med grannarna, gården och samhället. Varje dag jobbar vi med att skapa trivsel och hålla det rent och snyggt i våra områden.',
  phone: '010-214 61 10',
  phoneMobile: '010-214 61 12',
  email: 'kontakt@vibofast.se',
  contactPerson: {
    name: 'Christofer Sakshaug',
    email: 'christofer@vibofast.se',
    phone: '010-214 61 10',
    mobile: '010-214 61 12',
  },
  officeHours: 'Vardagar kl. 7.00–16.00',
  emergencyPhone: '010-214 61 10',
  address: {
    street: 'Ekängsvägen 1',
    postalCode: '577 72',
    city: 'Virserum',
    region: 'Hultsfreds kommun',
    county: 'Kalmar län',
    country: 'Sverige',
  },
  viHemUrl: 'https://app.vi-hem.se',
  areas: [
    {
      name: 'Virserum',
      description:
        'Virserum är en tätort i Hultsfreds kommun, Kalmar län, med omkring 2 000 invånare. Orten ligger vackert vid Virserumsviken vid Emåns dalgång och erbjuder en lugn och naturnära miljö med god tillgång till service, skola och natur.',
    },
  ],
  policies: {
    rental:
      'Vi söker skötsamma hyresgäster som visar hänsyn till både bostaden och sina grannar. En individuell prövning görs i varje enskilt fall och du behöver uppfylla vissa grundläggande krav för att kunna hyra bostad hos oss.',
    youthDiscount:
      'Vi erbjuder 10 procent rabatt på hyran till ungdomar under 25 år.',
    smoking:
      'I samtliga Vibo Fastigheters lägenheter och lokaler råder förbud mot rökning.',
  },
};

export function setCompany(value: typeof company) { company = value; }
