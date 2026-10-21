export interface TwentyConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface FullName {
  firstName: string;
  lastName: string;
}

export interface Emails {
  primaryEmail: string;
  additionalEmails?: string[];
}

export interface Phones {
  primaryPhoneNumber?: string;
  primaryPhoneCountryCode?: string;
  additionalPhones?: any[];
}

export interface Links {
  primaryLinkUrl?: string;
  primaryLinkLabel?: string;
  secondaryLinks?: any[];
}

export interface Address {
  addressStreet1?: string;
  addressStreet2?: string;
  addressCity?: string;
  addressState?: string;
  addressCountry?: string;
  addressPostcode?: string;
}

export interface Currency {
  amountMicros?: number;
  currencyCode?: string;
}

export interface Person {
  id?: string;
  name: FullName;
  emails?: Emails;
  phones?: Phones;
  companyId?: string;
  jobTitle?: string;
  linkedinLink?: Links;
  avatarUrl?: string;
}

export interface Company {
  id?: string;
  name: string;
  domainName?: Links;
  address?: Address;
  linkedinLink?: Links;
  annualRevenue?: Currency;
  accountOwnerId?: string;
}

export interface Task {
  id?: string;
  title: string;
  body?: string;
  dueAt?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId?: string;
}

export interface Note {
  id?: string;
  title?: string;
  body: string;
  authorId?: string;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  // Twenty pagina por cursor (Relay): `cursor` es el `endCursor` de la página anterior.
  cursor?: string;
  orderBy?: string;
  orderDirection?: 'ASC' | 'DESC';
}

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Page<T> {
  results: T[];
  pageInfo: PageInfo;
  totalCount?: number;
}

export type ActivityKind = 'task' | 'note';

export interface LinkedRecord {
  type: 'company' | 'person' | 'opportunity';
  id: string;
  name?: string;
}

export interface ActivityDetail {
  id: string;
  title?: string | null;
  body?: string | null;
  status?: string | null;
  dueAt?: string | null;
  assignee?: { id: string; name?: string; email?: string } | null;
  linkedTo: LinkedRecord[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivityQuery {
  limit?: number;
  cursor?: string;
  // Solo tareas
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
  assigneeId?: string;
  // Registro vinculado (vía taskTargets / noteTargets)
  companyId?: string;
  personId?: string;
  opportunityId?: string;
}

export interface TaskUpdate {
  title?: string;
  body?: string;
  status?: 'TODO' | 'IN_PROGRESS' | 'DONE';
  dueAt?: string | null;
  assigneeId?: string | null;
}

export type DeletableObject = 'task' | 'note' | 'company' | 'person' | 'opportunity';
