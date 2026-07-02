import type { Role } from './auth';

// Fixed UUIDs so seeds across the three independent databases line up
// (identity user ids == the user_id references in org & attendance).
export const COMPANY = { id: '00000000-0000-0000-0000-0000000000c0', name: 'Future Enterprises' };

export const LOCATIONS = {
  boulder: {
    id: '00000000-0000-0000-0000-0000000000b1',
    name: 'Aramark Boulder CO',
    address: '2000 Pearl St, Boulder CO',
    externalRef: 'aramark-boulder-co',
    selfCheckInEnabled: true,
    managerAttendanceMarkingEnabled: true,
  },
  nrg: {
    id: '00000000-0000-0000-0000-0000000000b2',
    name: 'NRG Park',
    address: 'NRG Pkwy, Houston TX',
    externalRef: 'nrg-park',
    selfCheckInEnabled: false,
    managerAttendanceMarkingEnabled: true,
  },
  wembley: {
    id: '00000000-0000-0000-0000-0000000000b3',
    name: 'Wembley Stadium',
    address: 'London HA9 0WS',
    externalRef: 'wembley-stadium',
    selfCheckInEnabled: true,
    managerAttendanceMarkingEnabled: false,
  },
} as const;

export interface SeedUser {
  id: string;
  externalId: string;
  displayName: string;
  role: Role;
  loginToken: string;
}

export const USERS: Record<string, SeedUser> = {
  alex: { id: '00000000-0000-0000-0000-0000000000a1', externalId: 'EXT-ALEX-1', displayName: 'Alex Rivera', role: 'SUPER_ADMIN', loginToken: 'admin-token' },
  megan: { id: '00000000-0000-0000-0000-0000000000a2', externalId: 'EXT-MEGAN-2', displayName: 'Megan Garcia', role: 'MANAGER', loginToken: 'megan-garcia-token' },
  priya: { id: '00000000-0000-0000-0000-0000000000a3', externalId: 'EXT-PRIYA-3', displayName: 'Priya Nair', role: 'MANAGER', loginToken: 'priya-nair-token' },
  tom: { id: '00000000-0000-0000-0000-0000000000a4', externalId: 'EXT-TOM-1042', displayName: 'Tom Reyes', role: 'WORKER', loginToken: 'tom-reyes-token' },
  jamie: { id: '00000000-0000-0000-0000-0000000000a5', externalId: 'EXT-JAMIE-5', displayName: 'Jamie Cole', role: 'WORKER', loginToken: 'jamie-cole-token' },
  lin: { id: '00000000-0000-0000-0000-0000000000a6', externalId: 'EXT-LIN-6', displayName: 'Lin Huang', role: 'WORKER', loginToken: 'lin-huang-token' },
};

export const USER_LIST: SeedUser[] = Object.values(USERS);

// token -> userId, used by identity-service's simulated login.
export const CREDENTIALS: Record<string, string> = Object.fromEntries(
  USER_LIST.map((u) => [u.loginToken, u.id]),
);

export interface SeedMembership {
  locationId: string;
  userId: string;
  role: Role;
  jobTitle: string | null;
  annualOffAllowance: number;
}

const ALLOWANCE = 12;

export const MEMBERSHIPS: SeedMembership[] = [
  { locationId: LOCATIONS.boulder.id, userId: USERS.megan.id, role: 'MANAGER', jobTitle: null, annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.boulder.id, userId: USERS.tom.id, role: 'WORKER', jobTitle: 'Food server', annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.boulder.id, userId: USERS.jamie.id, role: 'WORKER', jobTitle: 'Concession', annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.boulder.id, userId: USERS.lin.id, role: 'WORKER', jobTitle: 'Cook', annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.nrg.id, userId: USERS.priya.id, role: 'MANAGER', jobTitle: null, annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.nrg.id, userId: USERS.lin.id, role: 'WORKER', jobTitle: 'Cook', annualOffAllowance: ALLOWANCE },
  { locationId: LOCATIONS.wembley.id, userId: USERS.jamie.id, role: 'WORKER', jobTitle: 'Usher', annualOffAllowance: ALLOWANCE },
];

export const LOCATION_LIST = Object.values(LOCATIONS);

// Integration partner API key (system credential, not a user JWT — TDR §8).
export const INTEGRATION_API_KEY = process.env.INTEGRATION_API_KEY || 'seed-integration-key';
