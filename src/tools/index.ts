import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TwentyClient } from '../client/twenty-client.js';
import type { Person, Company } from '../types/twenty.js';
import { registerOpportunityTools } from './opportunities.js';
import { registerActivityTools } from './activities.js';
import { registerMetadataTools } from './metadata.js';

// Campos que acepta Twenty 2.x. Los parámetros planos de las herramientas se
// convierten aquí a la forma anidada de Twenty (name, emails, phones, links, ...).
// Solo se envía lo que el usuario pidió cambiar.
const contactParams = {
  email: z.string().email().optional().describe('Primary email address'),
  phone: z.string().optional().describe('Primary phone number, e.g. "+52 81 1234 5678" or a national number (see phoneCountry)'),
  phoneCountry: z.string().optional().describe('ISO country code for a phone without "+" prefix (default MX)'),
  companyId: z.string().optional().describe('ID of associated company'),
  jobTitle: z.string().optional().describe('Job title'),
  linkedinUrl: z.string().url().optional().describe('LinkedIn profile URL'),
};

function toPersonData(args: {
  firstName?: string; lastName?: string; email?: string; phone?: string; phoneCountry?: string;
  companyId?: string; jobTitle?: string; linkedinUrl?: string;
}) {
  return {
    ...((args.firstName !== undefined || args.lastName !== undefined) && {
      name: { firstName: args.firstName ?? '', lastName: args.lastName ?? '' },
    }),
    ...(args.email !== undefined && { emails: { primaryEmail: args.email } }),
    // Twenty rechaza un teléfono sin país: con "+" va completo, si no, con su código de país.
    ...(args.phone !== undefined && {
      phones: args.phone.trim().startsWith('+')
        ? { primaryPhoneNumber: args.phone.trim() }
        : { primaryPhoneNumber: args.phone.trim(), primaryPhoneCountryCode: args.phoneCountry ?? 'MX' },
    }),
    ...(args.companyId !== undefined && { companyId: args.companyId }),
    ...(args.jobTitle !== undefined && { jobTitle: args.jobTitle }),
    ...(args.linkedinUrl !== undefined && { linkedinLink: { primaryLinkUrl: args.linkedinUrl } }),
  };
}

const companyParams = {
  domainName: z.string().optional().describe('Company domain name'),
  address: z.string().optional().describe('Street address'),
  linkedinUrl: z.string().url().optional().describe('LinkedIn company URL'),
  annualRevenue: z.number().optional().describe('Annual revenue in currency units'),
  currency: z.string().optional().default('MXN').describe('Currency code for annualRevenue (e.g. MXN, USD)'),
  accountOwnerId: z.string().optional().describe('Workspace member ID of the account owner (see list_workspace_members)'),
};

function toCompanyData(args: {
  name?: string; domainName?: string; address?: string; linkedinUrl?: string;
  annualRevenue?: number; currency?: string; accountOwnerId?: string;
}) {
  return {
    ...(args.name !== undefined && { name: args.name }),
    ...(args.domainName !== undefined && { domainName: { primaryLinkUrl: args.domainName } }),
    ...(args.address !== undefined && { address: { addressStreet1: args.address } }),
    ...(args.linkedinUrl !== undefined && { linkedinLink: { primaryLinkUrl: args.linkedinUrl } }),
    ...(args.annualRevenue !== undefined && {
      annualRevenue: { amountMicros: Math.round(args.annualRevenue * 1000000), currencyCode: args.currency ?? 'MXN' },
    }),
    ...(args.accountOwnerId !== undefined && { accountOwnerId: args.accountOwnerId }),
  };
}

