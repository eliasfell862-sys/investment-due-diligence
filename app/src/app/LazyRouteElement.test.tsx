import { act, render, screen } from '@testing-library/react';
import { lazy, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { lazyRouteElement } from './LazyRouteElement';

describe('lazyRouteElement', () => {
  it('shows a loading state until the route module resolves', async () => {
    let resolveModule!: (value: { default: ComponentType }) => void;
    const LazyPage = lazy(() => new Promise<{ default: ComponentType }>(resolve => { resolveModule = resolve; }));

    render(lazyRouteElement(LazyPage));
    expect(screen.getByRole('status')).toHaveTextContent('正在加载页面…');

    await act(async () => {
      resolveModule({ default: () => <h1>证券页面</h1> });
    });
    expect(await screen.findByRole('heading', { name: '证券页面' })).toBeInTheDocument();
  });
});