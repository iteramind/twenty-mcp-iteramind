import { GraphQLClient } from 'graphql-request';
import {
  TwentyConfig, Person, Company, Task, Note, SearchOptions, Page,
  ActivityKind, ActivityDetail, ActivityQuery, LinkedRecord, TaskUpdate, DeletableObject,
} from '../types/twenty.js';
import { Opportunity, CreateOpportunityInput, UpdateOpportunityInput, SearchOpportunitiesInput } from '../types/opportunities.js';
import { Activity, Comment, CreateCommentInput, ActivityFilter, EntityActivitiesInput, ActivityTimeline } from '../types/activities.js';
import { ObjectMetadata, FieldMetadata, ObjectSchema, ObjectSummary, MetadataQueryOptions, FieldQueryOptions } from '../types/metadata.js';
import { 
  RelationshipSummary, 
  CompanyContactsResult, 
  PersonOpportunitiesResult, 
  OpportunityActivitiesResult,
  RelationshipHierarchy,
  OrphanedRecords,
  LinkOpportunityInput,
  TransferContactInput,
  BulkRelationshipUpdate
} from '../types/relationships.js';

type Connection<T> = {
  edges: { node: T }[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  totalCount?: number;
};

// '' para columnas companyId/personId/opportunityId (versiones anteriores),
// 'target' para targetCompanyId/targetPersonId/targetOpportunityId.
type TargetPrefix = '' | 'target';

const PLURALS: Record<DeletableObject, string> = {
  task: 'tasks',
  note: 'notes',
  company: 'companies',
  person: 'people',
  opportunity: 'opportunities',
};

// Twenty limita los registros por consulta (QUERY_MAX_RECORDS, 60 por defecto).
export const MAX_PAGE_SIZE = 60;
const pageSize = (limit?: number) => Math.min(Math.max(limit || 20, 1), MAX_PAGE_SIZE);

// Error de Twenty por token vencido o inválido.
export function isAuthError(error: unknown): boolean {
  const response = (error as { response?: { status?: number; errors?: { message?: string; extensions?: { code?: string } }[] } })?.response;
  if (response?.status === 401) return true;
  return (response?.errors ?? []).some(e =>
    e.extensions?.code === 'UNAUTHENTICATED' || /token has expired|must be authenticated/i.test(e.message ?? ''));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function targetField(p: TargetPrefix, base: 'company' | 'person' | 'opportunity'): string {
  return p ? `target${capitalize(base)}` : base;
}

function personName(name?: { firstName?: string; lastName?: string } | null): string | undefined {
  if (!name) return undefined;
  return `${name.firstName ?? ''} ${name.lastName ?? ''}`.trim() || undefined;
}

export class TwentyClient {
  private client: GraphQLClient;
  // Objetos y campos (incluidos los personalizados) se consultan en /metadata, no en /graphql.
  private metadataClient: GraphQLClient;
  private baseUrl: string;

  constructor(config: TwentyConfig) {
    this.baseUrl = config.baseUrl || 'https://api.twenty.com';
    const headers = {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    };
    this.client = this.watchAuth(new GraphQLClient(`${this.baseUrl}/graphql`, { headers }));
    this.metadataClient = this.watchAuth(new GraphQLClient(`${this.baseUrl}/metadata`, { headers: { ...headers } }));
  }

  // Se llama cuando Twenty rechaza el token; el servidor HTTP lo usa para
  // responder 401 en la siguiente petición y que el cliente renueve.
  onAuthError?: () => void;

  private watchAuth(gql: GraphQLClient): GraphQLClient {
    const request = gql.request.bind(gql) as (...args: unknown[]) => Promise<unknown>;
    (gql as unknown as { request: typeof request }).request = async (...args) => {
      try {
        return await request(...args);
      } catch (error) {
        if (isAuthError(error)) this.onAuthError?.();
        throw error;
      }
    };
    return gql;
  }

  // Permite que una sesión MCP siga funcionando cuando el cliente renueva su token.
  setApiKey(apiKey: string): void {
    this.client.setHeader('Authorization', `Bearer ${apiKey}`);
    this.metadataClient.setHeader('Authorization', `Bearer ${apiKey}`);
  }

  // Twenty no acepta `skip`/`offset`: la paginación es por cursor (first/after).
  private toPage<T>(connection: Connection<T>): Page<T> {
    return {
      results: connection.edges.map(edge => edge.node),
      pageInfo: {
        hasNextPage: connection.pageInfo?.hasNextPage ?? false,
        endCursor: connection.pageInfo?.endCursor ?? null,
      },
      totalCount: connection.totalCount,
    };
  }

  async createPerson(person: Person): Promise<Person> {
    const mutation = `
      mutation CreatePerson($data: PersonCreateInput!) {
        createPerson(data: $data) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          phones {
            primaryPhoneNumber
            primaryPhoneCountryCode
          }
          companyId
          jobTitle
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          avatarUrl
        }
      }
    `;

    const result = await this.client.request(mutation, { data: person }) as { createPerson: Person };
    return result.createPerson;
  }

  async getPerson(id: string): Promise<Person> {
    const query = `
      query GetPerson($filter: PersonFilterInput!) {
        people(filter: $filter) {
          edges {
            node {
              id
              name {
                firstName
                lastName
              }
              emails {
                primaryEmail
              }
              phones {
                primaryPhoneNumber
                primaryPhoneCountryCode
              }
              companyId
              jobTitle
              linkedinLink {
                primaryLinkUrl
                primaryLinkLabel
              }
              avatarUrl
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { filter: { id: { eq: id } } }) as { people: { edges: { node: Person }[] } };
    return result.people.edges[0]?.node;
  }

  async updatePerson(id: string, updates: Partial<Person>): Promise<Person> {
    const mutation = `
      mutation UpdatePerson($id: ID!, $data: PersonUpdateInput!) {
        updatePerson(id: $id, data: $data) {
          id
          name {
            firstName
            lastName
          }
          emails {
            primaryEmail
          }
          phones {
            primaryPhoneNumber
            primaryPhoneCountryCode
          }
          companyId
          jobTitle
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          avatarUrl
        }
      }
    `;

    const result = await this.client.request(mutation, { id, data: updates }) as { updatePerson: Person };
    return result.updatePerson;
  }

  async searchPeople(query: string, options: SearchOptions = {}): Promise<Page<Person>> {
    const searchQuery = `
      query SearchPeople($filter: PersonFilterInput, $first: Int, $after: String) {
        people(filter: $filter, first: $first, after: $after) {
          edges {
            node {
              id
              name {
                firstName
                lastName
              }
              emails {
                primaryEmail
              }
              phones {
                primaryPhoneNumber
                primaryPhoneCountryCode
              }
              companyId
              jobTitle
              linkedinLink {
                primaryLinkUrl
                primaryLinkLabel
              }
              avatarUrl
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const filter = {
      or: [
        { name: { firstName: { ilike: `%${query}%` } } },
        { name: { lastName: { ilike: `%${query}%` } } },
        { emails: { primaryEmail: { ilike: `%${query}%` } } }
      ]
    };

    const result = await this.client.request(searchQuery, {
      filter,
      first: pageSize(options.limit),
      after: options.cursor,
    }) as { people: Connection<Person> };

    return this.toPage(result.people);
  }

  async createCompany(company: Company): Promise<Company> {
    const mutation = `
      mutation CreateCompany($data: CompanyCreateInput!) {
        createCompany(data: $data) {
          id
          name
          domainName {
            primaryLinkUrl
            primaryLinkLabel
          }
          address {
            addressStreet1
            addressCity
            addressState
            addressCountry
            addressPostcode
          }
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          annualRevenue {
            amountMicros
            currencyCode
          }
          accountOwnerId
        }
      }
    `;

    const result = await this.client.request(mutation, { data: company }) as { createCompany: Company };
    return result.createCompany;
  }

  async getCompany(id: string): Promise<Company> {
    const query = `
      query GetCompany($filter: CompanyFilterInput!) {
        companies(filter: $filter) {
          edges {
            node {
              id
              name
              domainName {
                primaryLinkUrl
                primaryLinkLabel
              }
              address {
                addressStreet1
                addressCity
                addressState
                addressCountry
                addressPostcode
              }
              linkedinLink {
                primaryLinkUrl
                primaryLinkLabel
              }
              annualRevenue {
                amountMicros
                currencyCode
              }
              accountOwnerId
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { filter: { id: { eq: id } } }) as { companies: { edges: { node: Company }[] } };
    return result.companies.edges[0]?.node;
  }

  async updateCompany(id: string, updates: Partial<Company>): Promise<Company> {
    const mutation = `
      mutation UpdateCompany($id: ID!, $data: CompanyUpdateInput!) {
        updateCompany(id: $id, data: $data) {
          id
          name
          domainName {
            primaryLinkUrl
            primaryLinkLabel
          }
          address {
            addressStreet1
            addressCity
            addressState
            addressCountry
            addressPostcode
          }
          linkedinLink {
            primaryLinkUrl
            primaryLinkLabel
          }
          annualRevenue {
            amountMicros
            currencyCode
          }
          accountOwnerId
        }
      }
    `;

    const result = await this.client.request(mutation, { id, data: updates }) as { updateCompany: Company };
    return result.updateCompany;
  }

  async searchCompanies(query: string, options: SearchOptions = {}): Promise<Page<Company>> {
    const searchQuery = `
      query SearchCompanies($filter: CompanyFilterInput, $first: Int, $after: String) {
        companies(filter: $filter, first: $first, after: $after) {
          edges {
            node {
              id
              name
              domainName {
                primaryLinkUrl
                primaryLinkLabel
              }
              address {
                addressStreet1
                addressCity
                addressState
                addressCountry
                addressPostcode
              }
              linkedinLink {
                primaryLinkUrl
                primaryLinkLabel
              }
              annualRevenue {
                amountMicros
                currencyCode
              }
              accountOwnerId
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const filter = {
      or: [
        { name: { ilike: `%${query}%` } },
        { domainName: { primaryLinkUrl: { ilike: `%${query}%` } } }
      ]
    };

    const result = await this.client.request(searchQuery, {
      filter,
      first: pageSize(options.limit),
      after: options.cursor,
    }) as { companies: Connection<Company> };

    return this.toPage(result.companies);
  }

  // --- Tareas y notas ----------------------------------------------------
  //
  // Twenty reemplazó el campo de texto plano `body` por `bodyV2` (texto
  // enriquecido). Las herramientas siguen usando `body` como texto markdown:
  // aquí lo convertimos a `bodyV2: { markdown }` al escribir y de regreso al leer.
  private toBodyV2(body?: string) {
    return body !== undefined ? { bodyV2: { markdown: body } } : {};
  }

  // Los registros vinculados viven en taskTargets / noteTargets. Según la
  // versión de Twenty sus columnas se llaman `companyId` o `targetCompanyId`;
  // lo detectamos una vez por introspección.
  private targetPrefix?: Promise<TargetPrefix>;

  private getTargetPrefix(): Promise<TargetPrefix> {
    if (!this.targetPrefix) {
      this.targetPrefix = this.client
        .request(`{ __type(name: "TaskTarget") { fields { name } } }`)
        .then((r: any) => {
          const names: string[] = (r.__type?.fields ?? []).map((f: { name: string }) => f.name);
          return names.includes('targetCompanyId') ? 'target' : '';
        })
        // Sin introspección (deshabilitada o error): asumimos el esquema actual.
        .catch(() => 'target' as const);
    }
    return this.targetPrefix;
  }

  private activitySelection(kind: ActivityKind, p: TargetPrefix): string {
    const taskFields = kind === 'task'
      ? `status
          dueAt
          assigneeId
          assignee { id name { firstName lastName } userEmail }`
      : '';
    return `
          id
          title
          bodyV2 { markdown }
          createdAt
          updatedAt
          ${taskFields}
          ${kind}Targets {
            edges {
              node {
                id
                ${targetField(p, 'company')} { id name }
                ${targetField(p, 'person')} { id name { firstName lastName } }
                ${targetField(p, 'opportunity')} { id name }
              }
            }
          }`;
  }

  private toActivityDetail(kind: ActivityKind, p: TargetPrefix, node: any): ActivityDetail {
    const linkedTo: LinkedRecord[] = [];
    for (const { node: t } of node[`${kind}Targets`]?.edges ?? []) {
      const company = t[targetField(p, 'company')];
      const person = t[targetField(p, 'person')];
      const opportunity = t[targetField(p, 'opportunity')];
      if (company) linkedTo.push({ type: 'company', id: company.id, name: company.name });
      if (person) linkedTo.push({ type: 'person', id: person.id, name: personName(person.name) });
      if (opportunity) linkedTo.push({ type: 'opportunity', id: opportunity.id, name: opportunity.name });
    }

    const detail: ActivityDetail = {
      id: node.id,
      title: node.title,
      body: node.bodyV2?.markdown ?? null,
      linkedTo,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
    if (kind === 'task') {
      detail.status = node.status;
      detail.dueAt = node.dueAt;
      detail.assignee = node.assignee
        ? { id: node.assignee.id, name: personName(node.assignee.name), email: node.assignee.userEmail }
        : null;
    }
    return detail;
  }

  // IDs de tareas/notas vinculadas a TODOS los registros indicados.
  private async activityIdsLinkedTo(kind: ActivityKind, p: TargetPrefix, q: ActivityQuery): Promise<string[] | null> {
    const links: [string, string][] = [];
    if (q.companyId) links.push([`${targetField(p, 'company')}Id`, q.companyId]);
    if (q.personId) links.push([`${targetField(p, 'person')}Id`, q.personId]);
    if (q.opportunityId) links.push([`${targetField(p, 'opportunity')}Id`, q.opportunityId]);
    if (links.length === 0) return null;

    const Kind = kind === 'task' ? 'Task' : 'Note';
    const query = `
      query LinkedActivities($filter: ${Kind}TargetFilterInput, $first: Int, $after: String) {
        ${kind}Targets(filter: $filter, first: $first, after: $after) {
          edges { node { ${kind}Id } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    let ids = null as Set<string> | null;
    for (const [field, value] of links) {
      const found = new Set<string>();
      let after: string | undefined;
      do {
        const result = await this.client.request(query, {
          filter: { [field]: { eq: value } },
          first: MAX_PAGE_SIZE,
          after,
        }) as Record<string, Connection<Record<string, string | null>>>;
        const page = this.toPage(result[`${kind}Targets`]);
        page.results.forEach(node => { if (node[`${kind}Id`]) found.add(node[`${kind}Id`]!); });
        after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
      } while (after);
      ids = ids === null ? found : new Set([...ids].filter(id => found.has(id)));
    }
    return [...(ids ?? [])];
  }

  async listActivities(kind: ActivityKind, q: ActivityQuery = {}): Promise<Page<ActivityDetail>> {
    const p = await this.getTargetPrefix();
    const filter: Record<string, unknown> = {};
    if (kind === 'task' && q.status) filter.status = { eq: q.status };
    if (kind === 'task' && q.assigneeId) filter.assigneeId = { eq: q.assigneeId };

    const linkedIds = await this.activityIdsLinkedTo(kind, p, q);
    if (linkedIds !== null) {
      if (linkedIds.length === 0) {
        return { results: [], pageInfo: { hasNextPage: false, endCursor: null }, totalCount: 0 };
      }
      filter.id = { in: linkedIds };
    }

    const Kind = kind === 'task' ? 'Task' : 'Note';
    const plural = `${kind}s`;
    const query = `
      query List${Kind}s($filter: ${Kind}FilterInput, $first: Int, $after: String) {
        ${plural}(filter: $filter, first: $first, after: $after, orderBy: { createdAt: DescNullsLast }) {
          edges {
            node {${this.activitySelection(kind, p)}
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const result = await this.client.request(query, {
      filter: Object.keys(filter).length > 0 ? filter : undefined,
      first: pageSize(q.limit),
      after: q.cursor,
    }) as Record<string, Connection<any>>;

    const page = this.toPage(result[plural]);
    return { ...page, results: page.results.map(node => this.toActivityDetail(kind, p, node)) };
  }

  async getActivity(kind: ActivityKind, id: string): Promise<ActivityDetail | null> {
    const p = await this.getTargetPrefix();
    const Kind = kind === 'task' ? 'Task' : 'Note';
    const query = `
      query Get${Kind}($filter: ${Kind}FilterInput) {
        ${kind}s(filter: $filter, first: 1) {
          edges {
            node {${this.activitySelection(kind, p)}
            }
          }
        }
      }
    `;
    const result = await this.client.request(query, { filter: { id: { eq: id } } }) as Record<string, Connection<any>>;
    const node = result[`${kind}s`].edges[0]?.node;
    return node ? this.toActivityDetail(kind, p, node) : null;
  }

  async createTask(task: Task): Promise<Task> {
    const mutation = `
      mutation CreateTask($data: TaskCreateInput!) {
        createTask(data: $data) {
          id
          title
        }
      }
    `;

    const { body, ...rest } = task;
    const data = { ...rest, ...this.toBodyV2(body) };
    const result = await this.client.request(mutation, { data }) as { createTask: Task };
    return result.createTask;
  }

  async updateTask(id: string, updates: TaskUpdate): Promise<ActivityDetail | null> {
    const mutation = `
      mutation UpdateTask($id: UUID!, $data: TaskUpdateInput!) {
        updateTask(id: $id, data: $data) { id }
      }
    `;
    const { body, ...rest } = updates;
    const data = { ...rest, ...this.toBodyV2(body) };
    await this.client.request(mutation, { id, data });
    return this.getActivity('task', id);
  }

  async createNote(note: Note): Promise<Note> {
    const mutation = `
      mutation CreateNote($data: NoteCreateInput!) {
        createNote(data: $data) {
          id
          title
        }
      }
    `;

    // Las notas de Twenty no tienen autor asignable (lo registra `createdBy`).
    const { body, authorId: _authorId, ...rest } = note;
    const data = { ...rest, ...this.toBodyV2(body) };
    const result = await this.client.request(mutation, { data }) as { createNote: Note };
    return result.createNote;
  }

  // Liga una tarea o nota a una empresa, persona y/o oportunidad.
  // En Twenty esa relación vive en tablas aparte: taskTarget y noteTarget.
  async linkActivity(input: {
    kind: ActivityKind;
    activityId: string;
    companyId?: string;
    personId?: string;
    opportunityId?: string;
  }): Promise<string[]> {
    const p = await this.getTargetPrefix();
    const Kind = input.kind === 'task' ? 'Task' : 'Note';
    const mutationName = `create${Kind}Target`;

    const mutation = `
      mutation Link($data: ${Kind}TargetCreateInput!) {
        ${mutationName}(data: $data) { id }
      }
    `;

    const targets: Record<string, string>[] = [];
    if (input.companyId) targets.push({ [`${targetField(p, 'company')}Id`]: input.companyId });
    if (input.personId) targets.push({ [`${targetField(p, 'person')}Id`]: input.personId });
    if (input.opportunityId) targets.push({ [`${targetField(p, 'opportunity')}Id`]: input.opportunityId });

    const createdIds: string[] = [];
    for (const target of targets) {
      const result = await this.client.request(mutation, {
        data: { [`${input.kind}Id`]: input.activityId, ...target },
      }) as Record<string, { id: string }>;
      createdIds.push(result[mutationName].id);
    }
    return createdIds;
  }

  async listWorkspaceMembers(): Promise<{ id: string; name?: string; email?: string }[]> {
    const query = `
      query WorkspaceMembers($first: Int, $after: String) {
        workspaceMembers(first: $first, after: $after) {
          edges { node { id name { firstName lastName } userEmail } }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;
    const members: { id: string; name?: string; email?: string }[] = [];
    let after: string | undefined;
    do {
      const result = await this.client.request(query, { first: MAX_PAGE_SIZE, after }) as { workspaceMembers: Connection<any> };
      const page = this.toPage(result.workspaceMembers);
      members.push(...page.results.map(node => ({ id: node.id, name: personName(node.name), email: node.userEmail })));
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
    } while (after);
    return members;
  }

  // --- Borrado (Twenty lo manda a la papelera; se puede restaurar) ---------

  async describeRecord(objectType: DeletableObject, id: string): Promise<string | null> {
    const plural = PLURALS[objectType];
    const label = objectType === 'person' ? 'name { firstName lastName }'
      : objectType === 'task' || objectType === 'note' ? 'title' : 'name';
    const query = `
      query Describe($filter: ${capitalize(objectType)}FilterInput) {
        ${plural}(filter: $filter, first: 1) { edges { node { id ${label} } } }
      }
    `;
    const result = await this.client.request(query, { filter: { id: { eq: id } } }) as Record<string, Connection<any>>;
    const node = result[plural].edges[0]?.node;
    if (!node) return null;
    return (objectType === 'person' ? personName(node.name) : (node.title ?? node.name)) ?? '(sin nombre)';
  }

  async deleteRecord(objectType: DeletableObject, id: string): Promise<string> {
    const mutationName = `delete${capitalize(objectType)}`;
    const mutation = `
      mutation Delete($id: UUID!) {
        ${mutationName}(id: $id) { id }
      }
    `;
    const result = await this.client.request(mutation, { id }) as Record<string, { id: string }>;
    return result[mutationName].id;
  }

  async createOpportunity(opportunity: CreateOpportunityInput): Promise<Opportunity> {
    const mutation = `
      mutation CreateOpportunity($data: OpportunityCreateInput!) {
        createOpportunity(data: $data) {
          id
          name
          amount {
            amountMicros
            currencyCode
          }
          stage
          closeDate
          companyId
          pointOfContactId
          createdAt
          updatedAt
        }
      }
    `;

    const result = await this.client.request(mutation, { data: opportunity }) as { createOpportunity: Opportunity };
    return result.createOpportunity;
  }

  async getOpportunity(id: string): Promise<Opportunity> {
    const query = `
      query GetOpportunity($filter: OpportunityFilterInput!) {
        opportunities(filter: $filter) {
          edges {
            node {
              id
              name
              amount {
                amountMicros
                currencyCode
              }
              stage
              closeDate
              companyId
              pointOfContactId
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { filter: { id: { eq: id } } }) as { opportunities: { edges: { node: Opportunity }[] } };
    return result.opportunities.edges[0]?.node;
  }

  async updateOpportunity(input: UpdateOpportunityInput): Promise<Opportunity> {
    const { id, ...data } = input;
    const mutation = `
      mutation UpdateOpportunity($id: ID!, $data: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $data) {
          id
          name
          amount {
            amountMicros
            currencyCode
          }
          stage
          closeDate
          companyId
          pointOfContactId
          createdAt
          updatedAt
        }
      }
    `;

    const result = await this.client.request(mutation, { id, data }) as { updateOpportunity: Opportunity };
    return result.updateOpportunity;
  }

  async searchOpportunities(input: SearchOpportunitiesInput): Promise<Page<Opportunity>> {
    const query = `
      query SearchOpportunities($filter: OpportunityFilterInput, $first: Int, $after: String) {
        opportunities(filter: $filter, first: $first, after: $after) {
          edges {
            node {
              id
              name
              amount {
                amountMicros
                currencyCode
              }
              stage
              closeDate
              companyId
              pointOfContactId
              createdAt
              updatedAt
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
          totalCount
        }
      }
    `;

    const filters: any = {};
    
    if (input.query) {
      filters.name = { ilike: `%${input.query}%` };
    }
    
    if (input.stage) {
      filters.stage = { eq: input.stage };
    }
    
    if (input.companyId) {
      filters.companyId = { eq: input.companyId };
    }
    
    if (input.startDate || input.endDate) {
      filters.closeDate = {};
      if (input.startDate) filters.closeDate.gte = input.startDate;
      if (input.endDate) filters.closeDate.lte = input.endDate;
    }
    
    if (input.minAmount || input.maxAmount) {
      filters.amount = { amountMicros: {} };
      if (input.minAmount) filters.amount.amountMicros.gte = input.minAmount * 1000000;
      if (input.maxAmount) filters.amount.amountMicros.lte = input.maxAmount * 1000000;
    }

    const result = await this.client.request(query, {
      filter: Object.keys(filters).length > 0 ? filters : undefined,
      first: pageSize(input.limit),
      after: input.cursor,
    }) as { opportunities: Connection<Opportunity> };

    return this.toPage(result.opportunities);
  }

  async listOpportunitiesByStage(): Promise<Record<string, Opportunity[]>> {
    // Recorre todas las páginas: una sola consulta se cortaba en el tope de Twenty.
    const opportunities: Opportunity[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.searchOpportunities({ limit: MAX_PAGE_SIZE, cursor });
      opportunities.push(...page.results);
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
    } while (cursor);
    
    // Group by stage
    const groupedByStage: Record<string, Opportunity[]> = {};
    opportunities.forEach(opp => {
      const stage = opp.stage || 'No Stage';
      if (!groupedByStage[stage]) {
        groupedByStage[stage] = [];
      }
      groupedByStage[stage].push(opp);
    });
    
    return groupedByStage;
  }

  async getActivities(filter?: ActivityFilter): Promise<ActivityTimeline> {
    // Get both tasks and notes as activities
    const tasksQuery = `
      query GetTasks($first: Int) {
        tasks(first: $first, orderBy: { createdAt: DescNullsLast }) {
          edges {
            node {
              id
              title
              bodyV2 { markdown }
              status
              dueAt
              assigneeId
              assignee {
                id
                name {
                  firstName
                  lastName
                }
              }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const notesQuery = `
      query GetNotes($first: Int) {
        notes(first: $first, orderBy: { createdAt: DescNullsLast }) {
          edges {
            node {
              id
              title
              bodyV2 { markdown }
              createdAt
              updatedAt
            }
          }
        }
      }
    `;

    const limit = filter?.limit || 20;

    const [tasksResult, notesResult] = await Promise.all([
      this.client.request(tasksQuery, { first: limit }),
      this.client.request(notesQuery, { first: limit })
    ]);
    
    const typedTasksResult = tasksResult as { tasks: { edges: { node: any }[] } };
    const typedNotesResult = notesResult as { notes: { edges: { node: any }[] } };

    // Transform and combine activities
    const activities: Activity[] = [];

    typedTasksResult.tasks.edges.forEach(edge => {
      const task = edge.node;
      activities.push({
        id: task.id,
        type: 'task',
        title: task.title,
        body: task.bodyV2?.markdown,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        authorId: task.assigneeId,
        author: task.assignee
      });
    });

    typedNotesResult.notes.edges.forEach(edge => {
      const note = edge.node;
      activities.push({
        id: note.id,
        type: 'note',
        title: note.title,
        body: note.bodyV2?.markdown,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        authorId: undefined,
        author: undefined
      });
    });

    // Sort by creation date (newest first)
    activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Apply filters
    let filteredActivities = activities;
    
    if (filter?.type && filter.type.length > 0) {
      filteredActivities = filteredActivities.filter(activity => filter.type!.includes(activity.type));
    }
    
    if (filter?.dateFrom) {
      filteredActivities = filteredActivities.filter(activity => 
        new Date(activity.createdAt) >= new Date(filter.dateFrom!)
      );
    }
    
    if (filter?.dateTo) {
      filteredActivities = filteredActivities.filter(activity => 
        new Date(activity.createdAt) <= new Date(filter.dateTo!)
      );
    }
    
    if (filter?.authorId) {
      filteredActivities = filteredActivities.filter(activity => activity.authorId === filter.authorId);
    }

    return {
      activities: filteredActivities,
      totalCount: filteredActivities.length,
      hasMore: filteredActivities.length === limit
    };
  }

  async filterActivities(filter: ActivityFilter): Promise<Activity[]> {
    const timeline = await this.getActivities(filter);
    return timeline.activities;
  }

  async createComment(input: CreateCommentInput): Promise<Comment> {
    const mutation = `
      mutation CreateComment($data: CommentCreateInput!) {
        createComment(data: $data) {
          id
          body
          authorId
          author {
            id
            name {
              firstName
              lastName
            }
          }
          createdAt
          updatedAt
        }
      }
    `;

    const commentData = {
      body: input.body,
      ...(input.authorId && { authorId: input.authorId }),
      ...(input.activityTargetId && { activityTargetId: input.activityTargetId })
    };

    const result = await this.client.request(mutation, { data: commentData }) as { createComment: Comment };
    return result.createComment;
  }

  async getEntityActivities(input: EntityActivitiesInput): Promise<ActivityTimeline> {
    // For now, we'll get general activities and filter client-side
    // In a real implementation, you'd want to use the entity relationships in the GraphQL query
    const activities = await this.getActivities({
      limit: input.limit,
      offset: input.offset
    });

    // Note: This is a simplified implementation. In practice, you'd want to query
    // activities that are specifically related to the entity through proper GraphQL relationships
    return activities;
  }

  // --- Esquema (objetos y campos, incluidos los personalizados) ------------
  //
  // Twenty ya no expone `isCustom`. Los objetos y campos estándar pertenecen a
  // la aplicación base de Twenty (la misma que `person`); los personalizados,
  // a otra aplicación del workspace. Así distinguimos unos de otros.
  private async fetchObjectsMetadata(withFields: boolean): Promise<ObjectMetadata[]> {
    const fieldSelection = withFields ? `
              fieldsList {
                id name label description type isActive isNullable isSystem
                defaultValue options settings applicationId createdAt updatedAt
              }` : '';
    const query = `
      query GetObjectMetadata($paging: CursorPaging) {
        objects(paging: $paging) {
          edges {
            node {
              id nameSingular namePlural labelSingular labelPlural description icon
              isActive isSystem applicationId createdAt updatedAt${fieldSelection}
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const nodes: any[] = [];
    let after: string | undefined;
    do {
      const result = await this.metadataClient.request(query, { paging: { first: 200, after } }) as { objects: Connection<any> };
      const page = this.toPage(result.objects);
      nodes.push(...page.results);
      after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
    } while (after);

    const standardAppId = (nodes.find(n => n.nameSingular === 'person') ?? nodes.find(n => n.nameSingular === 'company'))?.applicationId;
    const isCustom = (applicationId?: string) => !!standardAppId && !!applicationId && applicationId !== standardAppId;

    return nodes.map(({ applicationId, fieldsList, ...object }) => ({
      ...object,
      isCustom: isCustom(applicationId),
      fields: (fieldsList ?? []).map(({ applicationId: fieldAppId, ...field }: any) => ({
        ...field,
        isCustom: isCustom(fieldAppId),
      })),
    }));
  }

  private async findObjectMetadata(objectNameOrId: string): Promise<ObjectMetadata> {
    const objects = await this.fetchObjectsMetadata(true);
    const found = objects.find(o =>
      o.id === objectNameOrId || o.nameSingular === objectNameOrId || o.namePlural === objectNameOrId);
    if (!found) throw new Error(`Object not found: ${objectNameOrId}`);
    return found;
  }

  async listAllObjects(options: MetadataQueryOptions = {}): Promise<ObjectSummary> {
    let filteredObjects = await this.fetchObjectsMetadata(false);

    if (options.activeOnly !== false) {
      filteredObjects = filteredObjects.filter(obj => obj.isActive);
    }
    if (options.includeCustom === false) {
      filteredObjects = filteredObjects.filter(obj => !obj.isCustom);
    }
    if (options.includeSystem === false) {
      filteredObjects = filteredObjects.filter(obj => !obj.isSystem);
    }

    const standard = filteredObjects.filter(obj => !obj.isCustom && !obj.isSystem);
    const custom = filteredObjects.filter(obj => obj.isCustom);
    const system = filteredObjects.filter(obj => obj.isSystem && !obj.isCustom);

    return {
      standard,
      custom,
      system,
      totalCount: filteredObjects.length,
      standardCount: standard.length,
      customCount: custom.length,
      systemCount: system.length
    };
  }

  async getObjectSchema(objectNameOrId: string): Promise<ObjectSchema> {
    const object = await this.findObjectMetadata(objectNameOrId);
    return {
      object,
      fields: object.fields,
      relationships: [] // TODO: Implement relationship discovery
    };
  }

  async getFieldMetadata(options: FieldQueryOptions = {}): Promise<FieldMetadata[]> {
    const fields = options.objectId || options.objectName
      ? (await this.findObjectMetadata((options.objectId || options.objectName)!)).fields
      : (await this.fetchObjectsMetadata(true)).flatMap(o => o.fields);

    let filteredFields = fields;
    if (options.activeOnly !== false) {
      filteredFields = filteredFields.filter(field => field.isActive);
    }
    if (options.includeCustom === false) {
      filteredFields = filteredFields.filter(field => !field.isCustom);
    }
    if (options.includeSystem === false) {
      filteredFields = filteredFields.filter(field => !field.isSystem);
    }
    if (options.fieldType) {
      filteredFields = filteredFields.filter(field => field.type === options.fieldType);
    }
    return filteredFields;
  }

  // Relationship Management Methods

  async getCompanyContacts(companyId: string): Promise<CompanyContactsResult> {
    const query = `
      query GetCompanyContacts($companyId: String!) {
        company(filter: { id: { eq: $companyId } }) {
          id
          name
        }
        people(filter: { companyId: { eq: $companyId } }, first: 100) {
          edges {
            node {
              id
              name {
                firstName
                lastName
              }
              emails {
                primaryEmail
              }
              phones {
                primaryPhoneNumber
              }
              jobTitle
              createdAt
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { companyId }) as any;
    
    const contacts = result.people.edges.map((edge: any) => ({
      id: edge.node.id,
      name: edge.node.name,
      email: edge.node.emails?.primaryEmail,
      phone: edge.node.phones?.primaryPhoneNumber,
      jobTitle: edge.node.jobTitle,
      createdAt: edge.node.createdAt
    }));

    return {
      companyId,
      companyName: result.company?.name || 'Unknown Company',
      contacts,
      totalContacts: contacts.length
    };
  }

  async getPersonOpportunities(personId: string): Promise<PersonOpportunitiesResult> {
    const query = `
      query GetPersonOpportunities($personId: String!) {
        person(filter: { id: { eq: $personId } }) {
          id
          name {
            firstName
            lastName
          }
        }
        opportunities(filter: { pointOfContactId: { eq: $personId } }, first: 100) {
          edges {
            node {
              id
              name
              amount {
                amountMicros
                currencyCode
              }
              stage
              closeDate
              companyId
              company {
                id
                name
              }
              createdAt
            }
          }
        }
      }
    `;

    const result = await this.client.request(query, { personId }) as any;
    
    const opportunities = result.opportunities.edges.map((edge: any) => edge.node);
    const person = result.person;

    return {
      personId,
      personName: person ? `${person.name.firstName} ${person.name.lastName}` : 'Unknown Person',
      opportunities,
      totalOpportunities: opportunities.length
    };
  }

  async linkOpportunityToCompany(input: LinkOpportunityInput): Promise<any> {
    const mutation = `
      mutation LinkOpportunity($id: String!, $data: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $data) {
          id
          name
          companyId
          pointOfContactId
          company {
            id
            name
          }
          pointOfContact {
            id
            name {
              firstName
              lastName
            }
          }
        }
      }
    `;

    const updateData: any = {};
    if (input.companyId) updateData.companyId = input.companyId;
    if (input.pointOfContactId) updateData.pointOfContactId = input.pointOfContactId;

    const result = await this.client.request(mutation, {
      id: input.opportunityId,
      data: updateData
    }) as { updateOpportunity: any };

    return result.updateOpportunity;
  }

  async transferContactToCompany(input: TransferContactInput): Promise<any> {
    const mutation = `
      mutation TransferContact($id: String!, $data: PersonUpdateInput!) {
        updatePerson(id: $id, data: $data) {
          id
          name {
            firstName
            lastName
          }
          companyId
          company {
            id
            name
          }
        }
      }
    `;

    const result = await this.client.request(mutation, {
      id: input.contactId,
      data: { companyId: input.toCompanyId }
    }) as { updatePerson: any };

    return result.updatePerson;
  }

  async getRelationshipSummary(entityId: string, entityType: string): Promise<RelationshipSummary> {
    let counts = {
      companies: 0,
      contacts: 0,
      opportunities: 0,
      tasks: 0,
      activities: 0
    };

    try {
      switch (entityType.toLowerCase()) {
        case 'company':
          // Get contacts for this company
          const companyContacts = await this.getCompanyContacts(entityId);
          counts.contacts = companyContacts.totalContacts;
          
          // Get opportunities for this company
          const companyOpps = await this.searchOpportunities({ companyId: entityId, limit: 1000 });
          counts.opportunities = companyOpps.totalCount ?? companyOpps.results.length;
          break;
          
        case 'person':
          // Get opportunities for this person
          const personOpps = await this.getPersonOpportunities(entityId);
          counts.opportunities = personOpps.totalOpportunities;
          
          // Get tasks assigned to this person (would need a specific query for filtering)
          // For now, we'll skip task counting as it requires a filtered query
          counts.tasks = 0;
          break;
      }
    } catch (error) {
      console.warn('Error calculating relationship summary:', error);
    }

    return {
      entityId,
      entityType,
      relationships: counts
    };
  }

  async findOrphanedRecords(): Promise<OrphanedRecords> {
    const orphaned: OrphanedRecords = {
      companies: [],
      contacts: [],
      opportunities: [],
      tasks: []
    };

    try {
      // Find companies with no contacts
      const companiesQuery = `
        query GetCompaniesWithContacts {
          companies(first: 1000) {
            edges {
              node {
                id
                name
                people {
                  totalCount
                }
                opportunities {
                  totalCount
                }
              }
            }
          }
        }
      `;

      const companiesResult = await this.client.request(companiesQuery) as any;
      orphaned.companies = companiesResult.companies.edges
        .map((edge: any) => edge.node)
        .filter((company: any) => company.people.totalCount === 0)
        .map((company: any) => ({
          id: company.id,
          name: company.name,
          contactCount: 0,
          opportunityCount: company.opportunities.totalCount
        }));

      // Find contacts without companies
      const contactsQuery = `
        query GetContactsWithoutCompanies {
          people(filter: { companyId: { is: "NULL" } }, first: 1000) {
            edges {
              node {
                id
                name {
                  firstName
                  lastName
                }
                companyId
                opportunities {
                  totalCount
                }
              }
            }
          }
        }
      `;

      const contactsResult = await this.client.request(contactsQuery) as any;
      orphaned.contacts = contactsResult.people.edges.map((edge: any) => ({
        id: edge.node.id,
        name: `${edge.node.name.firstName} ${edge.node.name.lastName}`,
        hasCompany: !!edge.node.companyId,
        opportunityCount: edge.node.opportunities.totalCount
      }));

    } catch (error) {
      console.warn('Error finding orphaned records:', error);
    }

    return orphaned;
  }
}