import express from 'express';
import cron from 'node-cron';
import { config } from './config';
import { logger } from './utils/logger';
import webhookRoutes from './routes/webhooks';
import { reconcile } from './services/reconciliation.service';

const app = express();

// Capture raw body for Square webhook signature verification
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString();
  },
}));

// Routes
app.use('/api', webhookRoutes);

// Root
app.get('/', (_req, res) => {
  res.json({ service: 'Square-GHL Sync', status: 'running' });
});

// Reconciliation cron job
const cronExpr = `*/${config.reconciliationIntervalMinutes} * * * *`;
cron.schedule(cronExpr, () => {
  logger.info('Running scheduled reconciliation');
  reconcile().catch(err => logger.error('Reconciliation error', { error: err }));
});

// Start server
app.listen(config.port, () => {
  logger.info(`Server running on port ${config.port}`);
  logger.info(`Reconciliation scheduled every ${config.reconciliationIntervalMinutes} minutes`);
  logger.info('Endpoints:');
  logger.info('  POST /api/webhooks/square   — Square webhook');
  logger.info('  POST /api/ghl-to-square     — GHL appointment created');
  logger.info('  POST /api/ghl-cancelled     — GHL appointment cancelled');
  logger.info('  POST /api/ghl-updated       — GHL appointment rescheduled');
  logger.info('  GET  /api/health            — Health check');
});
