import { submitEnquiry } from '@/lib/supabase';
import { CmsText } from '@/lib/site-content';
import { useState } from 'react';
import { Send, CheckCircle, Home, Calendar, User, Mail, Phone, MapPin } from 'lucide-react';
import { listingTypeLabels } from '@/data/properties';

export function InterestPage() {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    moveInDate: '',
    propertyType: '',
    rooms: '',
    message: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setSending(true); setError('');
    try { await submitEnquiry('interest', form); setSubmitted(true); }
    catch (err) { setError(err instanceof Error ? err.message : 'Kunde inte skicka.'); }
    finally { setSending(false); }
  };

  return (
    <div className="animate-fade-in pt-20">
      <section className="bg-forest-950 py-16">
        <div className="container-page">
          <p className="section-eyebrow text-sand-300"><CmsText id="InterestPage.1bfd74a74b" fallback="Intresseanmälan" /></p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-sand-50 sm:text-5xl"><CmsText id="InterestPage.06903a7d9c" fallback="Lämna din intresseanmälan" /></h1>
          <p className="mt-4 max-w-xl text-sand-200"><CmsText id="InterestPage.716b22b251" fallback="Låt oss veta vad du letar efter så hjälper vi dig att hitta rätt boende. Vi kontaktar dig när vi har något som passar." /></p>
        </div>
      </section>

      <section className="container-page py-12">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-sand-200 sm:p-8">
            {submitted ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle className="h-16 w-16 text-success-500" />
                <h3 className="mt-4 font-serif text-2xl font-semibold text-forest-900"><CmsText id="InterestPage.c318bc4e03" fallback="Tack för din intresseanmälan!" /></h3>
                <p className="mt-2 text-sm text-forest-600"><CmsText id="InterestPage.59aea7f643" fallback="Vi har tagit emot dina uppgifter och återkommer till dig när vi har något som passar dina önskemål." /></p>
              </div>
            ) : (
              <>
                <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="InterestPage.a957e0c4df" fallback="Berätta vad du söker" /></h2>
                <p className="mt-1 text-sm text-forest-600"><CmsText id="InterestPage.0c1b9d1d0f" fallback="Fyll i formuläret så gott du kan – alla fält är inte obligatoriska." /></p>
                <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.dc35d12a94" fallback="Namn *" /></label>
                      <div className="relative mt-1">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <input
                          type="text"
                          required
                          value={form.name}
                          onChange={(e) =>
                            setForm({ ...form, name: e.target.value })
                          }
                          className="input-field pl-10"
                          placeholder="Ditt namn"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.67c9566ba2" fallback="E-post *" /></label>
                      <div className="relative mt-1">
                        <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <input
                          type="email"
                          required
                          value={form.email}
                          onChange={(e) =>
                            setForm({ ...form, email: e.target.value })
                          }
                          className="input-field pl-10"
                          placeholder="din@email.se"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.40314f8828" fallback="Telefon" /></label>
                      <div className="relative mt-1">
                        <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={(e) =>
                            setForm({ ...form, phone: e.target.value })
                          }
                          className="input-field pl-10"
                          placeholder="Ditt telefonnummer"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.33b75acdef" fallback="Hur snart vill du flytta in?" /></label>
                      <div className="relative mt-1">
                        <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <input
                          type="text"
                          value={form.moveInDate}
                          onChange={(e) =>
                            setForm({ ...form, moveInDate: e.target.value })
                          }
                          className="input-field pl-10"
                          placeholder="T.ex. snarast, inom 3 mån"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.228d765ecf" fallback="Typ av objekt" /></label>
                      <div className="relative mt-1">
                        <Home className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <select
                          value={form.propertyType}
                          onChange={(e) =>
                            setForm({ ...form, propertyType: e.target.value })
                          }
                          className="input-field pl-10"
                        >
                          <option value=""><CmsText id="InterestPage.ae2697adfc" fallback="Välj typ" /></option>
                          {Object.entries(listingTypeLabels).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.96c66047ea" fallback="Antal rum" /></label>
                      <div className="relative mt-1">
                        <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-forest-400" />
                        <input
                          type="text"
                          value={form.rooms}
                          onChange={(e) =>
                            setForm({ ...form, rooms: e.target.value })
                          }
                          className="input-field pl-10"
                          placeholder="T.ex. 2 ROK, 3 ROK"
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-forest-800"><CmsText id="InterestPage.614238cfaf" fallback="Övriga önskemål" /></label>
                    <textarea
                      rows={4}
                      value={form.message}
                      onChange={(e) =>
                        setForm({ ...form, message: e.target.value })
                      }
                      className="input-field mt-1 resize-none"
                      placeholder="Beskriv gärna vad du söker för typ av boende, område, särskilda önskemål m.m."
                    />
                  </div>

                  {error && <p role="alert" className="text-red-700">{error}</p>}
                  <button disabled={sending} type="submit" className="btn-primary w-full sm:w-auto">
                    <Send className="h-4 w-4" /><CmsText id="InterestPage.f227ffa1ab" fallback="Skicka intresseanmälan" /></button>
                </form>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
