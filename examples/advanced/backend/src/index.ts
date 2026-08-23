import http from 'node:http';
import cors from 'cors';
import express from 'express';

import { registerAiRoutes } from './routes/ai.js';
import { registerCheckoutRoutes } from './routes/checkout.js';
import { registerNotificationsRoutes } from './routes/notifications.js';

const PORT = Number(process.env.PORT ?? 4000);

const app = express();

app.use(cors());
app.use(express.json({ limit: '256kb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: '@hedwig-demo/backend', time: Date.now() });
});

registerAiRoutes(app);
registerCheckoutRoutes(app);

const server = http.createServer(app);
registerNotificationsRoutes(app, server);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[hedwig-demo/backend] http://localhost:${PORT}`);
  console.log(`  POST  /ai/stream            SSE-стрим AI-ответов`);
  console.log(`  WS    /ws/notifications     push уведомлений`);
  console.log(`  POST  /notify               dev-триггер уведомления`);
  console.log(`  GET   /checkout             HTML-форма для iframe`);
  console.log(`  POST  /checkout             приём заказа`);
});
