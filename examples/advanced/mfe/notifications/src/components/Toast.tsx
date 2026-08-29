import type { FC } from 'react';
import React from 'react';

import type { TopicPayloads } from '@hedwig-demo/contracts';

import { getLang } from '../../../../shared/i18n/useLang';

import styles from './Toast.module.css';

type Kind = TopicPayloads['notification.show.v1']['kind'];

type Props = {
  kind: Kind;
  title: string;
  body?: string;
  onDismiss: () => void;
};

const KIND_LABEL: Record<'en' | 'ru', Record<Kind, string>> = {
  en: { success: 'Success', info: 'Info', warn: 'Notice', error: 'Error' },
  ru: { success: 'Успех', info: 'Инфо', warn: 'Внимание', error: 'Ошибка' },
};

const CLOSE_LABEL: Record<'en' | 'ru', string> = {
  en: 'Close',
  ru: 'Закрыть',
};

export const Toast: FC<Props> = ({ kind, title, body, onDismiss }) => {
  const lang = getLang();
  return (
    <div
      role="status"
      className={`${styles.toast} ${styles[`kind_${kind}`] ?? ''}`}
    >
      <span className={styles.eyebrow}>{KIND_LABEL[lang][kind]}</span>
      <div className={styles.title}>{title}</div>
      {body ? <div className={styles.body}>{body}</div> : null}
      <button
        type="button"
        aria-label={CLOSE_LABEL[lang]}
        className={styles.close}
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
};
