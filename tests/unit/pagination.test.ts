import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient, connection } from './helpers.js';

test('searchOpportunities no envía skip y pagina por cursor', async () => {
  const { client, calls } = fakeClient(() => ({
    opportunities: connection([{ id: 'opp-1', name: 'Chromebooks' }], true, 'CUR1', 3),
  }));

  const page = await client.searchOpportunities({ query: 'Chromebooks', limit: 1, cursor: 'CUR0' });

  const { query, variables } = calls[0];
  assert.doesNotMatch(query, /skip/);
  assert.match(query, /after: \$after/);
  assert.match(query, /pageInfo/);
  assert.deepEqual(variables.filter, { name: { ilike: '%Chromebooks%' } });
  assert.equal(variables.first, 1);
  assert.equal(variables.after, 'CUR0');
  assert.equal('skip' in variables, false);

  assert.equal(page.results[0].name, 'Chromebooks');
  assert.deepEqual(page.pageInfo, { hasNextPage: true, endCursor: 'CUR1' });
  assert.equal(page.totalCount, 3);
});

test('searchOpportunities filtra por etapa', async () => {
  const { client, calls } = fakeClient(() => ({ opportunities: connection([]) }));
  await client.searchOpportunities({ stage: 'PROPOSAL' });
  assert.deepEqual(calls[0].variables.filter, { stage: { eq: 'PROPOSAL' } });
  assert.equal(calls[0].variables.after, undefined);
});

test('searchPeople y searchCompanies pasan el cursor como after', async () => {
  const { client, calls } = fakeClient(call =>
    call.query.includes('people(')
      ? { people: connection([{ id: 'p1' }], false, null) }
      : { companies: connection([{ id: 'c1' }], true, 'NEXT') });

  const people = await client.searchPeople('ana', { limit: 5, cursor: 'A' });
  const companies = await client.searchCompanies('acme', { cursor: 'B' });

  assert.equal(calls[0].variables.after, 'A');
  assert.equal(calls[0].variables.first, 5);
  assert.equal(calls[1].variables.after, 'B');
  assert.equal(people.results[0].id, 'p1');
  assert.equal(people.pageInfo.hasNextPage, false);
  assert.equal(companies.pageInfo.endCursor, 'NEXT');
});
