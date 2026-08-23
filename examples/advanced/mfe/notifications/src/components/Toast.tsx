import type { FC } from 'react';
import React from 'react';

import type { TopicPayloads } from '@hedwig-demo/contracts';

import styles from './Toast.module.css';

type Kind = TopicPayloads['notification.show.v1']['kind'];

type Props = {
  kind: Kind;
  title: string;
  body?: string;
  onDismiss: () => void;
};

const KIND_LABEL: Record<Kind, string> = {
  success: 'Успех',
  info: 'Инфо',
  warn: 'Внимание',
  error: 'Ошибка',
};

export const Toast: FC<Props> = ({ kind, title, body, onDismiss }) => {
  return (
    <div
      role="status"
      className={`${styles.toast} ${styles[`kind_${kind}`] ?? ''}`}
    >
      <span className={styles.eyebrow}>{KIND_LABEL[kind]}</span>
      <div className={styles.title}>{title}</div>
      {body ? <div className={styles.body}>{body}</div> : null}
      <button
        type="button"
        aria-label="Закрыть"
        className={styles.close}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
};
