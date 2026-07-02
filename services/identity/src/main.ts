import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { errorHandler } from '@wfms/shared';
import { router } from './routes';
import { openapi } from './openapi';

const app = express();
app.use(express.json());

// Swagger UI + raw OpenAPI JSON.
app.get('/docs-json', (_req, res) => {
  res.json(openapi);
});
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));

// Application routes (authMiddleware is applied inside the router for all routes
// except POST /auth/login).
app.use(router);

// Terminal error handler must be registered last.
app.use(errorHandler);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`identity-service listening on :${port}`);
});
