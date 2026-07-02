import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { authMiddleware, errorHandler } from '@wfms/shared';
import { router } from './routes';
import { openapiSpec } from './openapi';

const app = express();
app.use(express.json());

// Swagger docs (public — no auth required to read the spec).
app.get('/docs-json', (_req, res) => res.json(openapiSpec));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

// authMiddleware on ALL (business) routes.
app.use(authMiddleware);
app.use(router);

// Terminal error handler (maps AppError + Prisma P2002 -> {error:{code,message}}).
app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3002;
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`org-service listening on :${PORT}`);
});
