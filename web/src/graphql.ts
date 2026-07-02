import { gql } from "@apollo/client";

export const LOGIN = gql`
  mutation Login($loginToken: String!) {
    login(loginToken: $loginToken) {
      token
      user {
        id
        externalId
        displayName
        role
      }
    }
  }
`;

export const ME = gql`
  query Me {
    me {
      id
      externalId
      displayName
      role
      locations {
        id
        name
        selfCheckInEnabled
        managerAttendanceMarkingEnabled
      }
      memberships {
        id
        role
        jobTitle
        annualOffAllowance
        offBalanceRemaining
        location {
          id
          name
        }
      }
    }
  }
`;

export const MY_ATTENDANCE = gql`
  query MyAttendance($from: Date, $to: Date) {
    myAttendance(from: $from, to: $to) {
      id
      date
      status
      source
      location {
        id
        name
      }
    }
  }
`;

export const MY_ATTENDANCE_REQUESTS = gql`
  query MyAttendanceRequests($status: RequestStatus) {
    myAttendanceRequests(status: $status) {
      id
      date
      kind
      status
      note
      location {
        id
        name
      }
    }
  }
`;

export const CREATE_ATTENDANCE_REQUEST = gql`
  mutation CreateAttendanceRequest(
    $locationId: ID!
    $date: Date!
    $kind: RequestKind!
    $note: String
  ) {
    createAttendanceRequest(
      locationId: $locationId
      date: $date
      kind: $kind
      note: $note
    ) {
      id
      date
      kind
      status
      note
      location {
        id
        name
      }
    }
  }
`;

export const CANCEL_ATTENDANCE_REQUEST = gql`
  mutation CancelAttendanceRequest($id: ID!) {
    cancelAttendanceRequest(id: $id) {
      id
      status
    }
  }
`;

export const LOCATION = gql`
  query Location($id: ID!) {
    location(id: $id) {
      id
      name
      address
      selfCheckInEnabled
      managerAttendanceMarkingEnabled
      workerCount
      managerCount
      pendingApprovalCount
      members {
        id
        role
        jobTitle
        annualOffAllowance
        offBalanceRemaining
        user {
          id
          displayName
          externalId
        }
      }
    }
  }
`;

export const LOCATIONS = gql`
  query Locations {
    locations {
      id
      name
      address
      selfCheckInEnabled
      managerAttendanceMarkingEnabled
      workerCount
      managerCount
      pendingApprovalCount
    }
  }
`;

export const ATTENDANCE_REQUESTS = gql`
  query AttendanceRequests($locationId: ID!, $status: RequestStatus) {
    attendanceRequests(locationId: $locationId, status: $status) {
      id
      date
      kind
      status
      note
      worker {
        id
        displayName
        externalId
      }
      location {
        id
        name
      }
    }
  }
`;

export const APPROVE_ATTENDANCE_REQUEST = gql`
  mutation ApproveAttendanceRequest($id: ID!) {
    approveAttendanceRequest(id: $id) {
      id
      status
    }
  }
`;

export const REJECT_ATTENDANCE_REQUEST = gql`
  mutation RejectAttendanceRequest($id: ID!, $reason: String) {
    rejectAttendanceRequest(id: $id, reason: $reason) {
      id
      status
      note
    }
  }
`;

export const MARK_ATTENDANCE = gql`
  mutation MarkAttendance(
    $locationId: ID!
    $workerId: ID!
    $date: Date!
    $status: AttendanceStatus!
  ) {
    markAttendance(
      locationId: $locationId
      workerId: $workerId
      date: $date
      status: $status
    ) {
      id
      date
      status
      source
      worker {
        id
        displayName
      }
    }
  }
`;

export const ATTENDANCE = gql`
  query Attendance(
    $locationId: ID!
    $workerId: ID
    $from: Date
    $to: Date
    $status: AttendanceStatus
  ) {
    attendance(
      locationId: $locationId
      workerId: $workerId
      from: $from
      to: $to
      status: $status
    ) {
      id
      date
      status
      source
      worker {
        id
        displayName
        externalId
      }
    }
  }
`;

export const SET_LOCATION_FEATURE_FLAGS = gql`
  mutation SetLocationFeatureFlags(
    $locationId: ID!
    $selfCheckInEnabled: Boolean
    $managerAttendanceMarkingEnabled: Boolean
  ) {
    setLocationFeatureFlags(
      locationId: $locationId
      selfCheckInEnabled: $selfCheckInEnabled
      managerAttendanceMarkingEnabled: $managerAttendanceMarkingEnabled
    ) {
      id
      name
      selfCheckInEnabled
      managerAttendanceMarkingEnabled
    }
  }
`;

export const CREATE_LOCATION = gql`
  mutation CreateLocation($companyId: ID!, $name: String!, $address: String) {
    createLocation(companyId: $companyId, name: $name, address: $address) {
      id
      name
      address
      selfCheckInEnabled
      managerAttendanceMarkingEnabled
    }
  }
`;

export const ADD_LOCATION_MEMBER = gql`
  mutation AddLocationMember(
    $locationId: ID!
    $userId: ID!
    $role: Role!
    $jobTitle: String
  ) {
    addLocationMember(
      locationId: $locationId
      userId: $userId
      role: $role
      jobTitle: $jobTitle
    ) {
      id
      role
      jobTitle
      annualOffAllowance
      offBalanceRemaining
      user {
        id
        displayName
      }
    }
  }
`;
