// Minimal hand-written OpenAPI object for the identity-service.
export const openapi = {
  openapi: '3.0.0',
  info: {
    title: 'identity-service',
    version: '0.1.0',
    description: 'Identity & simulated login for the WMS MVP.',
  },
  servers: [{ url: 'http://localhost:3001' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          externalId: { type: 'string' },
          displayName: { type: 'string' },
          role: { type: 'string', enum: ['WORKER', 'MANAGER', 'SUPER_ADMIN'] },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/auth/login': {
      post: {
        summary: 'Simulated login by loginToken',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['loginToken'],
                properties: { loginToken: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Auth payload',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: { $ref: '#/components/schemas/User' },
                  },
                },
              },
            },
          },
          '401': {
            description: 'Unknown token',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/me': {
      get: {
        summary: 'Get the authenticated user',
        security: [{ bearerAuth: [] }],
        responses: {
          '200': {
            description: 'The authenticated user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
        },
      },
    },
    '/users': {
      get: {
        summary: 'Batch fetch users by ids',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'ids',
            in: 'query',
            required: true,
            schema: { type: 'string' },
            description: 'Comma-separated user ids',
          },
        ],
        responses: {
          '200': {
            description: 'Array of users',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
              },
            },
          },
        },
      },
    },
    '/users/{id}': {
      get: {
        summary: 'Get a user by id',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'The user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
    '/users/by-external/{externalId}': {
      get: {
        summary: 'Get a user by externalId',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'externalId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'The user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },
  },
};
