// Minimal hand-written OpenAPI object for the attendance-service.
export const openapi = {
  openapi: '3.0.0',
  info: {
    title: 'attendance-service',
    version: '0.1.0',
    description: 'Attendance records, worker requests & integration ingest for the WMS MVP.',
  },
  servers: [{ url: 'http://localhost:3003' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
    schemas: {
      AttendanceRecord: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workerId: { type: 'string' },
          locationId: { type: 'string' },
          date: { type: 'string', example: '2026-07-01' },
          status: { type: 'string', enum: ['PRESENT', 'OFF'] },
          source: { type: 'string', enum: ['WORKER_REQUEST', 'MANAGER', 'INTEGRATION'] },
        },
      },
      AttendanceRequest: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          workerId: { type: 'string' },
          locationId: { type: 'string' },
          date: { type: 'string', example: '2026-07-01' },
          kind: { type: 'string', enum: ['CHECK_IN_OUT', 'OFF'] },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] },
          note: { type: 'string', nullable: true },
          decidedBy: { type: 'string', nullable: true },
          decidedAt: { type: 'string', nullable: true },
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
  paths: {
    '/requests': {
      post: {
        summary: 'Create an attendance request (WORKER)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['locationId', 'date', 'kind'],
                properties: {
                  locationId: { type: 'string' },
                  date: { type: 'string' },
                  kind: { type: 'string', enum: ['CHECK_IN_OUT', 'OFF'] },
                  note: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Created request', content: { 'application/json': { schema: { $ref: '#/components/schemas/AttendanceRequest' } } } },
          '409': { description: 'Conflict / invalid state', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      get: {
        summary: 'List requests for a location (MANAGER/SUPER_ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'locationId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Requests', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AttendanceRequest' } } } } } },
      },
    },
    '/requests/mine': {
      get: {
        summary: 'List own requests (WORKER)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string' } }],
        responses: { '200': { description: 'Requests', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AttendanceRequest' } } } } } },
      },
    },
    '/requests/{id}/cancel': {
      post: {
        summary: 'Cancel own PENDING request (WORKER)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Cancelled request', content: { 'application/json': { schema: { $ref: '#/components/schemas/AttendanceRequest' } } } } },
      },
    },
    '/requests/{id}/approve': {
      post: {
        summary: 'Approve a request (MANAGER/SUPER_ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Approved request', content: { 'application/json': { schema: { $ref: '#/components/schemas/AttendanceRequest' } } } },
          '403': { description: 'Out of scope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '409': { description: 'Invalid state / insufficient OFF balance', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/requests/{id}/reject': {
      post: {
        summary: 'Reject a request (MANAGER/SUPER_ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { reason: { type: 'string' } } } } } },
        responses: { '200': { description: 'Rejected request', content: { 'application/json': { schema: { $ref: '#/components/schemas/AttendanceRequest' } } } } },
      },
    },
    '/attendance/mark': {
      post: {
        summary: 'Mark attendance (MANAGER/SUPER_ADMIN)',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['locationId', 'workerId', 'date', 'status'],
                properties: {
                  locationId: { type: 'string' },
                  workerId: { type: 'string' },
                  date: { type: 'string' },
                  status: { type: 'string', enum: ['PRESENT', 'OFF'] },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Record', content: { 'application/json': { schema: { $ref: '#/components/schemas/AttendanceRecord' } } } } },
      },
    },
    '/attendance': {
      get: {
        summary: 'List attendance records for a location (MANAGER/SUPER_ADMIN)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'locationId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'workerId', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Records', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AttendanceRecord' } } } } } },
      },
    },
    '/attendance/mine': {
      get: {
        summary: 'List own attendance records (WORKER)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'from', in: 'query', schema: { type: 'string' } },
          { name: 'to', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Records', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AttendanceRecord' } } } } } },
      },
    },
    '/integrations/attendance': {
      post: {
        summary: 'Ingest attendance from an external integration (X-Api-Key auth)',
        security: [{ apiKey: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['externalWorkerId', 'locationExternalRef', 'date', 'status'],
                properties: {
                  externalWorkerId: { type: 'string' },
                  locationExternalRef: { type: 'string' },
                  date: { type: 'string' },
                  status: { type: 'string', enum: ['PRESENT', 'OFF'] },
                  idempotencyKey: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Ingested', content: { 'application/json': { schema: { type: 'object', properties: { recordId: { type: 'string' }, workerId: { type: 'string' } } } } } },
          '200': { description: 'Idempotent replay' },
          '401': { description: 'Bad API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};
