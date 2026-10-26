import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const publicRoutes = [
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
  { name: 'password recovery', path: '/forgot-password' },
  { name: 'privacy notice', path: '/privacy' },
] as const;

for (const route of publicRoutes) {
  test(`${route.name} has no automated WCAG A/AA violations`, async ({
    page,
  }) => {
    await page.goto(route.path);
    await expect(page.locator('main')).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(
      results.violations,
      results.violations
        .map(
          (violation) =>
            `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`,
        )
        .join('\n'),
    ).toEqual([]);
  });
}

test('login journey exposes form controls in keyboard order', async ({
  page,
}) => {
  await page.goto('/login');
  const visited = new Set<string>();

  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return '';
      return [
        element.tagName.toLowerCase(),
        element.getAttribute('name') ?? '',
        element.textContent?.trim() ?? '',
      ].join(':');
    });
    visited.add(focus);
  }

  expect([...visited].some((value) => value.startsWith('input:email:'))).toBe(
    true,
  );
  expect(
    [...visited].some((value) => value.startsWith('input:password:')),
  ).toBe(true);
  expect(
    [...visited].some(
      (value) => value.startsWith('button::') && value.includes('Sign in'),
    ),
  ).toBe(true);
  expect(
    [...visited].some(
      (value) => value.startsWith('a::') && value.includes('Forgot password'),
    ),
  ).toBe(true);
});
