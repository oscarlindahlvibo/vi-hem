import { Children, cloneElement, isValidElement, useLayoutEffect, useRef, type ReactNode } from 'react';

// One-pixel grid rows let each card reserve its own height. Dense placement
// fills the shorter column instead of making every card wait for a shared row.
function MeasuredCard({ children, wide }: { children: ReactNode; wide: boolean }) {
  const slot = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = content.current;
    const container = slot.current;
    if (!element || !container) return;
    const measure = () => {
      container.style.gridRowEnd = `span ${Math.max(1, Math.ceil(element.getBoundingClientRect().height + 24))}`;
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={slot} className={`contents lg:block lg:min-w-0 lg:self-start ${wide ? 'lg:col-span-2' : ''}`}>
      <div ref={content} className="contents lg:block lg:min-w-0 lg:[&>*]:w-full">{children}</div>
    </div>
  );
}

export function DashboardCards({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-w-0 max-w-full grid-cols-1 gap-3 sm:gap-6 lg:auto-rows-[1px] lg:grid-flow-dense lg:grid-cols-2 lg:gap-y-0">
      {Children.toArray(children).map((child, index) => {
        if (isValidElement<{ className?: string; children?: ReactNode; 'data-dashboard-group'?: boolean }>(child) && child.props['data-dashboard-group']) {
          return cloneElement(child, { className: `${child.props.className || ''} lg:contents` },
            Children.toArray(child.props.children).map((card, cardIndex) => (
              <MeasuredCard key={isValidElement(card) ? card.key ?? cardIndex : cardIndex} wide={false}>{card}</MeasuredCard>
            )));
        }
        const wide = isValidElement<{ className?: string }>(child) && Boolean(child.props.className?.includes('lg:col-span-2'));
        return <MeasuredCard key={isValidElement(child) ? child.key ?? index : index} wide={wide}>{child}</MeasuredCard>;
      })}
    </div>
  );
}
