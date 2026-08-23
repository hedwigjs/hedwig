import type { AiClient } from './AiClient';

type CannedReply = {
  match: RegExp;
  text: string;
};

/**
 * Canonical replies for the demo. Matched in order — first hit wins.
 * The fallback (last entry) always matches.
 */
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
  return CANNED[CANNED.length - 1].text;
}

/**
 * Splits a reply into tokens (short groups of characters) so streaming
 * looks like a real LLM stream instead of char-by-char scrolling. Groups
 * of 2–5 chars, respecting whitespace boundaries.
 */
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * MockAiClient — local canned-reply streamer.
 *
 * Same async-iterable contract that a real SseAiClient will satisfy.
 * When we wire the SSE backend, only this class gets swapped.
 */
export class MockAiClient implements AiClient {
  async *ask(text: string, signal?: AbortSignal): AsyncIterable<string> {
    const reply = pickReply(text);
    const tokens = tokenize(reply);

    // Small "thinking" delay before the first chunk arrives.
    await sleep(180, signal);

    for (const token of tokens) {
      if (signal?.aborted) return;
      yield token;
      await sleep(28 + Math.random() * 22, signal);
    }
  }
}
