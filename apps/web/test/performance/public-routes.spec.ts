import { expect, test } from '@playwright/test';

const budgets = {
  cumulativeLayoutShift: 0.1,
  decodedResourceBytes: 2_500_000,
  domContentLoadedMilliseconds: 2_500,
  largestContentfulPaintMilliseconds: 2_500,
  resourceCount: 60,
  timeToFirstByteMilliseconds: 800,
} as const;

const publicRoutes = [
  { name: 'login', path: '/login' },
  { name: 'privacy notice', path: '/privacy' },
] as const;

for (const route of publicRoutes) {
  test(`${route.name} stays inside the public web performance budgets`, async ({
    page,
  }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' });

    await page.addInitScript(() => {
      const metrics = {
        cumulativeLayoutShift: 0,
        largestContentfulPaintMilliseconds: 0,
      };

      Object.defineProperty(window, '__crewflowPerformanceMetrics', {
        configurable: true,
        value: metrics,
      });

      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          const layoutShift = entry as PerformanceEntry & {
            hadRecentInput?: boolean;
            value?: number;
          };
          if (!layoutShift.hadRecentInput) {
            metrics.cumulativeLayoutShift += layoutShift.value ?? 0;
          }
        }
      }).observe({ buffered: true, type: 'layout-shift' });

      new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const latestEntry = entries.at(-1);
        if (latestEntry) {
          metrics.largestContentfulPaintMilliseconds = latestEntry.startTime;
        }
      }).observe({ buffered: true, type: 'largest-contentful-paint' });
    });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const metrics = await page.evaluate(() => {
      const navigation = performance.getEntriesByType(
        'navigation',
      )[0] as PerformanceNavigationTiming;
      const resources = performance.getEntriesByType(
        'resource',
      ) as PerformanceResourceTiming[];
      const observed = (
        window as Window & {
          __crewflowPerformanceMetrics?: {
            cumulativeLayoutShift: number;
            largestContentfulPaintMilliseconds: number;
          };
        }
      ).__crewflowPerformanceMetrics;

      return {
        cumulativeLayoutShift: observed?.cumulativeLayoutShift ?? 0,
        decodedResourceBytes: resources.reduce(
          (total, resource) => total + resource.decodedBodySize,
          0,
        ),
        domContentLoadedMilliseconds: navigation.domContentLoadedEventEnd,
        largestContentfulPaintMilliseconds:
          observed?.largestContentfulPaintMilliseconds ?? 0,
        resourceCount: resources.length,
        timeToFirstByteMilliseconds: navigation.responseStart,
      };
    });

    expect(
      metrics.timeToFirstByteMilliseconds,
      JSON.stringify(metrics),
    ).toBeLessThanOrEqual(budgets.timeToFirstByteMilliseconds);
    expect(
      metrics.domContentLoadedMilliseconds,
      JSON.stringify(metrics),
    ).toBeLessThanOrEqual(budgets.domContentLoadedMilliseconds);
    expect(
      metrics.largestContentfulPaintMilliseconds,
      JSON.stringify(metrics),
    ).toBeGreaterThan(0);
    expect(
      metrics.largestContentfulPaintMilliseconds,
      JSON.stringify(metrics),
    ).toBeLessThanOrEqual(budgets.largestContentfulPaintMilliseconds);
    expect(
      metrics.cumulativeLayoutShift,
      JSON.stringify(metrics),
    ).toBeLessThanOrEqual(budgets.cumulativeLayoutShift);
    expect(
      metrics.decodedResourceBytes,
      JSON.stringify(metrics),
    ).toBeLessThanOrEqual(budgets.decodedResourceBytes);
    expect(metrics.resourceCount, JSON.stringify(metrics)).toBeLessThanOrEqual(
      budgets.resourceCount,
    );
  });
}
