import { useState } from "react";
import { useApolloClient, useMutation } from "@apollo/client";
import { LOGIN, ME } from "./graphql";
import { PERSONAS } from "./personas";
import { setAuthToken } from "./apollo";
import { errorText } from "./errorText";
import Worker from "./views/Worker";
import Manager from "./views/Manager";
import SuperAdmin from "./views/SuperAdmin";

interface MeUser {
  id: string;
  externalId: string;
  displayName: string;
  role: "WORKER" | "MANAGER" | "SUPER_ADMIN";
  locations: {
    id: string;
    name: string;
    selfCheckInEnabled: boolean;
    managerAttendanceMarkingEnabled: boolean;
  }[];
}

export default function App() {
  const client = useApolloClient();
  const [me, setMe] = useState<MeUser | null>(null);
  const [selectedToken, setSelectedToken] = useState<string>("");
  const [login, loginState] = useMutation(LOGIN);

  const switchPersona = async (loginToken: string) => {
    setSelectedToken(loginToken);
    if (!loginToken) return;
    try {
      const res = await login({ variables: { loginToken } });
      const token: string | undefined = res.data?.login?.token;
      if (!token) return;
      // Push JWT into module-level store used by the auth link.
      setAuthToken(token);
      // Reset cache so all queries re-run with the new identity.
      await client.resetStore();
      // Fetch the authenticated user with their locations.
      const meRes = await client.query({
        query: ME,
        fetchPolicy: "network-only",
      });
      setMe(meRes.data?.me ?? null);
    } catch {
      setMe(null);
    }
  };

  return (
    <>
      <div className="topbar">
        <strong>WMS</strong>
        <label style={{ margin: 0 }}>
          <select
            value={selectedToken}
            onChange={(e) => switchPersona(e.target.value)}
          >
            <option value="">— Select persona —</option>
            {PERSONAS.map((p) => (
              <option key={p.loginToken} value={p.loginToken}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <span className="user">
          {me ? `${me.displayName} · ${me.role}` : "not signed in"}
        </span>
      </div>

      {errorText(loginState.error) && (
        <main>
          <div className="error">{errorText(loginState.error)}</div>
        </main>
      )}

      {!me && !loginState.loading && (
        <main>
          <section>
            <p className="muted">Select a persona above to sign in.</p>
          </section>
        </main>
      )}

      {me?.role === "WORKER" && <Worker key={me.id} me={me} />}
      {me?.role === "MANAGER" && <Manager key={me.id} me={me} />}
      {me?.role === "SUPER_ADMIN" && <SuperAdmin key={me.id} />}
    </>
  );
}
