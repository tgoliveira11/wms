// GraphQL SDL — implemented EXACTLY as specified in CONTRACT.md ("gateway" section).
export const typeDefs = /* GraphQL */ `
  scalar Date
  enum Role { WORKER MANAGER SUPER_ADMIN }
  enum AttendanceStatus { PRESENT OFF }
  enum RequestStatus { PENDING APPROVED REJECTED CANCELLED }
  enum RequestKind { CHECK_IN_OUT OFF }

  type User { id: ID! externalId: String! displayName: String! role: Role! locations: [Location!]! memberships: [LocationMember!]! }
  type Location { id: ID! name: String! address: String selfCheckInEnabled: Boolean! managerAttendanceMarkingEnabled: Boolean!
    workerCount: Int! managerCount: Int! pendingApprovalCount: Int! members(role: Role): [LocationMember!]! }
  type LocationMember { id: ID! user: User! location: Location! role: Role! jobTitle: String annualOffAllowance: Int! offBalanceRemaining: Int! }
  type AttendanceRecord { id: ID! worker: User! location: Location! date: Date! status: AttendanceStatus! source: String! }
  type AttendanceRequest { id: ID! worker: User! location: Location! date: Date! kind: RequestKind! status: RequestStatus! note: String decidedBy: User }
  type AuthPayload { token: String! user: User! }

  type Query {
    me: User!
    location(id: ID!): Location
    locations: [Location!]!
    attendance(locationId: ID!, workerId: ID, from: Date, to: Date, status: AttendanceStatus): [AttendanceRecord!]!
    attendanceRequests(locationId: ID!, status: RequestStatus): [AttendanceRequest!]!
    myAttendance(from: Date, to: Date): [AttendanceRecord!]!
    myAttendanceRequests(status: RequestStatus): [AttendanceRequest!]!
  }
  type Mutation {
    login(loginToken: String!): AuthPayload!
    createAttendanceRequest(locationId: ID!, date: Date!, kind: RequestKind!, note: String): AttendanceRequest!
    cancelAttendanceRequest(id: ID!): AttendanceRequest!
    approveAttendanceRequest(id: ID!): AttendanceRequest!
    rejectAttendanceRequest(id: ID!, reason: String): AttendanceRequest!
    markAttendance(locationId: ID!, workerId: ID!, date: Date!, status: AttendanceStatus!): AttendanceRecord!
    createLocation(companyId: ID!, name: String!, address: String): Location!
    setLocationFeatureFlags(locationId: ID!, selfCheckInEnabled: Boolean, managerAttendanceMarkingEnabled: Boolean): Location!
    addLocationMember(locationId: ID!, userId: ID!, role: Role!, jobTitle: String): LocationMember!
  }
`;
