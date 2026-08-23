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

let envelopeSeq = 0;

/**
 * Backend Message shape — matches @hedwigjs/broker Message so the client
 * can inject SSE frames directly via SSETransport + addBridge (see
 * mfe/ai-chat useChat). One SSE `data:` frame == one broker Message.
 * We deliberately do NOT use named `event:` lines — SSETransport
 * multiplexes on the message's own `topic` field, not on the SSE event
 * name.
 */
type Envelope<Topic extends string, Data> = {
  id: string;
  topic: Topic;
  source: 'ai-backend';
  target: '*';
  data: Data;
  timestamp: number;
};

function envelope<Topic extends string, Data>(
  topic: Topic,
  data: Data,
): Envelope<Topic, Data> {
  return {
    id: `ai-backend-${++envelopeSeq}`,
    topic,
    source: 'ai-backend',
    target: '*',
    data,
    timestamp: Date.now(),
  };
}

function writeMessage(res: Response, msg: unknown): void {
  res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

async function handleStream(req: Request, res: Response): Promise<void> {
  const prompt =
    typeof req.body?.prompt === 'string'
      ? req.body.prompt
      : typeof req.query?.prompt === 'string'
        ? (req.query.prompt as string)
        : '';
  const replyId =
    typeof req.query?.replyId === 'string'
      ? (req.query.replyId as string)
      : `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders?.();
  // Хинт для EventSource на случай реконнекта.
  res.write('retry: 3000\n\n');

  const reply = pickReply(prompt);
  const tokens = tokenize(reply);

  let aborted = false;
  res.on('close', () => {
    aborted = true;
  });

  await sleep(180);
  if (aborted) return;

  for (const token of tokens) {
    if (aborted) return;
    writeMessage(res, envelope('chat.reply-chunk.v1', { replyId, chunk: token }));
    await sleep(28 + Math.random() * 22);
  }

  if (aborted) return;
  writeMessage(
    res,
    envelope('chat.reply-completed.v1', { replyId, fullText: reply }),
  );
  res.end();
}

export function registerAiRoutes(app: Express): void {
  app.post('/ai/stream', (req, res) => {
    void handleStream(req, res);
  });
  // GET-вариант — используется браузерным EventSource'ом (единственный
  // способ, у него нет body). Клиент передаёт prompt и replyId в query.
  app.get('/ai/stream', (req, res) => {
    void handleStream(req, res);
  });
}
