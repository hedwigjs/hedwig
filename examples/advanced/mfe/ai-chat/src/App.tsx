import type { FC } from 'react';
import React from 'react';

import { Composer } from './components/Composer';
import { MessageList } from './components/MessageList';
import { useChat } from './hooks/useChat';

import styles from './App.module.css';

export const App: FC = () => {
  const { messages, isStreaming, send, cancel } = useChat();

  return (
    <div className={styles.root}>
      <MessageList
        messages={messages}
        onSuggestionSelect={send}
        disabled={isStreaming}
      />
      <Composer onSend={send} onCancel={cancel} isStreaming={isStreaming} />
    </div>
  );
};
