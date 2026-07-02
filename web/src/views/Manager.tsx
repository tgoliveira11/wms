import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import {
  ATTENDANCE_REQUESTS,
  APPROVE_ATTENDANCE_REQUEST,
  REJECT_ATTENDANCE_REQUEST,
  MARK_ATTENDANCE,
  ATTENDANCE,
} from "../graphql";
import { errorText } from "../errorText";

interface LocationLite {
  id: string;
  name: string;
}

interface Me {
  id: string;
  displayName: string;
  locations: LocationLite[];
}

export default function Manager({ me }: { me: Me }) {
  const locations = me.locations ?? [];
  const [locationId, setLocationId] = useState<string>(locations[0]?.id ?? "");

  const [markWorkerId, setMarkWorkerId] = useState<string>("");
  const [markDate, setMarkDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [markStatus, setMarkStatus] = useState<"PRESENT" | "OFF">("PRESENT");

  const pendingQ = useQuery(ATTENDANCE_REQUESTS, {
    variables: { locationId, status: "PENDING" },
    skip: !locationId,
  });
  const attendanceQ = useQuery(ATTENDANCE, {
    variables: { locationId },
    skip: !locationId,
  });

  const refetchAll = () => {
    pendingQ.refetch();
    attendanceQ.refetch();
  };

  const [approve, approveState] = useMutation(APPROVE_ATTENDANCE_REQUEST, {
    onCompleted: refetchAll,
  });
  const [reject, rejectState] = useMutation(REJECT_ATTENDANCE_REQUEST, {
    onCompleted: refetchAll,
  });
  const [markAttendance, markState] = useMutation(MARK_ATTENDANCE, {
    onCompleted: () => attendanceQ.refetch(),
  });

  const submitMark = (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId || !markWorkerId) return;
    markAttendance({
      variables: {
        locationId,
        workerId: markWorkerId,
        date: markDate,
        status: markStatus,
      },
    }).catch(() => {});
  };

  return (
    <main>
      <section>
        <h2>Location</h2>
        {locations.length === 0 && (
          <p className="muted">You do not manage any location.</p>
        )}
        <label>
          <span>Managed location</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h2>Pending Requests</h2>
        {errorText(pendingQ.error) && (
          <div className="error">{errorText(pendingQ.error)}</div>
        )}
        {errorText(approveState.error) && (
          <div className="error">{errorText(approveState.error)}</div>
        )}
        {errorText(rejectState.error) && (
          <div className="error">{errorText(rejectState.error)}</div>
        )}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Worker</th>
              <th>Kind</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(pendingQ.data?.attendanceRequests ?? []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.worker?.displayName}</td>
                <td>{r.kind}</td>
                <td>{r.note}</td>
                <td>
                  <button
                    disabled={approveState.loading}
                    onClick={() =>
                      approve({ variables: { id: r.id } }).catch(() => {})
                    }
                  >
                    Approve
                  </button>{" "}
                  <button
                    className="danger"
                    disabled={rejectState.loading}
                    onClick={() => {
                      const reason = window.prompt("Reason (optional)") ?? null;
                      reject({
                        variables: { id: r.id, reason },
                      }).catch(() => {});
                    }}
                  >
                    Reject
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Mark Attendance</h2>
        <form onSubmit={submitMark}>
          <div className="form-row">
            <label>
              <span>Worker ID</span>
              <input
                type="text"
                value={markWorkerId}
                onChange={(e) => setMarkWorkerId(e.target.value)}
                placeholder="user id"
              />
            </label>
            <label>
              <span>Date</span>
              <input
                type="date"
                value={markDate}
                onChange={(e) => setMarkDate(e.target.value)}
              />
            </label>
            <label>
              <span>Status</span>
              <select
                value={markStatus}
                onChange={(e) =>
                  setMarkStatus(e.target.value as "PRESENT" | "OFF")
                }
              >
                <option value="PRESENT">PRESENT</option>
                <option value="OFF">OFF</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={markState.loading || !locationId || !markWorkerId}
            >
              Mark
            </button>
          </div>
        </form>
        {errorText(markState.error) && (
          <div className="error">{errorText(markState.error)}</div>
        )}
      </section>

      <section>
        <h2>Attendance</h2>
        {errorText(attendanceQ.error) && (
          <div className="error">{errorText(attendanceQ.error)}</div>
        )}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Worker</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(attendanceQ.data?.attendance ?? []).map((a: any) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{a.worker?.displayName}</td>
                <td>{a.status}</td>
                <td>{a.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