export function registerPersonTools(server: McpServer, client: TwentyClient) {
  server.tool(
    'create_contact',
    'Create a new contact (person) in Twenty CRM',
    {
      firstName: z.string().describe('First name of the contact'),
      lastName: z.string().describe('Last name of the contact'),
      ...contactParams,
    },
    async (args) => {
    try {
      const person = await client.createPerson(toPersonData(args) as Person);
      return {
        content: [{
          type: 'text' as const,
          text: `Contact created successfully: ${person.name.firstName} ${person.name.lastName} (ID: ${person.id})`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating contact: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'get_contact',
    'Retrieve a contact by ID from Twenty CRM',
    {
      id: z.string().describe('Contact ID to retrieve'),
    },
    async (args) => {
    try {
      const person = await client.getPerson(args.id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(person, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error retrieving contact: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'update_contact',
    'Update an existing contact in Twenty CRM. Only the fields provided are changed.',
    {
      id: z.string().describe('Contact ID to update'),
      firstName: z.string().optional().describe('First name'),
      lastName: z.string().optional().describe('Last name'),
      ...contactParams,
    },
    async ({ id, ...args }) => {
    try {
      // `name` es un campo compuesto: si solo cambia una parte, conservamos la otra.
      if ((args.firstName === undefined) !== (args.lastName === undefined)) {
        const current = await client.getPerson(id);
        args.firstName ??= current.name?.firstName;
        args.lastName ??= current.name?.lastName;
      }
      const person = await client.updatePerson(id, toPersonData(args));
      return {
        content: [{
          type: 'text' as const,
          text: `Contact updated successfully: ${person.name.firstName} ${person.name.lastName}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error updating contact: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'search_contacts',
    'Search for contacts in Twenty CRM',
    {
      query: z.string().describe('Search query (searches name and email)'),
      limit: z.number().optional().default(20).describe('Maximum number of results'),
      cursor: z.string().optional().describe('Pagination cursor: pass the endCursor returned by the previous page'),
    },
    async (args) => {
    try {
      const people = await client.searchPeople(args.query, {
        limit: args.limit,
        cursor: args.cursor,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(people, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching contacts: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });
}

export function registerCompanyTools(server: McpServer, client: TwentyClient) {
  server.tool(
    'create_company',
    'Create a new company in Twenty CRM',
    {
      name: z.string().describe('Company name'),
      ...companyParams,
    },
    async (args) => {
    try {
      const company = await client.createCompany(toCompanyData(args) as Company);
      return {
        content: [{
          type: 'text' as const,
          text: `Company created successfully: ${company.name} (ID: ${company.id})`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error creating company: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'get_company',
    'Retrieve a company by ID from Twenty CRM',
    {
      id: z.string().describe('Company ID to retrieve'),
    },
    async (args) => {
    try {
      const company = await client.getCompany(args.id);
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(company, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error retrieving company: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'update_company',
    'Update an existing company in Twenty CRM. Only the fields provided are changed.',
    {
      id: z.string().describe('Company ID to update'),
      name: z.string().optional().describe('Company name'),
      ...companyParams,
    },
    async ({ id, ...args }) => {
    try {
      // `currency` solo tiene sentido junto con annualRevenue.
      const company = await client.updateCompany(id, toCompanyData(args));
      return {
        content: [{
          type: 'text' as const,
          text: `Company updated successfully: ${company.name}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error updating company: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });

  server.tool(
    'search_companies',
    'Search for companies in Twenty CRM',
    {
      query: z.string().describe('Search query (searches name and domain)'),
      limit: z.number().optional().default(20).describe('Maximum number of results'),
      cursor: z.string().optional().describe('Pagination cursor: pass the endCursor returned by the previous page'),
    },
    async (args) => {
    try {
      const companies = await client.searchCompanies(args.query, {
        limit: args.limit,
        cursor: args.cursor,
      });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(companies, null, 2)
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text' as const,
          text: `Error searching companies: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  });
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const errorText = (prefix: string, error: unknown) => ({
  content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : 'Unknown error'}` }],
  isError: true,
});

const TASK_STATUS = z.enum(['TODO', 'IN_PROGRESS', 'DONE']);
const linkParams = (what: string) => ({
  companyId: z.string().optional().describe(`ID of a company to link this ${what} to`),
  personId: z.string().optional().describe(`ID of a contact to link this ${what} to`),
  opportunityId: z.string().optional().describe(`ID of an opportunity to link this ${what} to`),
});
const filterParams = (what: string) => ({
  companyId: z.string().optional().describe(`Only ${what} linked to this company`),
  personId: z.string().optional().describe(`Only ${what} linked to this contact`),
  opportunityId: z.string().optional().describe(`Only ${what} linked to this opportunity`),
  limit: z.number().optional().default(20).describe('Maximum number of results per page'),
  cursor: z.string().optional().describe('Pagination cursor: pass the endCursor returned by the previous page'),
});

async function linkAfterCreate(
  client: TwentyClient,
  kind: 'task' | 'note',
  activityId: string | undefined,
  links: { companyId?: string; personId?: string; opportunityId?: string },
): Promise<string> {
  if (!activityId || !(links.companyId || links.personId || links.opportunityId)) return '';
  try {
    const created = await client.linkActivity({ kind, activityId, ...links });
    return `\nLinked to ${created.length} record(s).`;
  } catch (linkError) {
    return `\n${kind === 'task' ? 'Task' : 'Note'} created but linking failed: ${linkError instanceof Error ? linkError.message : 'Unknown error'}`;
  }
}

export function registerTaskTools(server: McpServer, client: TwentyClient) {
  server.tool(
    'create_task',
    'Create a new task in Twenty CRM, optionally linked to a company, contact and/or opportunity',
    {
      title: z.string().describe('Task title'),
      body: z.string().optional().describe('Task description (markdown)'),
      dueAt: z.string().optional().describe('Due date (ISO 8601 format)'),
      status: TASK_STATUS.optional().default('TODO').describe('Task status'),
      assigneeId: z.string().optional().describe('Workspace member ID of the assignee (see list_workspace_members)'),
      ...linkParams('task'),
    },
    async (args) => {
    try {
      const { companyId, personId, opportunityId, ...taskData } = args;
      const task = await client.createTask(taskData);
      const linkInfo = await linkAfterCreate(client, 'task', task.id, { companyId, personId, opportunityId });
      return text(`Task created successfully: ${task.title} (ID: ${task.id})${linkInfo}`);
    } catch (error) {
      return errorText('Error creating task', error);
    }
  });

  server.tool(
    'get_tasks',
    'List tasks with assignee, due date, body and linked records. Filter by status, assignee or linked record. Paginates by cursor.',
    {
      status: TASK_STATUS.optional().describe('Only tasks with this status'),
      assigneeId: z.string().optional().describe('Only tasks assigned to this workspace member'),
      ...filterParams('tasks'),
    },
    async (args) => {
    try {
      return text(JSON.stringify(await client.listActivities('task', args), null, 2));
    } catch (error) {
      return errorText('Error retrieving tasks', error);
    }
  });

  server.tool(
    'get_task',
    'Retrieve a task by ID, including body, assignee, due date and linked records',
    { id: z.string().describe('Task ID') },
    async ({ id }) => {
    try {
      const task = await client.getActivity('task', id);
      return task ? text(JSON.stringify(task, null, 2)) : { ...text(`Task not found: ${id}`), isError: true };
    } catch (error) {
      return errorText('Error retrieving task', error);
    }
  });

  server.tool(
    'update_task',
    'Update a task: title, body, status, due date or assignee. Only the fields provided are changed.',
    {
      id: z.string().describe('Task ID'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New description (markdown); replaces the current one'),
      status: TASK_STATUS.optional().describe('New status'),
      dueAt: z.string().nullable().optional().describe('New due date (ISO 8601), or null to clear it'),
      assigneeId: z.string().nullable().optional().describe('Workspace member ID of the new assignee, or null to unassign'),
    },
    async ({ id, ...updates }) => {
    try {
      if (Object.keys(updates).length === 0) {
        return { ...text('Error: provide at least one field to update'), isError: true };
      }
      const task = await client.updateTask(id, updates);
      return text(`Task updated successfully:\n${JSON.stringify(task, null, 2)}`);
    } catch (error) {
      return errorText('Error updating task', error);
    }
  });

  server.tool(
    'create_note',
    'Create a new note in Twenty CRM, optionally linked to a company, contact and/or opportunity',
    {
      title: z.string().optional().describe('Note title'),
      body: z.string().describe('Note content (markdown)'),
      ...linkParams('note'),
    },
    async (args) => {
    try {
      const { companyId, personId, opportunityId, ...noteData } = args;
      const note = await client.createNote(noteData);
      const linkInfo = await linkAfterCreate(client, 'note', note.id, { companyId, personId, opportunityId });
      return text(`Note created successfully: ${note.title || 'Untitled'} (ID: ${note.id})${linkInfo}`);
    } catch (error) {
      return errorText('Error creating note', error);
    }
  });

  server.tool(
    'get_notes',
    'List notes with body and linked records, newest first. Filter by linked company, contact or opportunity. Paginates by cursor.',
    filterParams('notes'),
    async (args) => {
    try {
      return text(JSON.stringify(await client.listActivities('note', args), null, 2));
    } catch (error) {
      return errorText('Error retrieving notes', error);
    }
  });

  server.tool(
    'get_note',
    'Retrieve a note by ID, including body and linked records',
    { id: z.string().describe('Note ID') },
    async ({ id }) => {
    try {
      const note = await client.getActivity('note', id);
      return note ? text(JSON.stringify(note, null, 2)) : { ...text(`Note not found: ${id}`), isError: true };
    } catch (error) {
      return errorText('Error retrieving note', error);
    }
  });

  server.tool(
    'link_activity',
    'Link an existing task or note to a company, contact and/or opportunity',
    {
      kind: z.enum(['task', 'note']).describe('Whether the activity is a task or a note'),
      activityId: z.string().describe('ID of the task or note'),
      companyId: z.string().optional().describe('ID of the company to link'),
      personId: z.string().optional().describe('ID of the contact to link'),
      opportunityId: z.string().optional().describe('ID of the opportunity to link'),
    },
    async (args) => {
    try {
      if (!args.companyId && !args.personId && !args.opportunityId) {
        return { ...text('Error: provide at least one of companyId, personId or opportunityId'), isError: true };
      }
      const links = await client.linkActivity(args);
      return text(`Linked ${args.kind} ${args.activityId} to ${links.length} record(s).`);
    } catch (error) {
      return errorText(`Error linking ${args.kind}`, error);
    }
  });

  server.tool(
    'list_workspace_members',
    'List the workspace members (users) of Twenty CRM. Use their IDs as task assignees.',
    {},
    async () => {
    try {
      return text(JSON.stringify(await client.listWorkspaceMembers(), null, 2));
    } catch (error) {
      return errorText('Error listing workspace members', error);
    }
  });
}

export function registerDeleteTools(server: McpServer, client: TwentyClient) {
  // Códigos de confirmación de un solo uso, por sesión MCP. Obligan a pasar por
  // la vista previa (y a que el usuario la vea) antes de borrar.
  const pending = new Map<string, { objectType: string; id: string; expires: number }>();
  const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

  server.tool(
    'delete_record',
    'Delete (move to trash) a task, note, company, contact or opportunity. Two steps: call first WITHOUT confirmationToken; ' +
    'it shows which record would be deleted and returns a confirmationToken. Show that to the user, and only after the user ' +
    'explicitly approves, call again with the same objectType, id and the confirmationToken. ' +
    'Deleted records go to Twenty\'s trash and can be restored from the Twenty UI.',
    {
      objectType: z.enum(['task', 'note', 'company', 'person', 'opportunity']).describe('Type of record'),
      id: z.string().describe('Record ID'),
      confirmationToken: z.string().optional().describe('Token returned by the preview call, after the user approved'),
    },
    { title: 'Delete record', destructiveHint: true, idempotentHint: false, readOnlyHint: false },
    async ({ objectType, id, confirmationToken }) => {
    try {
      const label = await client.describeRecord(objectType, id);
      if (label === null) {
        return { ...text(`No ${objectType} found with ID ${id}. Nothing was deleted.`), isError: true };
      }

      if (!confirmationToken) {
        const token = randomUUID().slice(0, 8);
        pending.set(token, { objectType, id, expires: Date.now() + CONFIRMATION_TTL_MS });
        return text(
          `About to delete ${objectType} "${label}" (ID: ${id}). Nothing has been deleted yet.\n` +
          `Ask the user to confirm. If they approve, call delete_record again with confirmationToken: "${token}" (valid 10 minutes).`,
        );
      }

      const entry = pending.get(confirmationToken);
      if (!entry || entry.objectType !== objectType || entry.id !== id || entry.expires < Date.now()) {
        return {
          ...text('Invalid or expired confirmationToken for this record. Nothing was deleted; call without a token to get a new one.'),
          isError: true,
        };
      }
      pending.delete(confirmationToken);
      await client.deleteRecord(objectType, id);
      return text(`Deleted ${objectType} "${label}" (ID: ${id}). It can be restored from the trash in Twenty.`);
    } catch (error) {
      return errorText(`Error deleting ${objectType}`, error);
    }
  });
}

export function registerRelationshipTools(server: McpServer, client: TwentyClient) {
  server.tool(
    'get_company_contacts',
    'Get all contacts (people) associated with a specific company',
    {
      companyId: z.string().describe('The ID of the company to get contacts for'),
    },
    async (args) => {
      try {
        const result = await client.getCompanyContacts(args.companyId);
        
        const contactsList = result.contacts.map(contact => 
          `• ${contact.name.firstName} ${contact.name.lastName}` +
          (contact.jobTitle ? ` - ${contact.jobTitle}` : '') +
          (contact.email ? ` (${contact.email})` : '') +
          (contact.phone ? ` | Phone: ${contact.phone}` : '') +
          `\n  ID: ${contact.id}`
        ).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `Company Contacts for "${result.companyName}"\n` +
                  `Company ID: ${result.companyId}\n` +
                  `Total Contacts: ${result.totalContacts}\n\n` +
                  (result.totalContacts > 0 ? `Contacts:\n${contactsList}` : 'No contacts found for this company.')
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error retrieving company contacts: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  server.tool(
    'get_person_opportunities',
    'Get all opportunities where a specific person is the point of contact',
    {
      personId: z.string().describe('The ID of the person to get opportunities for'),
    },
    async (args) => {
      try {
        const result = await client.getPersonOpportunities(args.personId);
        
        const opportunitiesList = result.opportunities.map(opp => {
          let oppText = `• ${opp.name}`;
          if (opp.stage) oppText += ` (${opp.stage})`;
          if (opp.amount) {
            const amount = opp.amount.amountMicros / 1000000;
            oppText += ` - ${opp.amount.currencyCode} ${amount.toLocaleString()}`;
          }
          if (opp.company) oppText += ` | Company: ${opp.company.name}`;
          if (opp.closeDate) oppText += ` | Close: ${opp.closeDate}`;
          oppText += `\n  ID: ${opp.id}`;
          return oppText;
        }).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `Opportunities for "${result.personName}"\n` +
                  `Person ID: ${result.personId}\n` +
                  `Total Opportunities: ${result.totalOpportunities}\n\n` +
                  (result.totalOpportunities > 0 ? `Opportunities:\n${opportunitiesList}` : 'No opportunities found for this person.')
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error retrieving person opportunities: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  server.tool(
    'link_opportunity_to_company',
    'Link an opportunity to a company and/or point of contact',
    {
      opportunityId: z.string().describe('The ID of the opportunity to update'),
      companyId: z.string().optional().describe('The ID of the company to link to (optional)'),
      pointOfContactId: z.string().optional().describe('The ID of the person to set as point of contact (optional)'),
    },
    async (args) => {
      try {
        if (!args.companyId && !args.pointOfContactId) {
          return {
            content: [{
              type: 'text' as const,
              text: 'Error: At least one of companyId or pointOfContactId must be provided'
            }]
          };
        }

        const result = await client.linkOpportunityToCompany({
          opportunityId: args.opportunityId,
          companyId: args.companyId,
          pointOfContactId: args.pointOfContactId
        });

        let relationshipInfo = '';
        if (result.company) {
          relationshipInfo += `Company: ${result.company.name} (${result.company.id})\n`;
        }
        if (result.pointOfContact) {
          relationshipInfo += `Point of Contact: ${result.pointOfContact.name.firstName} ${result.pointOfContact.name.lastName} (${result.pointOfContact.id})\n`;
        }

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully linked opportunity "${result.name}"\n` +
                  `Opportunity ID: ${result.id}\n\n` +
                  `Updated Relationships:\n${relationshipInfo}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error linking opportunity: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  server.tool(
    'transfer_contact_to_company',
    'Transfer a contact (person) from one company to another',
    {
      contactId: z.string().describe('The ID of the contact to transfer'),
      toCompanyId: z.string().describe('The ID of the company to transfer the contact to'),
      fromCompanyId: z.string().optional().describe('The ID of the current company (optional, for validation)'),
    },
    async (args) => {
      try {
        const result = await client.transferContactToCompany({
          contactId: args.contactId,
          fromCompanyId: args.fromCompanyId,
          toCompanyId: args.toCompanyId
        });

        return {
          content: [{
            type: 'text' as const,
            text: `Successfully transferred contact "${result.name.firstName} ${result.name.lastName}"\n` +
                  `Contact ID: ${result.id}\n` +
                  `New Company: ${result.company?.name || 'Unknown'} (${result.companyId})`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error transferring contact: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  server.tool(
    'get_relationship_summary',
    'Get a summary of all relationships for a specific entity (company or person)',
    {
      entityId: z.string().describe('The ID of the entity to get relationship summary for'),
      entityType: z.enum(['company', 'person']).describe('The type of entity (company or person)'),
    },
    async (args) => {
      try {
        const result = await client.getRelationshipSummary(args.entityId, args.entityType);
        
        return {
          content: [{
            type: 'text' as const,
            text: `Relationship Summary for ${args.entityType}: ${args.entityId}\n\n` +
                  `Connected Relationships:\n` +
                  `• Companies: ${result.relationships.companies}\n` +
                  `• Contacts: ${result.relationships.contacts}\n` +
                  `• Opportunities: ${result.relationships.opportunities}\n` +
                  `• Tasks: ${result.relationships.tasks}\n` +
                  `• Activities: ${result.relationships.activities}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error getting relationship summary: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );

  server.tool(
    'find_orphaned_records',
    'Find records that are missing important relationships (companies without contacts, contacts without companies, etc.)',
    {},
    async (args) => {
      try {
        const result = await client.findOrphanedRecords();
        
        let report = 'Orphaned Records Report\n====================\n\n';
        
        // Companies without contacts
        if (result.companies.length > 0) {
          report += `Companies without contacts (${result.companies.length}):\n`;
          result.companies.forEach(company => {
            report += `• ${company.name} (${company.opportunityCount} opportunities)\n  ID: ${company.id}\n`;
          });
          report += '\n';
        }
        
        // Contacts without companies
        if (result.contacts.length > 0) {
          report += `Contacts without companies (${result.contacts.length}):\n`;
          result.contacts.forEach(contact => {
            report += `• ${contact.name} (${contact.opportunityCount} opportunities)\n  ID: ${contact.id}\n`;
          });
          report += '\n';
        }
        
        // Summary
        report += `Summary:\n`;
        report += `• ${result.companies.length} companies without contacts\n`;
        report += `• ${result.contacts.length} contacts without companies\n`;
        report += `• ${result.opportunities.length} opportunities with missing relationships\n`;
        report += `• ${result.tasks.length} tasks without assignees`;

        if (result.companies.length === 0 && result.contacts.length === 0 && 
            result.opportunities.length === 0 && result.tasks.length === 0) {
          report += '\n\n✅ No orphaned records found! All records have proper relationships.';
        }

        return {
          content: [{
            type: 'text' as const,
            text: report
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: 'text' as const,
            text: `Error finding orphaned records: ${error instanceof Error ? error.message : 'Unknown error'}`
          }]
        };
      }
    }
  );
}

export { registerOpportunityTools, registerActivityTools, registerMetadataTools };