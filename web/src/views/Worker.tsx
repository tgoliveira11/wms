import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import {
  MY_ATTENDANCE,
  MY_ATTENDANCE_REQUESTS,
  CREATE_ATTENDANCE_REQUEST,
  CANCEL_ATTENDANCE_REQUEST,
} from "../graphql";
import { errorText } from "../errorText";

interface LocationLite {
  id: string;
  name: string;
  selfCheckInEnabled: boolean;
  managerAttendanceMarkingEnabled: boolean;
}

interface Me {
  id: string;
  displayName: string;
  locations: LocationLite[];
}

export default function Worker({ me }: { me: Me }) {
  const locations = me.locations ?? [];
  const [locationId, setLocationId] = useState<string>(locations[0]?.id ?? "");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState<"CHECK_IN_OUT" | "OFF">("CHECK_IN_OUT");
  const [note, setNote] = useState<string>("");

  const attendanceQ = useQuery(MY_ATTENDANCE);
  const requestsQ = useQuery(MY_ATTENDANCE_REQUESTS);

  const [createRequest, createState] = useMutation(CREATE_ATTENDANCE_REQUEST, {
    onCompleted: () => {
      setNote("");
      requestsQ.refetch();
      attendanceQ.refetch();
    },
  });
  const [cancelRequest, cancelState] = useMutation(CANCEL_ATTENDANCE_REQUEST, {
    onCompleted: () => requestsQ.refetch(),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!locationId) return;
    createRequest({
      variables: { locationId, date, kind, note: note || null },
    }).catch(() => {});
  };

  return (
    <main>
      <section>
        <h2>Submit Attendance Request</h2>
        {locations.length === 0 && (
          <p className="muted">You are not a member of any location.</p>
        )}
        <form onSubmit={submit}>
          <div className="form-row">
            <label>
              <span>Location</span>
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
            <label>
              <span>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              <span>Kind</span>
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as "CHECK_IN_OUT" | "OFF")
                }
              >
                <option value="CHECK_IN_OUT">CHECK_IN_OUT</option>
                <option value="OFF">OFF</option>
              </select>
            </label>
            <label>
              <span>Note</span>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="optional"
              />
            </label>
            <button type="submit" disabled={createState.loading || !locationId}>
              Submit
            </button>
          </div>
        </form>
        {errorText(createState.error) && (
          <div className="error">{errorText(createState.error)}</div>
        )}
      </section>

      <section>
        <h2>My Requests</h2>
        {errorText(requestsQ.error) && (
          <div className="error">{errorText(requestsQ.error)}</div>
        )}
        {errorText(cancelState.error) && (
          <div className="error">{errorText(cancelState.error)}</div>
        )}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Location</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(requestsQ.data?.myAttendanceRequests ?? []).map((r: any) => (
              <tr key={r.id}>
                <td>{r.date}</td>
                <td>{r.location?.name}</td>
                <td>{r.kind}</td>
                <td>{r.status}</td>
                <td>{r.note}</td>
                <td>
                  {r.status === "PENDING" && (
                    <button
                      className="danger"
                      disabled={cancelState.loading}
                      onClick={() =>
                        cancelRequest({ variables: { id: r.id } }).catch(
                          () => {}
                        )
                      }
                    >
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>My Attendance</h2>
        {errorText(attendanceQ.error) && (
          <div className="error">{errorText(attendanceQ.error)}</div>
        )}
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Location</th>
              <th>Status</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {(attendanceQ.data?.myAttendance ?? []).map((a: any) => (
              <tr key={a.id}>
                <td>{a.date}</td>
                <td>{a.location?.name}</td>
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
