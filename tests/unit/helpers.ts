import { TwentyClient } from '../../src/client/twenty-client.js';

export interface RecordedCall {
  query: string;
  variables: Record<string, any>;
}

// Crea un TwentyClient cuyo GraphQLClient está reemplazado por un doble que
// registra cada llamada y responde con lo que devuelva `respond`.
export function fakeClient(respond: (call: RecordedCall) => any) {
  const calls: RecordedCall[] = [];
  const client = new TwentyClient({ apiKey: 'test-key', baseUrl: 'http://twenty.test' });
  const fake = {
    request: async (query: string, variables: Record<string, any> = {}) => {
      const call = { query, variables };
      calls.push(call);
      return respond(call);
    },
    setHeader: () => {},
  };
  (client as any).client = fake;
  (client as any).metadataClient = fake;
  return { client, calls };
}

export function connection<T>(nodes: T[], hasNextPage = false, endCursor: string | null = null, totalCount?: number) {
  return {
    edges: nodes.map(node => ({ node })),
    pageInfo: { hasNextPage, endCursor },
    totalCount,
  };
}
