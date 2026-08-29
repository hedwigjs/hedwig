import type { Express, Request, Response } from 'express';

type CheckoutItem = {
  itemId: number;
  name: string;
  price: string;
  quantity: number;
};

type CheckoutBody = {
  items?: CheckoutItem[];
  totalPrice?: number;
};

function newOrderId(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `A-${stamp}-${rand}`;
}

type Lang = 'en' | 'ru';

const HTML_STRINGS: Record<Lang, Record<string, string>> = {
  en: {
    lang: 'en',
    title: 'Hedwig Checkout',
    h1: 'Order payment',
    lead: "Test form. Data goes nowhere except this local backend.",
    labelCard: 'Card number',
    labelName: 'Cardholder',
    submit: 'Confirm payment',
    statusA: 'Order',
    statusB: 'accepted. Status:',
  },
  ru: {
    lang: 'ru',
    title: 'Hedwig Checkout',
    h1: 'Оплата заказа',
    lead: "Тестовая форма. Данные никуда не уходят, кроме локального backend'а.",
    labelCard: 'Номер карты',
    labelName: 'Держатель',
    submit: 'Подтвердить оплату',
    statusA: 'Заказ',
    statusB: 'принят. Статус:',
  },
};

function pickLang(raw: unknown): Lang {
  return raw === 'ru' ? 'ru' : 'en';
}

const iframeHtml = (lang: Lang): string => {
  const s = HTML_STRINGS[lang];
  return `<!DOCTYPE html>
<html lang="${s.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${s.title}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600&display=swap" />
  <style>
    :root {
      --bg: #fbf7f0;
      --field-bg: #f2ece1;
      --ink: #1a1613;
      --ink-muted: #6b5f55;
      --line: #e2d6c4;
      --accent: #7a1f1f;
      --accent-hover: #941f1f;
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      min-height: 100%;
      background: var(--bg);
      color: var(--ink);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 24px 28px 28px;
    }
    .eyebrow {
      font-size: 0.7rem;
      letter-spacing: 0.22em;
      text-transform: uppercase;
      color: var(--ink-muted);
    }
    h1 {
      font-family: 'Fraunces', Georgia, serif;
      font-weight: 500;
      font-size: 1.9rem;
      letter-spacing: -0.025em;
      margin: 6px 0 4px;
      line-height: 1.05;
    }
    .lead {
      color: var(--ink-muted);
      font-size: 0.92rem;
      margin: 0 0 18px;
      max-width: 520px;
    }
    .row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .row label {
      font-size: 0.72rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--ink-muted);
    }
    .row input {
      width: 100%;
      padding: 12px 14px;
      background: var(--field-bg);
      border: 1px solid var(--line);
      border-radius: 10px;
      font: inherit;
      color: var(--ink);
      outline: none;
      transition: border-color .18s ease, background .18s ease;
    }
    .row input:focus {
      border-color: var(--ink);
      background: #fff;
    }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    button {
      width: 100%;
      padding: 14px;
      margin-top: 6px;
      border: none;
      border-radius: 10px;
      background: var(--accent);
      color: var(--bg);
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 500;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background .18s ease, transform .15s ease;
    }
    button:hover { background: var(--accent-hover); transform: translateY(-1px); }
    .foot {
      margin-top: 14px;
      font-size: 0.72rem;
      color: var(--ink-muted);
    }
    .foot code { font-family: ui-monospace, monospace; color: var(--ink); }
    .status {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--field-bg);
      border: 1px solid var(--line);
      font-size: 0.86rem;
      color: var(--ink);
      display: none;
    }
    .status.on { display: block; }
    .status em { font-family: 'Fraunces', Georgia, serif; font-style: italic; color: var(--accent); }
  </style>
</head>
<body>
  <span class="eyebrow">Hedwig Checkout · iframe</span>
  <h1>${s.h1}</h1>
  <p class="lead">${s.lead}</p>

  <form id="f">
    <div class="row">
      <label for="card">${s.labelCard}</label>
      <input id="card" value="4242 4242 4242 4242" inputmode="numeric" />
    </div>
    <div class="grid">
      <div class="row">
        <label for="exp">MM / YY</label>
        <input id="exp" value="12 / 28" />
      </div>
      <div class="row">
        <label for="cvv">CVV</label>
        <input id="cvv" value="123" inputmode="numeric" />
      </div>
    </div>
    <div class="row">
      <label for="name">${s.labelName}</label>
      <input id="name" value="IVAN IVANOV" />
    </div>
    <button type="submit">${s.submit}</button>
  </form>

  <div id="status" class="status"></div>
  <div class="foot">iframe origin: <code id="origin"></code></div>

  <script>
    document.getElementById('origin').textContent = location.origin;
    const form = document.getElementById('f');
    const status = document.getElementById('status');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      // Relative — resolves to the iframe's own path (/checkout in dev,
      // /demo/advanced/checkout in prod). Keeps the backend URL-prefix-agnostic.
      const res = await fetch('checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: [], totalPrice: 0 }),
      });
      const data = await res.json();
      status.classList.add('on');
      status.innerHTML = '${s.statusA} <em>' + data.orderId + '</em> ${s.statusB} ' + data.status + '.';
      // Отправляем через postMessage в форме broker Message'а — на parent'е
      // висит @hedwigjs/broker bridge с PostMessageTransport, он подхватит
      // и заинжектит в шину. Iframe не запускает свой broker — только
      // формирует конверт нужной формы.
      window.parent?.postMessage(
        {
          id: 'checkout-iframe-' + data.orderId,
          topic: 'checkout.completed.v1',
          source: 'checkout-iframe',
          target: '*',
          data: data,
          timestamp: Date.now(),
        },
        '*',
      );
    });
  </script>
</body>
</html>`;
};

export function registerCheckoutRoutes(app: Express): void {
  app.get('/checkout', (req, res) => {
    const lang = pickLang(req.query?.lang);
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(iframeHtml(lang));
  });

  app.post('/checkout', (req: Request<unknown, unknown, CheckoutBody>, res: Response) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const totalPrice = Number(req.body?.totalPrice ?? 0);
    const orderId = newOrderId();

    // eslint-disable-next-line no-console
    console.log(
      `[checkout] order=${orderId} items=${items.length} total=${totalPrice}`,
    );

    res.json({
      ok: true,
      orderId,
      status: 'accepted',
      items,
      totalPrice,
      acceptedAt: Date.now(),
    });
  });
}
