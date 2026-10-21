import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeClient, connection, RecordedCall } from './helpers.js';

// Responde a la introspección de TaskTarget con la variante de esquema pedida.
function schema(prefix: '' | 'target') {
  return (call: RecordedCall) => call.query.includes('__type')
    ? { __type: { fields: [{ name: 'id' }, { name: prefix ? 'targetCompanyId' : 'companyId' }] } }
    : undefined;
}

const taskNode = (p: '' | 'target') => ({
  id: 't1',
  title: 'Cotizar Chromebooks',
  bodyV2: { markdown: 'Pedir precio a CT' },
  status: 'TODO',
  dueAt: '2026-10-30T00:00:00Z',
  assigneeId: 'wm1',
  assignee: { id: 'wm1', name: { firstName: 'Ana', lastName: 'Ruiz' }, userEmail: 'ana@example.test' },
  taskTargets: connection([
    { id: 'tt1', [p ? 'targetOpportunity' : 'opportunity']: { id: 'o1', name: 'Chromebooks' } },
    { id: 'tt2', [p ? 'targetCompany' : 'company']: { id: 'c1', name: 'Acme' } },
  ]),
});

for (const p of ['target', ''] as const) {
  test(`get_tasks devuelve responsable, vencimiento, body y vínculos (esquema "${p || 'legacy'}")`, async () => {
    const { client, calls } = fakeClient(call =>
      schema(p)(call) ?? { tasks: connection([taskNode(p)], true, 'NEXT', 47) });

    const page = await client.listActivities('task', { limit: 1 });
    const listQuery = calls.find(c => c.query.includes('tasks('))!;

    assert.match(listQuery.query, /bodyV2 \{ markdown \}/);
    assert.match(listQuery.query, /assignee \{/);
    assert.match(listQuery.query, new RegExp(`${p ? 'targetOpportunity' : '\\bopportunity'} \\{ id name \\}`));
    assert.equal(listQuery.variables.first, 1);

    assert.deepEqual(page.results[0], {
      id: 't1',
      title: 'Cotizar Chromebooks',
      body: 'Pedir precio a CT',
      status: 'TODO',
      dueAt: '2026-10-30T00:00:00Z',
      assignee: { id: 'wm1', name: 'Ana Ruiz', email: 'ana@example.test' },
      linkedTo: [
        { type: 'opportunity', id: 'o1', name: 'Chromebooks' },
        { type: 'company', id: 'c1', name: 'Acme' },
      ],
      createdAt: undefined,
      updatedAt: undefined,
    });
    assert.deepEqual(page.pageInfo, { hasNextPage: true, endCursor: 'NEXT' });
    assert.equal(page.totalCount, 47);
  });

  test(`linkActivity usa los nombres de columna del esquema "${p || 'legacy'}"`, async () => {
    const { client, calls } = fakeClient(call =>
      schema(p)(call) ?? { createNoteTarget: { id: 'nt1' } });
    await client.linkActivity({ kind: 'note', activityId: 'n1', opportunityId: 'o1' });
    const link = calls.find(c => c.query.includes('createNoteTarget'))!;
    assert.deepEqual(link.variables.data, { noteId: 'n1', [p ? 'targetOpportunityId' : 'opportunityId']: 'o1' });
  });
}

test('filtrar tareas por oportunidad consulta taskTargets y luego tasks por id', async () => {
  const { client, calls } = fakeClient(call => schema('target')(call)
    ?? (call.query.includes('taskTargets(')
      ? { taskTargets: connection([{ taskId: 't1' }, { taskId: 't2' }, { taskId: null }]) }
      : { tasks: connection([]) }));

  await client.listActivities('task', { opportunityId: 'o1', status: 'TODO' });

  const targets = calls.find(c => c.query.includes('taskTargets('))!;
  assert.deepEqual(targets.variables.filter, { targetOpportunityId: { eq: 'o1' } });
  const list = calls.find(c => c.query.includes('ListTasks'))!;
  assert.deepEqual(list.variables.filter, { status: { eq: 'TODO' }, id: { in: ['t1', 't2'] } });
});

test('sin tareas vinculadas no consulta tasks', async () => {
  const { client, calls } = fakeClient(call => schema('target')(call) ?? { noteTargets: connection([]) });
  const page = await client.listActivities('note', { companyId: 'c1' });
  assert.equal(page.results.length, 0);
  assert.equal(calls.some(c => c.query.includes('ListNotes')), false);
});

test('updateTask manda solo los campos dados y convierte body a bodyV2', async () => {
  const { client, calls } = fakeClient(call => schema('target')(call)
    ?? (call.query.includes('updateTask') ? { updateTask: { id: 't1' } } : { tasks: connection([taskNode('target')]) }));

  const task = await client.updateTask('t1', { status: 'DONE', body: 'Listo', assigneeId: null });

  const update = calls.find(c => c.query.includes('updateTask'))!;
  assert.match(update.query, /\$id: UUID!/);
  assert.deepEqual(update.variables, { id: 't1', data: { status: 'DONE', assigneeId: null, bodyV2: { markdown: 'Listo' } } });
  assert.equal(task?.id, 't1');
});

test('createNote no manda authorId y guarda el body en bodyV2', async () => {
  const { client, calls } = fakeClient(() => ({ createNote: { id: 'n1', title: 'Minuta' } }));
  await client.createNote({ title: 'Minuta', body: 'Texto', authorId: 'x' });
  assert.deepEqual(calls[0].variables.data, { title: 'Minuta', bodyV2: { markdown: 'Texto' } });
});

test('describeRecord y deleteRecord', async () => {
  const { client, calls } = fakeClient(call => call.query.includes('deletePerson')
    ? { deletePerson: { id: 'p1' } }
    : { people: connection([{ id: 'p1', name: { firstName: 'Ana', lastName: 'Ruiz' } }]) });

  assert.equal(await client.describeRecord('person', 'p1'), 'Ana Ruiz');
  assert.equal(await client.deleteRecord('person', 'p1'), 'p1');
  assert.match(calls[1].query, /deletePerson\(id: \$id\)/);
});
