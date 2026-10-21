/**
 * Prueba de punta a punta de TODAS las herramientas que escriben, a través de la
 * capa MCP (mismas herramientas que registra el servidor HTTP), contra Twenty real.
 *
 *   node --env-file=.env --import tsx scripts/e2e-write.ts
 *
 * Crea una empresa, un contacto, una oportunidad, una tarea y una nota con el
 * prefijo "TEST-MCP", las modifica, las lee y al final las manda a la papelera
 * con delete_record. Nunca borra un registro cuyo nombre no empiece con TEST-MCP.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { TwentyClient } from '../src/client/twenty-client.js';
import {
  registerPersonTools, registerCompanyTools, registerTaskTools, registerDeleteTools, registerMetadataTools,
} from '../src/tools/index.js';
import { registerOpportunityTools } from '../src/tools/opportunities.js';
import type { DeletableObject } from '../src/types/twenty.js';

const PREFIX = 'TEST-MCP';
const twenty = new TwentyClient({ apiKey: process.env.TWENTY_API_KEY!, baseUrl: process.env.TWENTY_BASE_URL! });
const server = new McpServer({ name: 'e2e', version: '1' });
for (const register of [registerPersonTools, registerCompanyTools, registerTaskTools, registerOpportunityTools, registerDeleteTools, registerMetadataTools]) {
  register(server, twenty);
}
const [a, b] = InMemoryTransport.createLinkedPair();
const mcp = new Client({ name: 'e2e', version: '1' });
await Promise.all([server.connect(a), mcp.connect(b)]);

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  const r = await mcp.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[])[0]?.text ?? '';
  if (r.isError || /^(Error|Failed)/.test(text)) throw new Error(`${name}: ${text.split('\n')[0].slice(0, 300)}`);
  return text;
}
const idFrom = (text: string) => text.match(/ID: ([0-9a-f-]{36})/)?.[1] ?? (() => { throw new Error(`sin ID en: ${text}`); })();
const json = (text: string) => JSON.parse(text.slice(text.indexOf('{')));
function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

let step = 0;
async function check(name: string, fn: () => Promise<string | void>) {
  step++;
  const detail = await fn();
  console.log(`✔ ${String(step).padStart(2)} ${name}${detail ? ` — ${detail}` : ''}`);
}

const stamp = new Date().toISOString().slice(0, 16);
// Twenty exige dominio y email únicos incluso contra registros en la papelera.
const runId = Date.now().toString(36);
const created: { type: DeletableObject; id: string }[] = [];
let failed = false;

try {
  let companyId = '', personId = '', opportunityId = '', taskId = '', noteId = '', memberId = '', stage = '';

  await check('list_workspace_members', async () => {
    const members = json(`{"m":${await call('list_workspace_members', {})}}`).m;
    memberId = members[0]?.id;
    expect(memberId, 'sin miembros');
    return `${members.length} miembro(s)`;
  });

  await check('create_company', async () => {
    companyId = idFrom(await call('create_company', {
      name: `${PREFIX} Empresa ${stamp}`, domainName: `test-mcp-${runId}.example`, address: 'Calle Prueba 1',
      annualRevenue: 1234.5, accountOwnerId: memberId,
    }));
    created.push({ type: 'company', id: companyId });
    return companyId;
  });

  await check('update_company + get_company', async () => {
    await call('update_company', { id: companyId, annualRevenue: 999, currency: 'USD' });
    const company = json(await call('get_company', { id: companyId }));
    expect(company.annualRevenue?.amountMicros === 999_000_000 && company.annualRevenue.currencyCode === 'USD', JSON.stringify(company.annualRevenue));
    expect(company.domainName?.primaryLinkUrl?.includes(`test-mcp-${runId}.example`), 'dominio no guardado');
    expect(company.accountOwnerId === memberId, 'accountOwner no guardado');
    return 'ingreso, dominio y responsable de cuenta guardados';
  });

  await check('search_companies encuentra la empresa', async () => {
    const page = json(await call('search_companies', { query: PREFIX, limit: 5 }));
    expect(page.results.some((c: any) => c.id === companyId), 'no aparece');
    return `${page.results.length} resultado(s)`;
  });

  await check('create_contact (teléfono nacional, empresa)', async () => {
    personId = idFrom(await call('create_contact', {
      firstName: PREFIX, lastName: `Contacto ${stamp}`, email: `test-mcp-${runId}@example.test`,
      phone: '81 1234 5678', jobTitle: 'Prueba', companyId,
    }));
    created.push({ type: 'person', id: personId });
    return personId;
  });

  await check('update_contact (solo apellido conserva el nombre) + get_contact', async () => {
    await call('update_contact', { id: personId, lastName: `Contacto editado ${stamp}`, phone: '+52 81 8765 4321' });
    const person = json(await call('get_contact', { id: personId }));
    expect(person.name.firstName === PREFIX, `nombre perdido: ${JSON.stringify(person.name)}`);
    expect(person.name.lastName.startsWith('Contacto editado'), 'apellido no actualizado');
    expect(person.emails?.primaryEmail === `test-mcp-${runId}@example.test`, 'email perdido');
    expect(person.companyId === companyId, 'empresa no vinculada');
    return `${person.name.firstName} ${person.name.lastName}, tel ${person.phones?.primaryPhoneNumber}`;
  });

  await check('search_contacts encuentra el contacto', async () => {
    const page = json(await call('search_contacts', { query: PREFIX, limit: 5 }));
    expect(page.results.some((p: any) => p.id === personId), 'no aparece');
    return `${page.results.length} resultado(s)`;
  });

  await check('create_opportunity', async () => {
    opportunityId = idFrom(await call('create_opportunity', {
      // Sin etapa: Twenty usa la etapa por defecto del workspace (las etapas pueden cambiar).
      name: `${PREFIX} Oportunidad ${stamp}`, amount: { value: 1500, currency: 'MXN' },
      closeDate: '2030-01-15', companyId, pointOfContactId: personId,
    }));
    created.push({ type: 'opportunity', id: opportunityId });
    return opportunityId;
  });

  await check('update_opportunity + get_opportunity', async () => {
    await call('update_opportunity', { id: opportunityId, amount: { value: 2500, currency: 'MXN' } });
    const text = await call('get_opportunity', { id: opportunityId });
    expect(text.includes('MXN 2500.00'), text);
    expect(text.includes(`Company ID: ${companyId}`) && text.includes(`Contact ID: ${personId}`), 'vínculos perdidos');
    stage = text.match(/Stage: (\S+)/)?.[1] ?? '';
    expect(stage && stage !== 'Not', `sin etapa: ${text}`);
    return text.split('\n').slice(1, 3).join(', ');
  });

  await check('search_opportunities por texto y por etapa', async () => {
    const byText = await call('search_opportunities', { query: PREFIX, limit: 5 });
    expect(byText.includes(opportunityId), 'no aparece por texto');
    const byStage = await call('search_opportunities', { query: PREFIX, stage, limit: 5 });
    expect(byStage.includes(opportunityId), 'no aparece por etapa');
    return `aparece en ambas (etapa ${stage})`;
  });

  await check('create_task vinculada a empresa, contacto y oportunidad', async () => {
    const text = await call('create_task', {
      title: `${PREFIX} Tarea ${stamp}`, body: 'Cuerpo **markdown** de prueba', status: 'TODO',
      dueAt: '2030-02-01T15:00:00.000Z', assigneeId: memberId, companyId, personId, opportunityId,
    });
    taskId = idFrom(text);
    created.push({ type: 'task', id: taskId });
    expect(text.includes('Linked to 3 record(s)'), text);
    return taskId;
  });

  await check('get_task trae body, responsable, vencimiento y 3 vínculos', async () => {
    const task = json(await call('get_task', { id: taskId }));
    expect(task.body?.includes('markdown'), `body: ${task.body}`);
    expect(task.assignee?.id === memberId, 'sin responsable');
    expect(task.dueAt?.startsWith('2030-02-01'), `dueAt: ${task.dueAt}`);
    expect(task.linkedTo.length === 3, JSON.stringify(task.linkedTo));
    return `${task.assignee.name ?? task.assignee.email}, vínculos: ${task.linkedTo.map((l: any) => l.type).join(', ')}`;
  });

  await check('update_task (estatus, body, quitar responsable y fecha)', async () => {
    const text = await call('update_task', { id: taskId, status: 'DONE', body: 'Cuerpo actualizado', assigneeId: null, dueAt: null });
    const task = json(text);
    expect(task.status === 'DONE' && task.body === 'Cuerpo actualizado', JSON.stringify(task));
    expect(task.assignee === null && !task.dueAt, `responsable/fecha no se quitaron: ${JSON.stringify([task.assignee, task.dueAt])}`);
    return 'DONE, body nuevo, sin responsable ni fecha';
  });

  await check('get_tasks filtra por oportunidad y por estatus', async () => {
    const byOpp = json(await call('get_tasks', { opportunityId }));
    expect(byOpp.results.length === 1 && byOpp.results[0].id === taskId, JSON.stringify(byOpp.results.map((t: any) => t.id)));
    const done = json(await call('get_tasks', { personId, status: 'DONE' }));
    const todo = json(await call('get_tasks', { personId, status: 'TODO' }));
    expect(done.results.some((t: any) => t.id === taskId) && !todo.results.some((t: any) => t.id === taskId), 'filtro de estatus');
    return 'ok';
  });

  await check('create_note vinculada a la oportunidad', async () => {
    const text = await call('create_note', { title: `${PREFIX} Nota ${stamp}`, body: 'Minuta de prueba', opportunityId });
    noteId = idFrom(text);
    created.push({ type: 'note', id: noteId });
    expect(text.includes('Linked to 1 record(s)'), text);
    return noteId;
  });

  await check('link_activity agrega la empresa a la nota + get_note', async () => {
    await call('link_activity', { kind: 'note', activityId: noteId, companyId });
    const note = json(await call('get_note', { id: noteId }));
    expect(note.body === 'Minuta de prueba', `body: ${note.body}`);
    expect(note.linkedTo.map((l: any) => l.type).sort().join() === 'company,opportunity', JSON.stringify(note.linkedTo));
    return 'vinculada a oportunidad y empresa';
  });

  await check('get_notes filtra por empresa', async () => {
    const page = json(await call('get_notes', { companyId }));
    expect(page.results.length === 1 && page.results[0].id === noteId, JSON.stringify(page.results.map((n: any) => n.id)));
    return 'ok';
  });

  await check('delete_record sin token no borra; token inventado se rechaza', async () => {
    const preview = await call('delete_record', { objectType: 'note', id: noteId });
    expect(preview.includes(`${PREFIX} Nota`) && preview.includes('Nothing has been deleted'), preview);
    const r = await mcp.callTool({ name: 'delete_record', arguments: { objectType: 'note', id: noteId, confirmationToken: 'inventado' } });
    expect(r.isError, 'aceptó un token inventado');
    expect(json(await call('get_note', { id: noteId })).id === noteId, 'la nota desapareció');
    return 'ok';
  });
} catch (error) {
  failed = true;
  console.log(`✖ ${step + 1} ${(error as Error).message}`);
} finally {
  // Limpieza con delete_record (vista previa + token), en orden inverso.
  for (const { type, id } of created.reverse()) {
    try {
      const preview = await call('delete_record', { objectType: type, id });
      const label = preview.match(/"([^"]*)"/)?.[1] ?? '';
      if (!label.startsWith(PREFIX)) throw new Error(`"${label}" no es de prueba; no se borra`);
      const token = preview.match(/confirmationToken: "([^"]+)"/)![1];
      await call('delete_record', { objectType: type, id, confirmationToken: token });
      const gone = await twenty.describeRecord(type, id);
      if (gone !== null) throw new Error('sigue visible después de borrar');
      console.log(`✔ limpieza: ${type} "${label}" a la papelera`);
    } catch (error) {
      failed = true;
      console.log(`✖ limpieza ${type} ${id}: ${(error as Error).message}`);
    }
  }
}

console.log(failed ? '\nHubo fallas' : '\nTodo OK');
process.exit(failed ? 1 : 0);
