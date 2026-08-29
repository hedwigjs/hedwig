import type { FC } from 'react';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { getLang, t } from '../../../../shared/i18n/useLang';

import styles from './CheckoutModal.module.css';

const T = {
  en: {
    dialogLabel: 'Order payment',
    eyebrow: 'Payment',
    items: 'items',
    close: 'Close',
    frameTitle: 'Payment form',
  },
  ru: {
    dialogLabel: 'Оплата заказа',
    eyebrow: 'Оплата',
    items: 'поз.',
    close: 'Закрыть',
    frameTitle: 'Форма оплаты',
  },
} as const;

const currency = () =>
  new Intl.NumberFormat(getLang() === 'en' ? 'en-US' : 'ru-RU');

type Props = {
  iframeUrl: string;
  totalPrice: number;
  itemCount: number;
  onClose: () => void;
  /**
   * Fires once the iframe finishes loading, with its `contentWindow`.
   * Owner uses this to attach a broker bridge (PostMessageTransport)
   * to the freshly-loaded document.
   */
  onIframeReady?: (win: Window) => void;
};

export const CheckoutModal: FC<Props> = ({
  iframeUrl,
  totalPrice,
  itemCount,
  onClose,
  onIframeReady,
}) => {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const node = (
    <div className={styles.backdrop} role="presentation" onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t(T, 'dialogLabel')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.head}>
          <div className={styles.summary}>
            <span className={styles.eyebrow}>
              {t(T, 'eyebrow')} · {itemCount} {t(T, 'items')}
            </span>
            <span className={styles.total}>{currency().format(totalPrice)} ₽</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t(T, 'close')}
          >
            ×
          </button>
        </div>
        <iframe
          className={styles.frame}
          src={iframeUrl}
          title={t(T, 'frameTitle')}
          onLoad={(e) => {
            const win = e.currentTarget.contentWindow;
            if (win) onIframeReady?.(win);
          }}
        />
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(node, document.body);
};
