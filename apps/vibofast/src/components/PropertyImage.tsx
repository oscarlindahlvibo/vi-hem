import { useContent } from '@/lib/site-content';
import { CmsText } from '@/lib/site-content';
import { useState, useEffect } from 'react';

export function PropertyImage({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const content = useContent();
  src = content['image.' + src] ?? src;
  const [error, setError] = useState(false);

  useEffect(() => setError(false), [src]);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-forest-100 to-forest-200 ${className ?? ''}`}
      >
        <span className="font-serif text-5xl font-semibold text-forest-300"><CmsText id="PropertyImage.c9ee5681d3" fallback="V" /></span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setError(true)}
      className={className}
    />
  );
}
