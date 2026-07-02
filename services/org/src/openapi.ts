// Minimal hand-written OpenAPI document for the org-service.
export const openapiSpec = {
  openapi: '3.0.0',
  info: { title: 'WFMS org-service', version: '0.1.0' },
  servers: [{ url: 'http://localhost:3002' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Location: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          companyId: { type: 'string' },
          name: { type: 'string' },
          address: { type: 'string', nullable: true },
          externalRef: { type: 'string' },
          selfCheckInEnabled: { type: 'boolean' },
          managerAttendanceMarkingEnabled: { type: 'boolean' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          locationId: { type: 'string' },
          userId: { type: 'string' },
          role: { type: 'string' },
          jobTitle: { type: 'string', nullable: true },
          annualOffAllowance: { type: 'integer' },
          offBalanceRemaining: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' } },
          },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/locations': {
      get: {
        summary: 'List all locations (SUPER_ADMIN only)',
        responses: {
          '200': {
            description: 'Locations',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Location' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Create a location (SUPER_ADMIN only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['companyId', 'name'],
                properties: {
                  companyId: { type: 'string' },
                  name: { type: 'string' },
                  address: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Created location',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Location' } } },
          },
        },
      },
    },
    '/locations/{id}': {
      get: {
        summary: 'Get a location',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Location',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Location' } } },
          },
          '404': { description: 'Not found' },
        },
      },
    },
    '/locations/{id}/flags': {
      patch: {
        summary: 'Update feature flags (SUPER_ADMIN only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  selfCheckInEnabled: { type: 'boolean' },
                  managerAttendanceMarkingEnabled: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Location',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Location' } } },
          },
        },
      },
    },
    '/locations/{id}/members': {
      get: {
        summary: 'List members of a location (optional role filter)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'role', in: 'query', required: false, schema: { type: 'string', enum: ['WORKER', 'MANAGER'] } },
        ],
        responses: {
          '200': {
            description: 'Members',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
              },
            },
          },
        },
      },
      post: {
        summary: 'Add a member (SUPER_ADMIN only)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['userId', 'role'],
                properties: {
                  userId: { type: 'string' },
                  role: { type: 'string' },
                  jobTitle: { type: 'string', nullable: true },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Member',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Member' } } },
          },
          '409': { description: 'Conflict (duplicate jobTitle or (location,user))' },
        },
      },
    },
    '/locations/{id}/members/{userId}': {
      get: {
        summary: 'Get a member',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Member',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Member' } } },
          },
          '404': { description: 'Not found' },
        },
      },
    },
    '/locations/{id}/members/{userId}/off-balance/consume': {
      post: {
        summary: 'Atomically consume one off-balance day',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Remaining balance',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { offBalanceRemaining: { type: 'integer' } } },
              },
            },
          },
          '409': { description: 'InsufficientOffBalance (INVALID_STATE)' },
        },
      },
    },
    '/locations/{id}/members/{userId}/off-balance/release': {
      post: {
        summary: 'Release (increment) one off-balance day, bounded by annualOffAllowance',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'Remaining balance',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { offBalanceRemaining: { type: 'integer' } } },
              },
            },
          },
        },
      },
    },
    '/memberships': {
      get: {
        summary: 'List memberships across locations for a user',
        parameters: [{ name: 'userId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Members',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Member' } },
              },
            },
          },
        },
      },
    },
    '/locations/{id}/counts': {
      get: {
        summary: 'Worker/manager counts for a location',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Counts',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { workerCount: { type: 'integer' }, managerCount: { type: 'integer' } },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
