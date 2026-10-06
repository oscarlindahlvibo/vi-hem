import { ListingState } from '@/components/ListingState';
import { CmsText, CmsValue } from '@/lib/site-content';
import { useState } from 'react';
import {
  ArrowRight,
  MapPin,
  Phone,
  Mail,
  Wrench,
  Heart,
  Trees,
  ShieldCheck,
  Sparkles,
  Quote,
} from 'lucide-react';
import { Link, navigate } from '@/lib/router';
import { PropertyCard } from '@/components/PropertyCard';
import { PropertyImage } from '@/components/PropertyImage';
import { getFeaturedProperties } from '@/data/properties';
import { company } from '@/data/company';

export function HomePage() {
  const featured = getFeaturedProperties();

  return (
    <div className="animate-fade-in">
      {/* Hero */}
      <section className="relative min-h-[90vh] overflow-hidden">
        <div className="absolute inset-0">
          <PropertyImage
            src="https://vibofast.se/wp-content/uploads/2025/08/IMG_6075-2-1240x720.jpeg"
            alt="Vibo Fastigheter – hemlängtan"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-forest-950/80 via-forest-950/50 to-forest-950/20" />
        </div>

        <div className="container-page relative flex min-h-[90vh] items-center">
          <div className="max-w-2xl py-32">
            <p className="section-eyebrow text-sand-200">
              {company.tagline}
            </p>
            <h1 className="mt-4 font-serif text-4xl font-semibold text-sand-50 text-balance sm:text-5xl lg:text-6xl"><CmsText id="HomePage.afb8b334a4" fallback="Hitta ditt drömhem hos oss" /></h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-sand-100"><CmsText id="HomePage.7f2c3a5f63" fallback="Vi hyr ut lägenheter, lokaler och förråd i Virserum och omnejd. Låt oss hjälpa dig i jakten på ditt drömboende." /></p>
            <div className="mt-8 flex flex-wrap gap-4">
              <button
                onClick={() => navigate('/lediga-objekt')}
                className="inline-flex items-center gap-2 rounded-full bg-sand-50 px-6 py-3 text-sm font-semibold text-forest-900 transition-all hover:bg-white hover:shadow-xl active:scale-95"
              ><CmsText id="HomePage.15e66f68f7" fallback="Se lediga objekt" /><ArrowRight className="h-4 w-4" />
              </button>
              <button
                onClick={() => navigate('/intresseanmalan')}
                className="inline-flex items-center gap-2 rounded-full border border-sand-200/40 bg-transparent px-6 py-3 text-sm font-semibold text-sand-50 transition-all hover:bg-forest-800/50 active:scale-95"
              ><CmsText id="HomePage.1bfd74a74b" fallback="Intresseanmälan" /></button>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-forest-800/30 bg-forest-950/40 backdrop-blur-sm">
          <div className="container-page grid grid-cols-2 divide-x divide-forest-800/30 lg:grid-cols-4">
            {[
              { label: 'Lägenheter & lokaler', value: 'I Virserum' },
              { label: 'Ungdomsrabatt', value: '10% under 25 år' },
              { label: 'Hyresgästportal', value: 'app.vi-hem.se' },
              { label: 'Rökfritt', value: 'Alla lägenheter' },
            ].map((stat, i) => (
              <div key={i} className="px-4 py-5 text-center sm:px-6">
                <p className="font-serif text-lg font-semibold text-sand-50">
                  <CmsValue fallback={stat.value} />
                </p>
                <p className="mt-1 text-xs text-sand-200"><CmsValue fallback={stat.label} /></p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured properties */}
      <section className="container-page py-20"><ListingState />
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="section-eyebrow"><CmsText id="HomePage.8e1ff837de" fallback="Lediga objekt" /></p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl"><CmsText id="HomePage.5bbc716fb9" fallback="Aktuella bostäder och lokaler" /></h2>
          </div>
          <Link
            to="/lediga-objekt"
            className="flex items-center gap-1.5 text-sm font-semibold text-forest-700 hover:text-accent-600"
          ><CmsText id="HomePage.6cd45430eb" fallback="Visa alla objekt" /><ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        {featured.length === 0 && <p className="mt-8 text-forest-600">Inga annonser att visa just nu. Välkommen att kontakta oss eller lämna en intresseanmälan.</p>}
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((property) => (
            <PropertyCard key={property.id} property={property} />
          ))}
        </div>
      </section>

      {/* About teaser */}
      <section className="bg-forest-950 py-20">
        <div className="container-page grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="section-eyebrow text-sand-300"><CmsText id="HomePage.d5635ea698" fallback="Hemma hos oss" /></p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-sand-50 sm:text-4xl"><CmsText id="HomePage.b71f449df3" fallback="Vi vill att du ska trivas" /></h2>
            <p className="mt-6 text-lg leading-relaxed text-sand-200"><CmsText id="HomePage.5caa0ac610" fallback="Vi vill att du ska trivas hos oss – i ditt hem, i huset, med grannarna, gården och samhället. Varje dag jobbar vi med att skapa trivsel och hålla det rent och snyggt i våra områden." /></p>
            <div className="mt-8 grid grid-cols-2 gap-4">
              {[
                { icon: Heart, title: 'Trivsel', desc: 'Vi skapar boenden där människor trivs' },
                { icon: Trees, title: 'Naturnära', desc: 'Lugna områden med närhet till natur' },
                { icon: ShieldCheck, title: 'Säkerhet', desc: 'Skötsamma områden och tryggt boende' },
                { icon: Sparkles, title: 'Fräscht & renoverat', desc: 'Välunderhållna fastigheter och lägenheter' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-800">
                    <item.icon className="h-5 w-5 text-sand-200" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-sand-50">
                      <CmsValue fallback={item.title} />
                    </p>
                    <p className="text-xs text-sand-300"><CmsValue fallback={item.desc} /></p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => navigate('/om-oss')}
              className="mt-8 inline-flex items-center gap-2 rounded-full border border-sand-200/30 px-6 py-3 text-sm font-semibold text-sand-50 transition-all hover:bg-forest-800"
            ><CmsText id="HomePage.5e592d0629" fallback="Läs mer om oss" /><ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-2xl">
              <PropertyImage
                src="https://vibofast.se/wp-content/uploads/2025/08/IMG_6057-2-1240x720.jpeg"
                alt="Vibo Fastigheter – boende i Virserum"
                className="h-full w-full object-cover"
              />
            </div>
            <div className="absolute -bottom-6 -left-6 hidden rounded-2xl bg-sand-50 p-6 shadow-xl sm:block">
              <Quote className="h-8 w-8 text-accent-500" />
              <p className="mt-2 max-w-xs font-serif text-sm italic text-forest-800"><CmsText id="HomePage.a9bf300e2f" fallback="Ett hus byggs av väggar och bjälkar, ett hem byggs av kärlek och drömmar." /></p>
            </div>
          </div>
        </div>
      </section>

      {/* Area section */}
      <section className="container-page py-20">
        <div className="rounded-3xl bg-gradient-to-br from-forest-50 to-sand-100 p-8 sm:p-12">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <p className="section-eyebrow"><CmsText id="HomePage.b4aec6ef15" fallback="Vårt område" /></p>
              <h2 className="mt-2 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl"><CmsText id="HomePage.c581d44d60" fallback="Virserum – naturnära boende" /></h2>
              <p className="mt-6 leading-relaxed text-forest-700">
                {company.areas[0]?.description ?? ''}
              </p>
              <div className="mt-6 space-y-2 text-sm text-forest-700">
                {[
                  'Upplyst naturstig: 2 min promenad',
                  'ICA och Coop: 10 min gång',
                  'Apotek och vårdcentral: 15 min gång',
                  'Förskola Evahagen: 5 min gång',
                ].map((item, i) => (
                  <p key={i} className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-accent-600" />
                    <CmsValue fallback={item} />
                  </p>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl">
              <PropertyImage
                src="https://vibofast.se/wp-content/uploads/2025/08/IMG_1812-3-1240x720.jpeg"
                alt="Virserum – område"
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ teaser */}
      <section className="bg-sand-100 py-20">
        <div className="container-page">
          <div className="mx-auto max-w-3xl text-center">
            <p className="section-eyebrow"><CmsText id="HomePage.63dc4907b4" fallback="För hyresgäster" /></p>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-forest-900 sm:text-4xl"><CmsText id="HomePage.2e425eb9a3" fallback="Kunskapsbank för dig som bor hos oss" /></h2>
            <p className="mt-4 text-forest-700"><CmsText id="HomePage.94081665a8" fallback="Här hittar du svar på vanliga frågor om inomhusmiljö, inflyttning, felanmälan, jour och mycket mer." /></p>
            <button
              onClick={() => navigate('/for-hyresgaster')}
              className="btn-primary mt-8"
            ><CmsText id="HomePage.0121a5c5fd" fallback="Till kunskapsbanken" /><ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Wrench, title: 'Felanmälan & Jour', desc: 'Via app.vi-hem.se eller telefon' },
              { icon: Heart, title: 'Inflyttning', desc: 'Allt du behöver veta innan flytt' },
              { icon: Sparkles, title: 'Inomhusmiljö', desc: 'Temperatur, ventilation och klimat' },
            ].map((item, i) => (
              <button
                key={i}
                onClick={() => navigate('/for-hyresgaster')}
                className="card flex items-start gap-4 p-6 text-left"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-forest-100">
                  <item.icon className="h-5 w-5 text-forest-700" />
                </div>
                <div>
                  <p className="font-serif text-base font-semibold text-forest-900">
                    <CmsValue fallback={item.title} />
                  </p>
                  <p className="text-sm text-forest-600"><CmsValue fallback={item.desc} /></p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="container-page py-20">
        <div className="overflow-hidden rounded-3xl bg-forest-900 px-8 py-12 sm:px-12 sm:py-16">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <h2 className="font-serif text-3xl font-semibold text-sand-50 sm:text-4xl"><CmsText id="HomePage.c7930da748" fallback="Det har aldrig varit enklare att hitta din nästa lägenhet" /></h2>
              <p className="mt-4 text-sand-200"><CmsText id="HomePage.3e7e367ad4" fallback="Vi har ett stort utbud av lägenheter och lokaler och hjälper dig gärna hitta just ditt drömboende." /></p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:justify-end">
              <a
                href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-sand-50 px-6 py-3 text-sm font-semibold text-forest-900 transition-all hover:bg-white hover:shadow-xl"
              >
                <Phone className="h-4 w-4" />
                {company.phone}
              </a>
              <a
                href={`mailto:${company.email}`}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-sand-200/30 px-6 py-3 text-sm font-semibold text-sand-50 transition-all hover:bg-forest-800"
              >
                <Mail className="h-4 w-4" />
                {company.email}
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
