import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { api } from './src/routes.js';

const here = dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);
// Tailscale 経由でスマホから使うため、既定で全インタフェースを listen する。
const HOST = process.env.HOST ?? '0.0.0.0';

const app = express();

app.use(express.json());
app.use('/api', api);
app.use(express.static(join(here, 'public')));

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'not found' });
});

// SPA フォールバック
app.use((_req, res) => {
  res.sendFile(join(here, 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message ?? 'internal error' });
});

app.listen(PORT, HOST, () => {
  console.log(`MyAthanor listening on http://${HOST}:${PORT}`);
});
