import express, { type RequestHandler } from 'express';
import swaggerUi from 'swagger-ui-express';
import { authMiddleware, errorHandler } from '@wfms/shared';
import { router } from './routes';
import { openapi } from './openapi';

const app = express();
app.use(express.json());

// Swagger docs (public).
app.get('/docs-json', (_req, res) => res.json(openapi));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// authMiddleware on every route EXCEPT the integration ingest endpoint, which
// authenticates with X-Api-Key instead of a user JWT.
const INTEGRATION_PATH = '/integrations/attendance';
const guardedAuth: RequestHandler = (req, res, next) => {
  if (req.method === 'POST' && req.path === INTEGRATION_PATH) return next();
  return authMiddleware(req, res, next);
};
app.use(guardedAuth);

app.use(router);

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3003;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`attendance-service listening on :${PORT}`);
});
