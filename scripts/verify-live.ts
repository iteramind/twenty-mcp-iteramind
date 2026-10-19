/**
 * Verificación contra una instancia real de Twenty.
 *
 *   node --env-file=.env --import tsx scripts/verify-live.ts           # solo lectura
 *   node --env-file=.env --import tsx scripts/verify-live.ts --write   # + crea/borra registros TEST-MCP
 *
 * Variables (.env, nunca se imprimen): TWENTY_API_KEY, TWENTY_BASE_URL.
 * Opcionales: VERIFY_OPPORTUNITY_QUERY (default "Chromebooks"), VERIFY_STAGE.
 * Con --write: TEST_COMPANY_ID, TEST_PERSON_ID, TEST_OPPORTUNITY_ID (registros de prueba).
 */
import { TwentyClient } from '../src/client/twenty-client.js';

const apiKey = process.env.TWENTY_API_KEY;
const baseUrl = process.env.TWENTY_BASE_URL;
if (!apiKey || !baseUrl) {
  console.error('Faltan TWENTY_API_KEY y/o TWENTY_BASE_URL (ponlos en .env).');
  process.exit(1);
}
const write = process.argv.includes('--write');
const client = new TwentyClient({ apiKey, baseUrl });

let failures = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (error) {
    failures++;
    // Solo el mensaje: graphql-request incluye la petición, no los headers.
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.log(`✖ ${name} — ${message}`);
  }
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

const gql = (client as any).client;

await check('esquema: opportunities acepta after y no skip', async () => {
  const r = await gql.request(`{ __type(name: "Query") { fields { name args { name } } } }`);
  const opp = r.__type.fields.find((f: any) => f.name === 'opportunities');
  const args = opp.args.map((a: any) => a.name);
  assert(args.includes('after') && !args.includes('skip'), `args: ${args.join(',')}`);
  return args.join(', ');
});

await check('esquema: tipo del id en update/delete (UUID vs ID)', async () => {
  const r = await gql.request(`{ __type(name: "Mutation") { fields { name args { name type { kind name ofType { name } } } } } }`);
  const types = ['updateTask', 'deleteTask', 'updateOpportunity', 'updatePerson', 'updateCompany'].map(name => {
    const id = r.__type.fields.find((f: any) => f.name === name)?.args.find((a: any) => a.name === 'id');
    return `${name}(id: ${id?.type.ofType?.name ?? id?.type.name ?? '—'})`;
  });
  return types.join(', ');
});

await check('esquema: campos de Task y TaskTarget', async () => {
  const fields = async (t: string) =>
    (await gql.request(`query($t: String!) { __type(name: $t) { fields { name } } }`, { t })).__type.fields.map((f: any) => f.name);
  const task = await fields('Task');
  const target = await fields('TaskTarget');
  for (const f of ['bodyV2', 'assignee', 'dueAt', 'taskTargets']) assert(task.includes(f), `Task sin ${f}`);
  return `Task.body ${task.includes('body') ? 'existe (obsoleto)' : 'no existe'}; TaskTarget: ${target.filter((f: string) => /Id$/.test(f)).join(', ')}`;
});

const oppQuery = process.env.VERIFY_OPPORTUNITY_QUERY || 'Chromebooks';
await check(`search_opportunities por texto "${oppQuery}"`, async () => {
  const page = await client.searchOpportunities({ query: oppQuery, limit: 5 });
  return `${page.results.length} resultado(s), total ${page.totalCount}: ${page.results.map(o => `${o.name} [${o.id}]`).join('; ')}`;
});

await check('search_opportunities por etapa + paginación', async () => {
  const stage = process.env.VERIFY_STAGE || (await client.searchOpportunities({ limit: 1 })).results[0]?.stage;
  const first = await client.searchOpportunities({ stage, limit: 2 });
  if (!first.pageInfo.hasNextPage) return `una sola página (${first.results.length})`;
  const second = await client.searchOpportunities({ stage, limit: 2, cursor: first.pageInfo.endCursor! });
  const overlap = second.results.some(o => first.results.some(f => f.id === o.id));
  assert(!overlap, 'la página 2 repite registros de la página 1');
  return `página 1: ${first.results.length}, página 2: ${second.results.length}, total ${first.totalCount}${stage ? ` (etapa ${stage})` : ''}`;
});

await check('search_contacts / search_companies paginan', async () => {
  const people = await client.searchPeople('a', { limit: 2 });
  const companies = await client.searchCompanies('a', { limit: 2 });
  if (people.pageInfo.hasNextPage) {
    const next = await client.searchPeople('a', { limit: 2, cursor: people.pageInfo.endCursor! });
    assert(!next.results.some(p => people.results.some(q => q.id === p.id)), 'contactos repetidos entre páginas');
  }
  return `contactos total ${people.totalCount}, empresas total ${companies.totalCount}`;
});

