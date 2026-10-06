import { CmsText } from '@/lib/site-content';
import { useState, useMemo } from 'react';
import * as Icons from '@/lib/faq-icons';
import { Link } from '@/lib/router';
import { faqCategories, getAllFaqArticles } from '@/data/faq';

export function FaqPage() {
  const [search, setSearch] = useState('');
  const allArticles = useMemo(() => getAllFaqArticles(), []);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return allArticles.filter(
      ({ article, category }) =>
        article.title.toLowerCase().includes(q) ||
        article.excerpt.toLowerCase().includes(q) ||
        category.title.toLowerCase().includes(q),
    );
  }, [search, allArticles]);

  return (
    <div className="animate-fade-in pt-20">
      {/* Header */}
      <section className="bg-forest-950 py-16">
        <div className="container-page">
          <p className="section-eyebrow text-sand-300"><CmsText id="FaqPage.63dc4907b4" fallback="För hyresgäster" /></p>
          <h1 className="mt-2 font-serif text-4xl font-semibold text-sand-50 sm:text-5xl"><CmsText id="FaqPage.27360ba855" fallback="Kunskapsbank" /></h1>
          <p className="mt-4 max-w-xl text-sand-200"><CmsText id="FaqPage.a67404a045" fallback="Här hittar du svar på vanliga frågor om boende, inomhusmiljö, felanmälan, inflyttning, utflyttning och mer." /></p>

          {/* Search */}
          <div className="mt-8 max-w-xl">
            <div className="relative">
              <Icons.Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-forest-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Sök i kunskapsbanken..."
                className="w-full rounded-full border border-forest-700 bg-forest-900 py-3 pl-12 pr-4 text-sm text-sand-50 placeholder:text-forest-400 focus:border-accent-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Content */}
      <section className="container-page py-12">
        {filtered ? (
          /* Search results */
          <div>
            <p className="mb-6 text-sm text-forest-600">
              {filtered.length} {filtered.length === 1 ? 'resultat' : 'resultat'}{' '}<CmsText id="FaqPage.98314fa41b" fallback={'för "'} />{search}"
            </p>
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Icons.Search className="h-12 w-12 text-forest-300" />
                <p className="mt-4 text-lg font-medium text-forest-700"><CmsText id="FaqPage.c1edb38835" fallback="Inga resultat hittades" /></p>
                <p className="mt-1 text-sm text-forest-500"><CmsText id="FaqPage.2afc3de9d2" fallback="Prova ett annat sökord." /></p>
              </div>
            ) : (
              <div className="grid gap-4">
                {filtered.map(({ category, article }) => {
                  const Icon =
                    Icons.categoryIcons[
                      category.icon
                    ] || Icons.FileText;
                  return (
                    <Link
                      key={article.id}
                      to={`/for-hyresgaster/${category.slug}/${article.slug}`}
                      className="card flex items-start gap-4 p-5"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-forest-100">
                        <Icon className="h-5 w-5 text-forest-700" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-accent-600">
                          {category.title}
                        </p>
                        <p className="mt-1 font-serif text-base font-semibold text-forest-900">
                          {article.title}
                        </p>
                        <p className="mt-1 text-sm text-forest-600">
                          {article.excerpt}
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          /* Categories */
          <div>
            <h2 className="font-serif text-2xl font-semibold text-forest-900"><CmsText id="FaqPage.4a115ad69c" fallback="Kategorier" /></h2>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {faqCategories.map((category) => {
                const Icon =
                  Icons.categoryIcons[
                    category.icon
                  ] || Icons.FileText;
                return (
                  <Link
                    key={category.id}
                    to={`/for-hyresgaster/${category.slug}`}
                    className="card group flex flex-col p-6"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-forest-100 transition-colors group-hover:bg-forest-900">
                      <Icon className="h-6 w-6 text-forest-700 transition-colors group-hover:text-sand-50" />
                    </div>
                    <h3 className="mt-4 font-serif text-lg font-semibold text-forest-900">
                      {category.title}
                    </h3>
                    <p className="mt-1 flex-1 text-sm text-forest-600">
                      {category.description}
                    </p>
                    <p className="mt-4 flex items-center gap-1.5 text-sm font-medium text-forest-700 transition-colors group-hover:text-accent-600">
                      {category.articles.length}{' '}
                      {category.articles.length === 1 ? 'artikel' : 'artiklar'}
                      <Icons.ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
