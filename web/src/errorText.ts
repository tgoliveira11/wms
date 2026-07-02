import { ApolloError } from "@apollo/client";

// Extracts a readable "message (CODE)" string from an ApolloError.
export function errorText(error: ApolloError | undefined): string | null {
  if (!error) return null;
  const gqlErr = error.graphQLErrors?.[0];
  if (gqlErr) {
    const code = gqlErr.extensions?.code;
    return code ? `${gqlErr.message} (${String(code)})` : gqlErr.message;
  }
  return error.message;
}