await check('get_tasks respeta limit y trae detalle', async () => {
  const page = await client.listActivities('task', { limit: 3 });
  assert(page.results.length <= 3, `pidió 3, recibió ${page.results.length}`);
  // Recorre todas las páginas (Twenty limita registros por consulta).
  const all = { results: [] as Awaited<ReturnType<typeof client.listActivities>>['results'], totalCount: 0 as number | undefined };
  let cursor: string | undefined;
  do {
    const p = await client.listActivities('task', { limit: 60, cursor });
    all.results.push(...p.results);
    all.totalCount = p.totalCount;
    cursor = p.pageInfo.hasNextPage ? p.pageInfo.endCursor ?? undefined : undefined;
  } while (cursor);
  assert(all.totalCount === undefined || all.results.length === all.totalCount, `paginación incompleta: ${all.results.length}/${all.totalCount}`);
  const withBody = all.results.filter(t => t.body && t.body.trim()).length;
  const withAssignee = all.results.filter(t => t.assignee).length;
  const withLinks = all.results.filter(t => t.linkedTo.length).length;
  const withDue = all.results.filter(t => t.dueAt).length;
  return `total ${all.totalCount}; con body ${withBody}, responsable ${withAssignee}, vinculadas ${withLinks}, vencimiento ${withDue}`;
});

await check('get_notes', async () => {
  const page = await client.listActivities('note', { limit: 5 });
  return `total ${page.totalCount}; con body ${page.results.filter(n => n.body).length}/${page.results.length}`;
});

await check('tope de registros por consulta (QUERY_MAX_RECORDS)', async () => {
  try {
    const r = await gql.request(`{ tasks(first: 200) { edges { node { id } } totalCount } }`);
    const got = r.tasks.edges.length, total = r.tasks.totalCount;
    if (got < Math.min(200, total)) return `first: 200 → ${got} de ${total}: Twenty recorta en silencio`;
    return `first: 200 aceptado (${got} de ${total}); no se puede saber el tope con tan pocos registros`;
  } catch (error) {
    return `first: 200 → rechazado: ${(error as Error).message.split('\n')[0].slice(0, 120)}`;
  }
});

await check('list_opportunities_by_stage recorre todas las páginas', async () => {
  const grouped = await client.listOpportunitiesByStage();
  const count = Object.values(grouped).reduce((n, list) => n + list.length, 0);
  const total = (await client.searchOpportunities({ limit: 1 })).totalCount;
  assert(total === undefined || count === total, `${count}/${total}`);
  return `${count} oportunidades en ${Object.keys(grouped).length} etapas`;
});

await check('list_workspace_members', async () => `${(await client.listWorkspaceMembers()).length} miembro(s)`);

await check('descubrimiento de esquema (/metadata)', async () => {
  const objects = await client.listAllObjects({});
  return `${objects.standard.length} estándar, ${objects.custom.length} personalizados`;
});

if (write) {
  const companyId = process.env.TEST_COMPANY_ID;
  const personId = process.env.TEST_PERSON_ID;
  const opportunityId = process.env.TEST_OPPORTUNITY_ID;
  const stamp = new Date().toISOString();
  let taskId: string | undefined;
  let noteId: string | undefined;

  await check('create_task + vínculo', async () => {
    assert(companyId || personId || opportunityId, 'define al menos uno de TEST_COMPANY_ID / TEST_PERSON_ID / TEST_OPPORTUNITY_ID');
    const task = await client.createTask({ title: `TEST-MCP tarea ${stamp}`, body: 'Creada por verify-live', status: 'TODO' });
    taskId = task.id!;
    await client.linkActivity({ kind: 'task', activityId: taskId, companyId, personId, opportunityId });
    const read = await client.getActivity('task', taskId);
    assert(read?.body === 'Creada por verify-live', `body leído: ${read?.body}`);
    assert(read!.linkedTo.length > 0, 'sin vínculos');
    return `${taskId}, vinculada a ${read!.linkedTo.map(l => l.type).join(', ')}`;
  });

  await check('update_task', async () => {
    assert(taskId, 'no hay tarea');
    const members = await client.listWorkspaceMembers();
    const updated = await client.updateTask(taskId, {
      status: 'IN_PROGRESS', body: 'Actualizada', dueAt: '2030-01-01T00:00:00.000Z', assigneeId: members[0]?.id,
    });
    assert(updated?.status === 'IN_PROGRESS' && updated.body === 'Actualizada', JSON.stringify(updated));
    return `estatus ${updated.status}, responsable ${updated.assignee?.name ?? '—'}, vence ${updated.dueAt}`;
  });

  await check('filtro get_tasks por registro vinculado', async () => {
    const page = await client.listActivities('task', { companyId, personId, opportunityId });
    assert(page.results.some(t => t.id === taskId), 'la tarea de prueba no aparece en el filtro');
    return `${page.results.length} tarea(s)`;
  });

  await check('create_note + vínculo + get_note', async () => {
    const note = await client.createNote({ title: `TEST-MCP nota ${stamp}`, body: 'Nota de prueba' });
    noteId = note.id!;
    await client.linkActivity({ kind: 'note', activityId: noteId, companyId, personId, opportunityId });
    const read = await client.getActivity('note', noteId);
    assert(read?.body === 'Nota de prueba' && read.linkedTo.length > 0, JSON.stringify(read));
    return noteId;
  });

  await check('delete_record (limpieza)', async () => {
    for (const [type, id] of [['task', taskId], ['note', noteId]] as const) {
      if (!id) continue;
      assert((await client.describeRecord(type, id))?.startsWith('TEST-MCP'), `${type} ${id} no es de prueba; no se borra`);
      await client.deleteRecord(type, id);
    }
    return 'tarea y nota de prueba enviadas a la papelera';
  });
}

console.log(failures ? `\n${failures} verificación(es) fallaron` : '\nTodo OK');
process.exit(failures ? 1 : 0);
