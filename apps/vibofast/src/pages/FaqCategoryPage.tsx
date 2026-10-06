import { CmsText } from '@/lib/site-content';
import * as Icons from '@/lib/faq-icons';
import { Link, navigate } from '@/lib/router';
import { faqCategories, getFaqCategoryBySlug } from '@/data/faq';

export function FaqCategoryPage({ slug }: { slug: string }) {
  const category = getFaqCategoryBySlug(slug);

  if (!category) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center pt-20">
        <p className="font-serif text-2xl font-semibold text-forest-900"><CmsText id="FaqCategoryPage.1454881772" fallback="Kategorin hittades inte" /></p>
        <button
          onClick={() => navigate('/for-hyresgaster')}
          className="btn-primary mt-6"
        ><CmsText id="FaqCategoryPage.b119e787e8" fallback="Tillbaka till kunskapsbanken" /></button>
      </div>
    );
  }

  const Icon =
    Icons.categoryIcons[category.icon] ||
    Icons.FileText;

  return (
    <div className="animate-fade-in pt-20">
      <section className="bg-forest-950 py-16">
        <div className="container-page">
          <button
            onClick={() => navigate('/for-hyresgaster')}
            className="flex items-center gap-2 text-sm font-medium text-sand-300 hover:text-sand-50"
          >
            <Icons.ArrowLeft className="h-4 w-4" /><CmsText id="FaqCategoryPage.b119e787e8" fallback="Tillbaka till kunskapsbanken" /></button>
          <div className="mt-6 flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-forest-800">
              <Icon className="h-7 w-7 text-sand-200" />
            </div>
            <div>
              <h1 className="font-serif text-3xl font-semibold text-sand-50 sm:text-4xl">
                {category.title}
              </h1>
              <p className="mt-1 text-sand-200">{category.description}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="container-page py-12">
        <div className="grid gap-4">
          {category.articles.map((article) => (
            <Link
              key={article.id}
              to={`/for-hyresgaster/${category.slug}/${article.slug}`}
              className="card group flex items-start gap-4 p-6"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-forest-100 transition-colors group-hover:bg-forest-900">
                <Icons.FileText className="h-5 w-5 text-forest-700 transition-colors group-hover:text-sand-50" />
              </div>
              <div className="flex-1">
                <h2 className="font-serif text-lg font-semibold text-forest-900 group-hover:text-accent-600">
                  {article.title}
                </h2>
                <p className="mt-1 text-sm text-forest-600">{article.excerpt}</p>
              </div>
              <Icons.ChevronRight className="mt-1 h-5 w-5 text-forest-400 transition-transform group-hover:translate-x-1 group-hover:text-forest-700" />
            </Link>
          ))}
        </div>

        {/* Other categories */}
        <div className="mt-16">
          <h2 className="font-serif text-xl font-semibold text-forest-900"><CmsText id="FaqCategoryPage.bf623c04f6" fallback="Andra kategorier" /></h2>
          <div className="mt-6 flex flex-wrap gap-3">
            {faqCategories
              .filter((c) => c.id !== category.id)
              .map((c) => {
                const OtherIcon =
                  Icons.categoryIcons[
                    c.icon
                  ] || Icons.FileText;
                return (
                  <Link
                    key={c.id}
                    to={`/for-hyresgaster/${c.slug}`}
                    className="flex items-center gap-2 rounded-full bg-sand-100 px-4 py-2 text-sm font-medium text-forest-700 transition-colors hover:bg-sand-200"
                  >
                    <OtherIcon className="h-4 w-4" />
                    {c.title}
                  </Link>
                );
              })}
          </div>
        </div>
      </section>
    </div>
  );
}
