import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import {
  LOCATIONS,
  LOCATION,
  SET_LOCATION_FEATURE_FLAGS,
  CREATE_LOCATION,
  ADD_LOCATION_MEMBER,
} from "../graphql";
import { errorText } from "../errorText";

const SEED_COMPANY_ID = "00000000-0000-0000-0000-0000000000c0";

export default function SuperAdmin() {
  const locationsQ = useQuery(LOCATIONS);
  const locations: any[] = locationsQ.data?.locations ?? [];

  const [selectedId, setSelectedId] = useState<string>("");
  const effectiveSelected = selectedId || locations[0]?.id || "";

  const locationQ = useQuery(LOCATION, {
    variables: { id: effectiveSelected },
    skip: !effectiveSelected,
  });

  const [setFlags, flagsState] = useMutation(SET_LOCATION_FEATURE_FLAGS, {
    onCompleted: () => {
      locationsQ.refetch();
      locationQ.refetch();
    },
  });

  // createLocation form
  const [companyId, setCompanyId] = useState<string>(SEED_COMPANY_ID);
  const [newName, setNewName] = useState<string>("");
  const [newAddress, setNewAddress] = useState<string>("");
  const [createLocation, createLocState] = useMutation(CREATE_LOCATION, {
    onCompleted: () => {
      setNewName("");
      setNewAddress("");
      locationsQ.refetch();
    },
  });

  // addLocationMember form
  const [memberUserId, setMemberUserId] = useState<string>("");
  const [memberRole, setMemberRole] = useState<"WORKER" | "MANAGER">("WORKER");
  const [memberJobTitle, setMemberJobTitle] = useState<string>("");
  const [addMember, addMemberState] = useMutation(ADD_LOCATION_MEMBER, {
    onCompleted: () => {
      setMemberUserId("");
      setMemberJobTitle("");
      locationQ.refetch();
    },
  });

  const toggleFlag = (
    loc: any,
    field: "selfCheckInEnabled" | "managerAttendanceMarkingEnabled"
  ) => {
    setFlags({
      variables: { locationId: loc.id, [field]: !loc[field] },
    }).catch(() => {});
  };

  const submitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName) return;
    createLocation({
      variables: { companyId, name: newName, address: newAddress || null },
    }).catch(() => {});
  };

  const submitAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveSelected || !memberUserId) return;
    addMember({
      variables: {
        locationId: effectiveSelected,
        userId: memberUserId,
        role: memberRole,
        jobTitle: memberJobTitle || null,
      },
    }).catch(() => {});
  };

  const detail = locationQ.data?.location;

  return (
    <main>
      <section>
        <h2>Locations</h2>
        {errorText(locationsQ.error) && (
          <div className="error">{errorText(locationsQ.error)}</div>
        )}
        {errorText(flagsState.error) && (
          <div className="error">{errorText(flagsState.error)}</div>
        )}
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Self Check-In</th>
              <th>Manager Marking</th>
              <th>Workers</th>
              <th>Managers</th>
              <th>Pending</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {locations.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>
                  <label>
                    <input
                      type="checkbox"
                      checked={l.selfCheckInEnabled}
                      disabled={flagsState.loading}
                      onChange={() => toggleFlag(l, "selfCheckInEnabled")}
                    />
                  </label>
                </td>
                <td>
                  <label>
                    <input
                      type="checkbox"
                      checked={l.managerAttendanceMarkingEnabled}
                      disabled={flagsState.loading}
                      onChange={() =>
                        toggleFlag(l, "managerAttendanceMarkingEnabled")
                      }
                    />
                  </label>
                </td>
                <td>{l.workerCount}</td>
                <td>{l.managerCount}</td>
                <td>{l.pendingApprovalCount}</td>
                <td>
                  <button
                    className="secondary"
                    onClick={() => setSelectedId(l.id)}
                  >
                    Members
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Members {detail ? `— ${detail.name}` : ""}</h2>
        {errorText(locationQ.error) && (
          <div className="error">{errorText(locationQ.error)}</div>
        )}
        {!effectiveSelected && (
          <p className="muted">Select a location to view members.</p>
        )}
        {detail && (
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Job Title</th>
                <th>Off Balance</th>
              </tr>
            </thead>
            <tbody>
              {(detail.members ?? []).map((m: any) => (
                <tr key={m.id}>
                  <td>{m.user?.displayName}</td>
                  <td>{m.role}</td>
                  <td>{m.jobTitle}</td>
                  <td>
                    {m.offBalanceRemaining} of {m.annualOffAllowance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h3>Add Member</h3>
        <form onSubmit={submitAddMember}>
          <div className="form-row">
            <label>
              <span>User ID</span>
              <input
                type="text"
                value={memberUserId}
                onChange={(e) => setMemberUserId(e.target.value)}
                placeholder="user id"
              />
            </label>
            <label>
              <span>Role</span>
              <select
                value={memberRole}
                onChange={(e) =>
                  setMemberRole(e.target.value as "WORKER" | "MANAGER")
                }
              >
                <option value="WORKER">WORKER</option>
                <option value="MANAGER">MANAGER</option>
              </select>
            </label>
            <label>
              <span>Job Title</span>
              <input
                type="text"
                value={memberJobTitle}
                onChange={(e) => setMemberJobTitle(e.target.value)}
                placeholder="optional"
              />
            </label>
            <button
              type="submit"
              disabled={addMemberState.loading || !effectiveSelected || !memberUserId}
            >
              Add
            </button>
          </div>
        </form>
        {errorText(addMemberState.error) && (
          <div className="error">{errorText(addMemberState.error)}</div>
        )}
      </section>

      <section>
        <h2>Create Location</h2>
        <form onSubmit={submitCreate}>
          <div className="form-row">
            <label>
              <span>Company ID</span>
              <input
                type="text"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              />
            </label>
            <label>
              <span>Name</span>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label>
              <span>Address</span>
              <input
                type="text"
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                placeholder="optional"
              />
            </label>
            <button type="submit" disabled={createLocState.loading || !newName}>
              Create
            </button>
          </div>
        </form>
        {errorText(createLocState.error) && (
          <div className="error">{errorText(createLocState.error)}</div>
        )}
      </section>
    </main>
  );
}
