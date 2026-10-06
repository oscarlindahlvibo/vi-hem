import { CmsText, CmsValue } from '@/lib/site-content';
import { Heart, Trees, ShieldCheck, Sparkles, Phone, Mail, MapPin, Clock } from 'lucide-react';
import { navigate } from '@/lib/router';
import { PropertyImage } from '@/components/PropertyImage';
import { company } from '@/data/company';

export function AboutPage() {
  return (
    <div className="animate-fade-in pt-20">
      {/* Hero */}
      <section className="relative overflow-hidden bg-forest-950 py-20">
        <div className="container-page">
          <p className="section-eyebrow text-sand-300"><CmsText id="AboutPage.45b9f35e0a" fallback="Om oss" /></p>
          <h1 className="mt-2 max-w-3xl font-serif text-4xl font-semibold text-sand-50 sm:text-5xl"><CmsText id="AboutPage.7fbab71c7e" fallback="Här börjar din hemlängtan" /></h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-sand-200">
            {company.description}
          </p>
        </div>
      </section>

      {/* Values */}
      <section className="container-page py-20">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: Heart,
              title: 'Trivsel i fokus',
              desc: 'Vi vill att du ska trivas – i ditt hem, i huset, med grannarna, gården och samhället.',
            },
            {
              icon: Trees,
              title: 'Naturnära boende',
              desc: 'Våra fastigheter ligger i lugna områden med nära till natur, service och kommunikationer.',
            },
            {
              icon: ShieldCheck,
              title: 'Tryggt boende',
              desc: 'Vi söker skötsamma hyresgäster och skapar trygga, välunderhållna boendemiljöer.',
            },
            {
              icon: Sparkles,
              title: 'Fräscht & renoverat',
              desc: 'Vi håller våra fastigheter och lägenheter välunderhållna och fräscha.',
            },
          ].map((value, i) => (
            <div key={i} className="card p-6">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-forest-100">
                <value.icon className="h-6 w-6 text-forest-700" />
              </div>
              <h3 className="mt-4 font-serif text-lg font-semibold text-forest-900">
                <CmsValue fallback={value.title} />
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-forest-600">
                {value.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Image + text */}
      <section className="bg-sand-100 py-20">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <div className="overflow-hidden rounded-2xl">
            <PropertyImage
              src="https://vibofast.se/wp-content/uploads/2025/08/IMG_6076-2-1240x720.jpeg"
              alt="Vibo Fastigheter – fastighetsbild"
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="section-eyebrow"><CmsText id="AboutPage.b4aec6ef15" fallback="Vårt område" /></p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl">
              {company.areas[0].name}
            </h2>
            <p className="mt-6 leading-relaxed text-forest-700">
              {company.areas[0].description}
            </p>
            <div className="mt-6 space-y-2 text-sm text-forest-700">
              <p className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-accent-600" /><CmsText id="AboutPage.da6015e908" fallback="Smidiga pendlingsavstånd till Hultsfred, Vetlanda, Vimmerby, Oskarshamn, Växjö och Kalmar" /></p>
            </div>
          </div>
        </div>
      </section>

      {/* Policies */}
      <section className="container-page py-20">
        <p className="section-eyebrow"><CmsText id="AboutPage.e30784aef3" fallback="Bra att veta" /></p>
        <h2 className="mt-2 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl"><CmsText id="AboutPage.dcec646912" fallback="Våra riktlinjer" /></h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {[
            { title: 'Uthyrningspolicy', desc: company.policies.rental },
            { title: 'Ungdomsrabatt', desc: company.policies.youthDiscount },
            { title: 'Rökförbud', desc: company.policies.smoking },
            { title: 'Hyresgästportal', desc: 'Som hyresgäst hanterar du din lägenhet, felanmälan, tvättider och chatt med oss via app.vi-hem.se. Hyresvillkor – vad som ingår i hyran – varierar från objekt till objekt. Se respektive objekt för vad som ingår.' },
          ].map((policy, i) => (
            <div key={i} className="rounded-2xl bg-sand-100 p-6">
              <h3 className="font-serif text-lg font-semibold text-forest-900">
                {policy.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-forest-700">
                {policy.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section className="bg-forest-950 py-20">
        <div className="container-page">
          <div className="grid gap-8 lg:grid-cols-4">
            <div>
              <Phone className="h-6 w-6 text-sand-300" />
              <p className="mt-3 text-sm font-semibold text-sand-50"><CmsText id="AboutPage.40314f8828" fallback="Telefon" /></p>
              <a
                href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                className="text-sm text-sand-200 hover:text-sand-50"
              >
                {company.phone}
              </a>
            </div>
            <div>
              <Mail className="h-6 w-6 text-sand-300" />
              <p className="mt-3 text-sm font-semibold text-sand-50"><CmsText id="AboutPage.b3418c9716" fallback="E-post" /></p>
              <a
                href={`mailto:${company.email}`}
                className="text-sm text-sand-200 hover:text-sand-50"
              >
                {company.email}
              </a>
            </div>
            <div>
              <MapPin className="h-6 w-6 text-sand-300" />
              <p className="mt-3 text-sm font-semibold text-sand-50"><CmsText id="AboutPage.5c09a76d96" fallback="Adress" /></p>
              <p className="text-sm text-sand-200">
                {company.address.street}
                <br />
                {company.address.postalCode} {company.address.city}
              </p>
            </div>
            <div>
              <Clock className="h-6 w-6 text-sand-300" />
              <p className="mt-3 text-sm font-semibold text-sand-50"><CmsText id="AboutPage.a09a0b25a0" fallback="Öppettider" /></p>
              <p className="text-sm text-sand-200">{company.officeHours}</p>
              <p className="text-sm text-sand-300"><CmsText id="AboutPage.176aeaea00" fallback="Jour:" />{company.emergencyPhone}</p>
            </div>
          </div>
          <button
            onClick={() => navigate('/kontakt')}
            className="btn-accent mt-10"
          ><CmsText id="AboutPage.62b77380fe" fallback="Kontakta oss" /></button>
        </div>
      </section>
    </div>
  );
}
