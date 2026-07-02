import {
  ApolloClient,
  InMemoryCache,
  HttpLink,
  ApolloLink,
} from "@apollo/client";

// Module-level token storage. App state pushes the JWT here via setAuthToken.
let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

const httpLink = new HttpLink({
  uri: "http://localhost:4000/graphql",
});

const authLink = new ApolloLink((operation, forward) => {
  const token = getAuthToken();
  operation.setContext(({ headers = {} }: { headers?: Record<string, string> }) => ({
    headers: {
      ...headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }));
  return forward(operation);
});

export const apolloClient = new ApolloClient({
  link: ApolloLink.from([authLink, httpLink]),
  cache: new InMemoryCache(),
});
