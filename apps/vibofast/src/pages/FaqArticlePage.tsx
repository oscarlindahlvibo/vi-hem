import { CmsText } from '@/lib/site-content';
import * as Icons from '@/lib/faq-icons';
import { Link, navigate } from '@/lib/router';
import { getFaqArticleBySlug } from '@/data/faq';
import { company } from '@/data/company';

export function FaqArticlePage({
  categorySlug,
  articleSlug,
}: {
  categorySlug: string;
  articleSlug: string;
}) {
  const result = getFaqArticleBySlug(categorySlug, articleSlug);

  if (!result) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center pt-20">
        <p className="font-serif text-2xl font-semibold text-forest-900"><CmsText id="FaqArticlePage.3432369bee" fallback="Artikeln hittades inte" /></p>
        <button
          onClick={() => navigate('/for-hyresgaster')}
          className="btn-primary mt-6"
        ><CmsText id="FaqArticlePage.b119e787e8" fallback="Tillbaka till kunskapsbanken" /></button>
      </div>
    );
  }

  const { category, article } = result;
  const Icon =
    Icons.categoryIcons[category.icon] ||
    Icons.FileText;

  return (
    <div className="animate-fade-in pt-20">
      <section className="bg-forest-950 py-12">
        <div className="container-page">
          <div className="flex items-center gap-2 text-sm">
            <Link
              to="/for-hyresgaster"
              className="text-sand-300 hover:text-sand-50"
            ><CmsText id="FaqArticlePage.27360ba855" fallback="Kunskapsbank" /></Link>
            <Icons.ChevronRight className="h-4 w-4 text-sand-400" />
            <Link
              to={`/for-hyresgaster/${category.slug}`}
              className="text-sand-300 hover:text-sand-50"
            >
              {category.title}
            </Link>
          </div>
          <div className="mt-6 flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-forest-800">
              <Icon className="h-6 w-6 text-sand-200" />
            </div>
            <p className="text-sm font-medium uppercase tracking-wider text-accent-400">
              {category.title}
            </p>
          </div>
          <h1 className="mt-4 font-serif text-3xl font-semibold text-sand-50 sm:text-4xl">
            {article.title}
          </h1>
        </div>
      </section>

      <section className="container-page py-12">
        <div className="mx-auto max-w-3xl">
          <p className="text-lg leading-relaxed text-forest-700">
            {article.excerpt}
          </p>
          <div className="mt-8 space-y-4">
            {article.content.map((para, i) => (
              <p
                key={i}
                className="whitespace-pre-line leading-relaxed text-forest-700"
              >
                {para}
              </p>
            ))}
          </div>

          {/* Help CTA */}
          <div className="mt-12 rounded-2xl bg-sand-100 p-6">
            <h3 className="font-serif text-lg font-semibold text-forest-900"><CmsText id="FaqArticlePage.29e5bdc4f4" fallback="Behöver du mer hjälp?" /></h3>
            <p className="mt-2 text-sm text-forest-600"><CmsText id="FaqArticlePage.56788d455a" fallback="Som hyresgäst kan du hantera din lägenhet, felanmälan, tvättider och chatta med oss i hyresgästportalen." /></p>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={company.viHemUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent"
              >
                <Icons.ExternalLink className="h-4 w-4" /><CmsText id="FaqArticlePage.59ba9896a8" fallback="app.vi-hem.se" /></a>
              <a
                href={`tel:${company.phone.replace(/[\s-]/g, '')}`}
                className="btn-primary"
              >
                <Icons.Phone className="h-4 w-4" />
                {company.phone}
              </a>
              <a
                href={`mailto:${company.email}`}
                className="btn-secondary"
              >
                <Icons.Mail className="h-4 w-4" />
                {company.email}
              </a>
            </div>
          </div>

          {/* Back to category */}
          <div className="mt-8">
            <Link
              to={`/for-hyresgaster/${category.slug}`}
              className="flex items-center gap-2 text-sm font-medium text-forest-700 hover:text-accent-600"
            >
              <Icons.ArrowLeft className="h-4 w-4" /><CmsText id="FaqArticlePage.615ffdd0a2" fallback="Tillbaka till" />{category.title}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
