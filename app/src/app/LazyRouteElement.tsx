import { Suspense, type ComponentType, type LazyExoticComponent, type ReactElement } from 'react';

export function lazyRouteElement(
  Component: LazyExoticComponent<ComponentType>,
): ReactElement {
  return (
    <Suspense fallback={<div role="status" aria-live="polite">正在加载页面…</div>}>
      <Component />
    </Suspense>
  );
}