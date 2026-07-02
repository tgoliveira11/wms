import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import { verifyToken, type AuthUser } from '@wfms/shared';
import { typeDefs } from './schema';
import { resolvers, type GatewayContext } from './resolvers';

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  const server = new ApolloServer<GatewayContext>({ typeDefs, resolvers });

  const { url } = await startStandaloneServer(server, {
    listen: { port: PORT },
    context: async ({ req }): Promise<GatewayContext> => {
      const header = req.headers.authorization;
      let token: string | undefined;
      let user: AuthUser | undefined;
      if (header?.startsWith('Bearer ')) {
        token = header.slice('Bearer '.length).trim();
        try {
          user = verifyToken(token);
        } catch {
          // Invalid token — leave user undefined; protected resolvers throw UNAUTHENTICATED.
          user = undefined;
        }
      }
      return {
        token,
        user,
        cache: { users: new Map(), locations: new Map() },
      };
    },
  });

  // eslint-disable-next-line no-console
  console.log(`[gateway] ready at ${url}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[gateway] failed to start', err);
  process.exit(1);
});
