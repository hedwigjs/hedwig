import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The scenarios that were run by hand after every step, now as a suite:
 * cart requests, retained state for a late mount, ACL denials, SSE
 * streaming, WebSocket notifications, the checkout iframe over postMessage,
 * a request to a remote client, cross-tab state over BroadcastChannel, and
 * the DevTools panel. Every check reads what a user sees; a few also read
 * the broker through its realm slot to assert what crossed the wire.
 */

const BROKER_SLOT = "globalThis[Symbol.for('@hedwigjs/broker')].core";

/** Record every delivery result and system event on the page's broker. */
async function instrument(page: Page): Promise<void> {
  await page.evaluate((slot) => {
    const core = new Function(`return ${slot}`)() as {
      useAfterSendHook(fn: (m: Record<string, unknown>, r: Record<string, unknown>) => void): void;
      $systemEvents: { onAny(fn: (name: string, payload: unknown) => void): void };
    };
    const w = window as unknown as { __seen: unknown[]; __events: Array<[string, unknown]> };
    w.__seen = [];
    w.__events = [];
    core.useAfterSendHook((m, r) => {
      w.__seen.push({ topic: m.topic, source: m.source, via: m.via, replayed: !!m.replayed, status: r.status, reason: r.reason, to: r.recipientId });
    });
    core.$systemEvents.onAny((name, payload) => {
      w.__events.push([name, payload]);
    });
  }, BROKER_SLOT);
}

type Seen = { topic: string; source: string; via?: string; replayed: boolean; status: string; reason: string; to?: string };

async function seen(page: Page): Promise<Seen[]> {
  return page.evaluate(() => (window as unknown as { __seen: Seen[] }).__seen);
}

async function events(page: Page): Promise<Array<[string, Record<string, unknown>]>> {
  return page.evaluate(() => (window as unknown as { __events: Array<[string, Record<string, unknown>]> }).__events);
}

async function openStand(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();
  await instrument(page);
}

