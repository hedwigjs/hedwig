import type { FC } from 'react';
import React, { useEffect, useRef } from 'react';

import type { ChatMessage } from '../hooks/useChat';

import styles from './MessageList.module.css';

type Props = {
  messages: ChatMessage[];
  onSuggestionSelect?: (text: string) => void;
  disabled?: boolean;
};

const SUGGESTIONS = [
  'Что порекомендуешь?',
  'Что взять к пасте?',
  'На двоих с бюджетом до 2000 ₽',
];

export const MessageList: FC<Props> = ({ messages, onSuggestionSelect, disabled }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever content changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className={styles.empty}>
        <h3 className={styles.emptyTitle}>
          Чем могу <em>помочь</em>?
        </h3>
        <p className={styles.emptyText}>
          Подскажу, что заказать. Помогу с подбором блюд под ваши предпочтения и бюджет.
        </p>
        <span className={styles.suggestionsLabel}>Идеи запросов</span>
        <div className={styles.suggestions}>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.suggestion}
              disabled={disabled}
              onClick={() => onSuggestionSelect?.(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.scroll} ref={scrollRef}>
      <ul className={styles.list}>
        {messages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === 'user'
                ? `${styles.bubble} ${styles.bubbleUser}`
                : `${styles.bubble} ${styles.bubbleAssistant}`
            }
          >
            {m.text}
            {m.streaming && <span className={styles.cursor} aria-hidden="true" />}
          </li>
        ))}
      </ul>
    </div>
  );
};
