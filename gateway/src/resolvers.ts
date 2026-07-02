import { GraphQLError } from 'graphql';
import type { AuthUser, Role } from '@wfms/shared';
import { identity, org, attendance } from './clients';

// Per-request memo cache for user/location lookups (optional nicety — seed scale is tiny).
export interface GatewayContext {
  token?: string;
  user?: AuthUser;
  cache: {
    users: Map<string, Promise<any>>;
    locations: Map<string, Promise<any>>;
  };
}

// ---- guards -----------------------------------------------------------------

function requireUser(ctx: GatewayContext): AuthUser {
  if (!ctx.user) {
    throw new GraphQLError('Authentication required', { extensions: { code: 'UNAUTHENTICATED' } });
  }
  return ctx.user;
}

function requireRole(ctx: GatewayContext, ...roles: Role[]): AuthUser {
  const user = requireUser(ctx);
  if (!roles.includes(user.role)) {
    throw new GraphQLError(`Requires role: ${roles.join('/')}`, { extensions: { code: 'FORBIDDEN' } });
  }
  return user;
}

// ---- memoized loaders (drive field resolvers) -------------------------------

function loadUser(ctx: GatewayContext, id: string): Promise<any> {
  let p = ctx.cache.users.get(id);
  if (!p) {
    p = identity.get(`/users/${id}`, ctx.token);
    ctx.cache.users.set(id, p);
  }
  return p;
}

function loadLocation(ctx: GatewayContext, id: string): Promise<any> {
  let p = ctx.cache.locations.get(id);
  if (!p) {
    p = org.get(`/locations/${id}`, ctx.token);
    ctx.cache.locations.set(id, p);
  }
  return p;
}

// ---- query string helper ----------------------------------------------------

