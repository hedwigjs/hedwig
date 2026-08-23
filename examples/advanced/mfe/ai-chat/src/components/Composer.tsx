import type { FC, FormEvent, KeyboardEvent } from 'react';
import React, { useCallback, useRef, useState } from 'react';

import styles from './Composer.module.css';

type Props = {
  onSend: (text: string) => void | Promise<void>;
  onCancel: () => void;
  isStreaming: boolean;
};

export const Composer: FC<Props> = ({ onSend, onCancel, isStreaming }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, []);

  const submit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (isStreaming) {
        onCancel();
        return;
      }
      const text = value.trim();
      if (!text) return;
      void onSend(text);
      setValue('');
      requestAnimationFrame(autoResize);
    },
    [autoResize, isStreaming, onCancel, onSend, value],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      <textarea
        ref={textareaRef}
        className={styles.input}
        placeholder="Спросить AI-консьержа…"
        value={value}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value);
          autoResize();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="submit"
        className={
          isStreaming
            ? `${styles.button} ${styles.buttonStop}`
            : styles.button
        }
        aria-label={isStreaming ? 'Остановить' : 'Отправить'}
        disabled={!isStreaming && value.trim().length === 0}
      >
        {isStreaming ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
              d="M4 12l16-8-6 16-2-7-8-1z"
              fill="currentColor"
            />
          </svg>
        )}
      </button>
    </form>
  );
};
