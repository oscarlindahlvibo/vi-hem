import { submitEnquiry } from '@/lib/supabase';
import { CmsText } from '@/lib/site-content';
import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, Send, CheckCircle } from 'lucide-react';
import { company } from '@/data/company';

export function ContactPage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    subject: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true); setError('');
    try { await submitEnquiry('contact', form); setSubmitted(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Kunde inte skicka.'); }
    finally { setSending(false); }
  };

  return (
    <div className="animate-fade-in pt-20">
      {/* Header */}
      <section className="bg-forest-950 py-16">
        <div className="container-page">
          <p className="section-eyebrow text-sand-300"><CmsText id="ContactPage.a92b9bcb16" fallback="Kontakt" /></p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-sand-50 sm:text-5xl"><CmsText id="ContactPage.62b77380fe" fallback="Kontakta oss" /></h1>
          <p className="mt-4 max-w-xl text-sand-200"><CmsText id="ContactPage.27b8752c01" fallback="Har du frågor om våra objekt eller vill du boka en visning? Vi finns här för att hjälpa dig." /></p>
        </div>
      </section>

      {/* Contact info + form */}
      <section className="container-page py-12">
        <div className="grid gap-10 lg:grid-cols-3">
          {/* Info */}
          <div className="lg:col-span-1">
            <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="ContactPage.0f8a0b6bb7" fallback="Kontaktuppgifter" /></h2>
            <div className="mt-6 space-y-5">
              <a
                href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                className="flex items-start gap-4 rounded-xl bg-sand-100 p-4 transition-colors hover:bg-sand-200"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-900">
                  <Phone className="h-5 w-5 text-sand-50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-forest-900"><CmsText id="ContactPage.40314f8828" fallback="Telefon" /></p>
                  <p className="text-sm text-forest-600">{company.phone}</p>
                </div>
              </a>

              <a
                href={`mailto:${company.email}`}
                className="flex items-start gap-4 rounded-xl bg-sand-100 p-4 transition-colors hover:bg-sand-200"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-900">
                  <Mail className="h-5 w-5 text-sand-50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-forest-900"><CmsText id="ContactPage.b3418c9716" fallback="E-post" /></p>
                  <p className="text-sm text-forest-600">{company.email}</p>
                </div>
              </a>

              <div className="flex items-start gap-4 rounded-xl bg-sand-100 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-900">
                  <MapPin className="h-5 w-5 text-sand-50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-forest-900"><CmsText id="ContactPage.5c09a76d96" fallback="Adress" /></p>
                  <p className="text-sm text-forest-600">
                    {company.address.street}
                    <br />
                    {company.address.postalCode} {company.address.city}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-4 rounded-xl bg-sand-100 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-forest-900">
                  <Clock className="h-5 w-5 text-sand-50" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-forest-900"><CmsText id="ContactPage.a09a0b25a0" fallback="Öppettider" /></p>
                  <p className="text-sm text-forest-600">{company.officeHours}</p>
                  <p className="text-sm text-forest-500"><CmsText id="ContactPage.176aeaea00" fallback="Jour:" />{company.emergencyPhone}
                  </p>
                </div>
              </div>
            </div>

            {/* Contact person */}
            <div className="mt-6 rounded-2xl bg-forest-950 p-6">
              <p className="text-sm font-semibold text-sand-50"><CmsText id="ContactPage.dff2ebf8bf" fallback="Kontaktperson" /></p>
              <div className="mt-3 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-forest-800 font-serif text-sm font-semibold text-sand-50">
                  {company.contactPerson.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-medium text-sand-50">
                    {company.contactPerson.name}
                  </p>
                  <a
                    href={`mailto:${company.contactPerson.email}`}
                    className="text-xs text-sand-300 hover:text-sand-50"
                  >
                    {company.contactPerson.email}
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-2">
            <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sand-200 sm:p-8">
              {submitted ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle className="h-16 w-16 text-success-500" />
                  <h3 className="mt-4 font-serif text-2xl font-semibold text-forest-900"><CmsText id="ContactPage.9479657649" fallback="Tack för ditt meddelande!" /></h3>
                  <p className="mt-2 text-sm text-forest-600"><CmsText id="ContactPage.42254ef3ab" fallback="Vi återkommer till dig så snart vi kan." /></p>
                  <button
                    onClick={() => {
                      setSubmitted(false);
                      setForm({
                        name: '',
                        email: '',
                        phone: '',
                        subject: '',
                        message: '',
                      });
                    }}
                    className="btn-secondary mt-6"
                  ><CmsText id="ContactPage.a460647035" fallback="Skicka ett till meddelande" /></button>
                </div>
              ) : (
                <>
                  <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="ContactPage.1f458cb267" fallback="Skicka ett meddelande" /></h2>
                  <p className="mt-1 text-sm text-forest-600"><CmsText id="ContactPage.68a2d213f5" fallback="Fyll i formuläret så återkommer vi till dig." /></p>
                  <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-forest-800"><CmsText id="ContactPage.dc35d12a94" fallback="Namn *" /></label>
                        <input
                          type="text"
                          required
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                          className="input-field mt-1"
                          placeholder="Ditt namn"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-forest-800"><CmsText id="ContactPage.67c9566ba2" fallback="E-post *" /></label>
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) =>
                            setForm({ ...form, email: e.target.value })
                          }
                          className="input-field mt-1"
                          placeholder="din@email.se"
                        />
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium text-forest-800"><CmsText id="ContactPage.40314f8828" fallback="Telefon" /></label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) =>
                            setForm({ ...form, phone: e.target.value })
                          }
                          className="input-field mt-1"
                          placeholder="Ditt telefonnummer"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium text-forest-800"><CmsText id="ContactPage.21678bcf45" fallback="Ämne" /></label>
                        <input
                          type="text"
                          value={form.subject}
                          onChange={(e) =>
                            setForm({ ...form, subject: e.target.value })
                          }
                          className="input-field mt-1"
                          placeholder="Vad gäller det?"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="ContactPage.a4e2bd6217" fallback="Meddelande *" /></label>
                      <textarea
                        required
                        rows={5}
                        value={form.message}
                        onChange={(e) =>
                          setForm({ ...form, message: e.target.value })
                        }
                        className="input-field mt-1 resize-none"
                        placeholder="Skriv ditt meddelande här..."
                      />
                    </div>
                    {error && <p role="alert" className="text-red-700">{error}</p>}
                  <button disabled={sending} type="submit" className="btn-primary w-full sm:w-auto">
                      <Send className="h-4 w-4" /><CmsText id="ContactPage.1f51ec1b5b" fallback="Skicka meddelande" /></button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