function qs(params: Record<string, unknown>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') usp.append(k, String(v));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export const resolvers = {
  Query: {
    me: async (_p: unknown, _a: unknown, ctx: GatewayContext) => {
      requireUser(ctx);
      return identity.get('/me', ctx.token);
    },

    location: async (_p: unknown, args: { id: string }, ctx: GatewayContext) => {
      requireUser(ctx);
      return loadLocation(ctx, args.id);
    },

    locations: async (_p: unknown, _a: unknown, ctx: GatewayContext) => {
      requireRole(ctx, 'SUPER_ADMIN');
      return org.get('/locations', ctx.token);
    },

    attendance: async (
      _p: unknown,
      args: { locationId: string; workerId?: string; from?: string; to?: string; status?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'MANAGER', 'SUPER_ADMIN');
      const query = qs({
        locationId: args.locationId,
        workerId: args.workerId,
        from: args.from,
        to: args.to,
        status: args.status,
      });
      return attendance.get(`/attendance${query}`, ctx.token);
    },

    attendanceRequests: async (
      _p: unknown,
      args: { locationId: string; status?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'MANAGER', 'SUPER_ADMIN');
      const query = qs({ locationId: args.locationId, status: args.status });
      return attendance.get(`/requests${query}`, ctx.token);
    },

    myAttendance: async (
      _p: unknown,
      args: { from?: string; to?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'WORKER');
      const query = qs({ from: args.from, to: args.to });
      return attendance.get(`/attendance/mine${query}`, ctx.token);
    },

    myAttendanceRequests: async (
      _p: unknown,
      args: { status?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'WORKER');
      const query = qs({ status: args.status });
      return attendance.get(`/requests/mine${query}`, ctx.token);
    },
  },

  Mutation: {
    // login is public.
    login: async (_p: unknown, args: { loginToken: string }) => {
      return identity.post('/auth/login', { loginToken: args.loginToken });
    },

    createAttendanceRequest: async (
      _p: unknown,
      args: { locationId: string; date: string; kind: string; note?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'WORKER');
      return attendance.post(
        '/requests',
        { locationId: args.locationId, date: args.date, kind: args.kind, note: args.note },
        ctx.token,
      );
    },

    cancelAttendanceRequest: async (_p: unknown, args: { id: string }, ctx: GatewayContext) => {
      requireRole(ctx, 'WORKER');
      return attendance.post(`/requests/${args.id}/cancel`, {}, ctx.token);
    },

    approveAttendanceRequest: async (_p: unknown, args: { id: string }, ctx: GatewayContext) => {
      requireRole(ctx, 'MANAGER', 'SUPER_ADMIN');
      return attendance.post(`/requests/${args.id}/approve`, {}, ctx.token);
    },

    rejectAttendanceRequest: async (
      _p: unknown,
      args: { id: string; reason?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'MANAGER', 'SUPER_ADMIN');
      return attendance.post(`/requests/${args.id}/reject`, { reason: args.reason }, ctx.token);
    },

    markAttendance: async (
      _p: unknown,
      args: { locationId: string; workerId: string; date: string; status: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'MANAGER', 'SUPER_ADMIN');
      return attendance.post(
        '/attendance/mark',
        { locationId: args.locationId, workerId: args.workerId, date: args.date, status: args.status },
        ctx.token,
      );
    },

    createLocation: async (
      _p: unknown,
      args: { companyId: string; name: string; address?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'SUPER_ADMIN');
      return org.post(
        '/locations',
        { companyId: args.companyId, name: args.name, address: args.address },
        ctx.token,
      );
    },

    setLocationFeatureFlags: async (
      _p: unknown,
      args: { locationId: string; selfCheckInEnabled?: boolean; managerAttendanceMarkingEnabled?: boolean },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'SUPER_ADMIN');
      const body: Record<string, boolean> = {};
      if (args.selfCheckInEnabled !== undefined && args.selfCheckInEnabled !== null) {
        body.selfCheckInEnabled = args.selfCheckInEnabled;
      }
      if (
        args.managerAttendanceMarkingEnabled !== undefined &&
        args.managerAttendanceMarkingEnabled !== null
      ) {
        body.managerAttendanceMarkingEnabled = args.managerAttendanceMarkingEnabled;
      }
      return org.patch(`/locations/${args.locationId}/flags`, body, ctx.token);
    },

    addLocationMember: async (
      _p: unknown,
      args: { locationId: string; userId: string; role: string; jobTitle?: string },
      ctx: GatewayContext,
    ) => {
      requireRole(ctx, 'SUPER_ADMIN');
      return org.post(
        `/locations/${args.locationId}/members`,
        { userId: args.userId, role: args.role, jobTitle: args.jobTitle },
        ctx.token,
      );
    },
  },

  // ---- field resolvers ------------------------------------------------------

  User: {
    // GET org /memberships?userId=<id> -> for each, GET location.
    locations: async (parent: { id: string }, _a: unknown, ctx: GatewayContext) => {
      const memberships: Array<{ locationId: string }> = await org.get(
        `/memberships${qs({ userId: parent.id })}`,
        ctx.token,
      );
      return Promise.all(memberships.map((m) => loadLocation(ctx, m.locationId)));
    },
    // Raw membership rows (carry locationId/userId/jobTitle/balance) — used by the
    // worker view to show its own OFF balance per location.
    memberships: async (parent: { id: string }, _a: unknown, ctx: GatewayContext) => {
      return org.get(`/memberships${qs({ userId: parent.id })}`, ctx.token);
    },
  },

  Location: {
    workerCount: async (parent: { id: string }, _a: unknown, ctx: GatewayContext) => {
      const counts: { workerCount: number; managerCount: number } = await org.get(
        `/locations/${parent.id}/counts`,
        ctx.token,
      );
      return counts.workerCount;
    },
    managerCount: async (parent: { id: string }, _a: unknown, ctx: GatewayContext) => {
      const counts: { workerCount: number; managerCount: number } = await org.get(
        `/locations/${parent.id}/counts`,
        ctx.token,
      );
      return counts.managerCount;
    },
    pendingApprovalCount: async (parent: { id: string }, _a: unknown, ctx: GatewayContext) => {
      const requests: unknown[] = await attendance.get(
        `/requests${qs({ locationId: parent.id, status: 'PENDING' })}`,
        ctx.token,
      );
      return requests.length;
    },
    // org /locations/:id/members?role= ; member.user resolved via identity.
    members: async (parent: { id: string }, args: { role?: string }, ctx: GatewayContext) => {
      return org.get(`/locations/${parent.id}/members${qs({ role: args.role })}`, ctx.token);
    },
  },

  LocationMember: {
    // org member carries userId/locationId -> hydrate via identity/org.
    user: async (parent: { userId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadUser(ctx, parent.userId);
    },
    location: async (parent: { locationId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadLocation(ctx, parent.locationId);
    },
  },

  AttendanceRecord: {
    worker: async (parent: { workerId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadUser(ctx, parent.workerId);
    },
    location: async (parent: { locationId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadLocation(ctx, parent.locationId);
    },
  },

  AttendanceRequest: {
    worker: async (parent: { workerId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadUser(ctx, parent.workerId);
    },
    location: async (parent: { locationId: string }, _a: unknown, ctx: GatewayContext) => {
      return loadLocation(ctx, parent.locationId);
    },
    decidedBy: async (parent: { decidedBy?: string | null }, _a: unknown, ctx: GatewayContext) => {
      if (!parent.decidedBy) return null;
      return loadUser(ctx, parent.decidedBy);
    },
  },
};
