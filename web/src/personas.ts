export interface Persona {
  label: string;
  role: "SUPER_ADMIN" | "MANAGER" | "WORKER";
  loginToken: string;
}

export const PERSONAS: Persona[] = [
  { label: "Alex Rivera — SUPER_ADMIN", role: "SUPER_ADMIN", loginToken: "admin-token" },
  { label: "Megan Garcia — MANAGER", role: "MANAGER", loginToken: "megan-garcia-token" },
  { label: "Priya Nair — MANAGER", role: "MANAGER", loginToken: "priya-nair-token" },
  { label: "Tom Reyes — WORKER", role: "WORKER", loginToken: "tom-reyes-token" },
  { label: "Jamie Cole — WORKER", role: "WORKER", loginToken: "jamie-cole-token" },
  { label: "Lin Huang — WORKER", role: "WORKER", loginToken: "lin-huang-token" },
];