test.describe('reference stand', () => {
  test('cart requests, retained state and the late-mount card', async ({ page }) => {
    await openStand(page);
    const addButtons = page.getByRole('button', { name: 'Add to cart' });
    await addButtons.nth(0).click();
    await addButtons.nth(1).click();

    const cart = page.getByRole('complementary');
    await expect(cart).toContainText(/2 items/i);

    await cart.getByRole('button', { name: 'MOUNT' }).click();
    // Labels are upper-cased by CSS; the DOM text is what the source wrote.
    await expect(cart).toContainText(/retained/i);
    await expect(cart).toContainText(/total items/i);

    const log = await seen(page);
    expect(log.filter((m) => m.topic === 'cart.add-item.v1').map((m) => m.status)).toEqual(['ACK', 'ACK']);
    expect(log.find((m) => m.replayed && m.to === 'late-mount-demo')).toMatchObject({ topic: 'cart.snapshot.v1', reason: 'REPLAY_DELIVERED' });
  });

  test('ACL denies analytics both on subscribe and on send', async ({ page }) => {
    await openStand(page);
    const cart = page.getByRole('complementary');
    await cart.getByRole('button', { name: "bus.on('cart.snapshot.v1', …)" }).click();
    await cart.getByRole('button', { name: "bus.request('checkout', 'checkout.start.v1', …)" }).click();

    await expect(cart).toContainText("'analytics' is not allowed to subscribe to 'cart.snapshot.v1'");
    await expect(cart).toContainText("HOOK_REJECTED: [ACL] 'analytics' is not allowed to send 'checkout.start.v1'");
    const names = (await events(page)).map(([n]) => n);
    expect(names).toContain('subscription.rejected');
    expect(names).toContain('message.rejected');
  });

  test('AI chat streams over SSE as a per-reply remote client', async ({ page }) => {
    await openStand(page);
    await page.getByRole('button', { name: 'Open AI concierge' }).click();
    const dialog = page.getByRole('dialog', { name: 'AI-concierge' });
    await dialog.getByRole('button', { name: 'What would you recommend?' }).click();
    await expect(dialog).toContainText('khachapuri', { timeout: 20_000 });
    await expect.poll(async () => (await events(page)).some(([n, p]) => n === 'remote.destroyed' && p.remoteId === 'ai-backend')).toBe(true);

    const chunks = (await seen(page)).filter((m) => m.via === 'ai-backend');
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((m) => m.source === 'ai-backend')).toBe(true);
  });

  test('a backend notification over WebSocket arrives as a toast', async ({ page, request }) => {
    await openStand(page);
    const response = await request.post('http://localhost:4000/notify?lang=en', {
      data: { kind: 'info', title: 'E2E notification', body: 'sent by the test' },
    });
    expect(response.ok()).toBe(true);
    await expect(page.getByRole('status')).toContainText('E2E notification');
    const notification = (await seen(page)).find((m) => m.topic === 'notification.show.v1' && m.via === 'notifications-backend');
    expect(notification).toMatchObject({ source: 'notifications-backend', status: 'ACK' });

    // The contract declares `retention: { last: 10 }`, so the frame that came
    // over the WebSocket is kept for subscribers that arrive later.
    const retained = await page.evaluate((slot) => {
      const core = new Function(`return ${slot}`)() as {
        inspect: {
          getHistory(): Array<{ message: { topic: string; data: { title: string }; via?: string } }>;
          getHistoryStats(): { topics: Array<{ topic: string; kind: string; limit: number; count: number }> };
        };
      };
      return {
        titles: core.inspect.getHistory().filter((e) => e.message.topic === 'notification.show.v1').map((e) => e.message.data.title),
        policy: core.inspect.getHistoryStats().topics.find((t) => t.topic === 'notification.show.v1'),
      };
    }, BROKER_SLOT);
    expect(retained.titles).toContain('E2E notification');
    expect(retained.policy).toMatchObject({ kind: 'event', limit: 10 });
  });

  test('a request to the backend over WebSocket is answered', async ({ page }) => {
    await openStand(page);
    // Own card in the right column, separate from the late-mount demo.
    const card = page.locator('[data-slot-host="remote-request"]');
    await card.getByRole('button', { name: 'ASK THE BACKEND' }).click();
    const result = card.locator('[data-demo-remote-request]');
    await expect(result).toHaveAttribute('data-demo-remote-request', 'ACK');
    await expect(result).toContainText('connected clients');

    const names = (await events(page)).map(([n]) => n);
    expect(names).toContain('request.forwarded');
    expect(names).toContain('response.received');
  });

  test('checkout through the iframe: remote client created, completion crosses postMessage, cart cleared', async ({ page }) => {
    await openStand(page);
    await page.getByRole('button', { name: 'Add to cart' }).first().click();
    const cart = page.getByRole('complementary');
    await cart.getByRole('button', { name: 'CHECK OUT' }).click();

    const frame = page.frameLocator('iframe[title="Payment form"]');
    await frame.getByRole('button', { name: 'CONFIRM PAYMENT' }).click();

    await expect(cart).not.toContainText('CHECK OUT');
    await expect(page.getByRole('status')).toContainText('accepted');
    const completed = (await seen(page)).find((m) => m.topic === 'checkout.completed.v1');
    expect(completed).toMatchObject({ source: 'checkout-iframe', via: 'checkout-iframe', status: 'ACK' });
    const remoteEvents = (await events(page)).filter(([n, p]) => n.startsWith('remote.') && p.remoteId === 'checkout-iframe').map(([n]) => n);
    expect(remoteEvents).toEqual(['remote.created', 'remote.destroyed']);
  });

  test('cross-tab: a snapshot from another tab arrives as tab:cart-store via the tabs remote', async ({ page, context }) => {
    await openStand(page);
    const other = await context.newPage();
    await other.goto('/');
    await expect(other.getByRole('button', { name: 'Add to cart' }).first()).toBeVisible();
    await other.getByRole('button', { name: 'Add to cart' }).nth(6).click();

    await expect(page.getByRole('complementary')).toContainText(/1 item/i);
    await expect.poll(async () => (await seen(page)).filter((m) => m.via === 'tabs').length).toBeGreaterThan(0);
    const fromTab = (await seen(page)).find((m) => m.via === 'tabs')!;
    expect(fromTab).toMatchObject({ topic: 'cart.snapshot.v1', source: 'tab:cart-store', status: 'ACK' });

    // The stores converge, not just the pictures: this tab's own store
    // adopted the snapshot, so removing the item here works and travels back.
    await page.getByRole('complementary').getByRole('button', { name: /remove/i }).first().click();
    await expect(page.getByRole('complementary')).toContainText(/cart is empty/i);
    await expect(other.getByRole('complementary')).toContainText(/cart is empty/i);

    // A third tab opening now must not wipe anyone: its boot snapshot is
    // older than everything, so it is answered with the current cart.
    await other.getByRole('button', { name: 'Add to cart' }).nth(2).click();
    await expect(page.getByRole('complementary')).toContainText(/1 item/i);
    const third = await context.newPage();
    await third.goto('/');
    await expect(third.getByRole('complementary')).toContainText(/1 item/i);
    await expect(page.getByRole('complementary')).toContainText(/1 item/i);
    await third.close();
    await other.close();
  });

  test('DevTools panel attaches, lists remote clients and shows topic kinds', async ({ page }) => {
    await openStand(page);
    await page.getByRole('button', { name: 'Open message broker devtools' }).click();
    await expect(page.getByText('@hedwigjs/devtools')).toBeVisible();
    await expect(page.getByText(/^connected$/i).first()).toBeVisible();
    await expect(page.locator('[data-mbdt-version-mismatch]')).toHaveCount(0);

    await page.getByRole('tab', { name: /Clients/ }).click();
    await expect(page.locator('[data-mbdt-remote="websocket"]')).toBeVisible();
    await expect(page.locator('[data-mbdt-remote="broadcast-channel"]')).toBeVisible();

    await page.getByRole('tab', { name: /Messages/ }).click();
    await expect(page.locator('[data-mbdt-kind="state"]').first()).toBeVisible();

    // Replay Buffer shows what the registry declared, with the current fill.
    await page.getByRole('tab', { name: /Replay Buffer/ }).click();
    await expect(page.locator('[data-mbdt-retained="cart.snapshot.v1"]')).toContainText(/1 of 1/);
    await expect(page.locator('[data-mbdt-retained="notification.show.v1"]')).toContainText(/of 10/);
  });
});
