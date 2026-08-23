import type { Express, Request, Response } from 'express';

type CannedReply = {
  match: RegExp;
  text: string;
};

const CANNED: CannedReply[] = [
  {
    match: /(привет|здравств|hi\b|hello)/i,
    text: 'Привет! Я AI-консьерж Hedwig Café. Помогу с выбором блюд, подскажу что взять к чаю или что заказать на компанию. О чём подумаем?',
  },
  {
    match: /(рекоменд|посовет|что.*(взять|заказ|попроб))/i,
    text: 'Сегодня свежий рамен и хачапури по-аджарски — оба стабильно уходят в топ. Из закусок берите хумус ливанский, отлично идёт с лепёшкой. Если готовы к сытному — шашлык из куриного бедра.',
  },
  {
    match: /(паста|салат|грече)/i,
    text: 'К пасте гости часто берут греческий салат и мутабаль. Если хочется поярче — попробуйте свекольный хумус, он отлично балансирует основное блюдо.',
  },
  {
    match: /(остр|перец|мяс|шашлык)/i,
    text: 'Из мясного порекомендую шашлык из куриного бедра или хинкали с телятиной. Оба сытные, порции щедрые, специй в меру.',
  },
  {
    match: /(сколько|цен|стои|бюджет)/i,
    text: 'Средний чек на двоих — 2 500–3 500 ₽. Если хочется бюджетнее, обратите внимание на хумус, фалафель, мухаммару и чебурек — вкусно и небольшой чек.',
  },
  {
    match: /(вегетар|веган|без.*мяс)/i,
    text: 'Из вегетарианского — хумус (ливанский или свекольный), мутабаль, бабагануш, фалафель с тахини, паста из авокадо. Плюс греческий салат с фетой.',
  },
  {
    match: /(на.*компан|для.*(гостей|друз))/i,
    text: 'На компанию беру микс из мезе — хумус, мутабаль, мухаммара — плюс горячее вроде хачапури и шашлыка. Порций на 4-6 человек хватит с запасом.',
  },
  {
    match: /.*/,
    text: 'Могу помочь с выбором блюд, посоветовать под настроение или подобрать под ваш бюджет. Спросите, например: «что порекомендуешь на двоих?» или «что взять к пасте?».',
  },
];

function pickReply(prompt: string): string {
  for (const { match, text } of CANNED) {
    if (match.test(prompt)) return text;
  }
  return CANNED[CANNED.length - 1]!.text;
}

function tokenize(text: string): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const size = 2 + Math.floor(Math.random() * 4);
    chunks.push(text.slice(i, i + size));
    i += size;
  }
  return chunks;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function writeSse(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function handleStream(req: Request, res: Response): Promise<void> {
  const prompt =
    typeof req.body?.prompt === 'string'
      ? req.body.prompt
      : typeof req.query?.prompt === 'string'
        ? (req.query.prompt as string)
        : '';

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const reply = pickReply(prompt);
  const tokens = tokenize(reply);
  const replyId = `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  let aborted = false;
  // `req.on('close')` в Node 15+ триггерится и когда body-parser дочитал тело,
  // поэтому на POST-стриме использовать его нельзя — падаем ложно после `start`.
  // Слушаем `res.on('close')` — он стреляет только когда клиент реально отвалился.
  res.on('close', () => {
    aborted = true;
  });

  writeSse(res, 'start', { replyId });

  await sleep(180);
  if (aborted) return;

  for (const token of tokens) {
    if (aborted) return;
    writeSse(res, 'chunk', { replyId, chunk: token });
    await sleep(28 + Math.random() * 22);
  }

  if (aborted) return;
  writeSse(res, 'done', { replyId, fullText: reply });
  res.end();
}

export function registerAiRoutes(app: Express): void {
  app.post('/ai/stream', (req, res) => {
    void handleStream(req, res);
  });
  // GET-вариант удобен для быстрой проверки в браузере / EventSource.
  app.get('/ai/stream', (req, res) => {
    void handleStream(req, res);
  });
}
