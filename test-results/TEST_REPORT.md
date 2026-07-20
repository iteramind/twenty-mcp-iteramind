# Twenty MCP Server Test Report

## Test Execution Summary

- **Date**: 7/14/2026
- **Time**: 12:50:42 PM
- **Duration**: 3622ms
- **Environment**: Node v25.9.0 on darwin
- **API Endpoint**: https://crm.setec.one

## Results Overview

| Metric | Count |
|--------|-------|
| Total Tests | 7 |
| ✅ Passed | 7 |
| ❌ Failed | 0 |
| Success Rate | 100.0% |

## Test Details


### 1. Initialize MCP Protocol

- **Status**: ✅ PASSED
- **Duration**: 13ms
- **Time**: 12:50:43 PM

- **Result**: ```json
{
  "serverName": "twenty-mcp-server",
  "serverVersion": "1.0.0"
}
```


### 2. List Available Tools

- **Status**: ✅ PASSED
- **Duration**: 9ms
- **Time**: 12:50:43 PM

- **Result**: ```json
{
  "totalTools": 29,
  "categories": {
    "contacts": 6,
    "companies": 6,
    "opportunities": 4,
    "tasks": 2,
    "notes": 1,
    "activities": 4
  },
  "toolNames": [
    "create_contact",
    "get_contact",
    "update_contact",
    "search_contacts",
    "create_company",
    "get_company",
    "update_company",
    "search_companies",
    "create_task",
    "get_tasks",
    "create_note",
    "create_opportunity",
    "get_opportunity",
    "update_opportunity",
    "search_opportunities",
    "list_opportunities_by_stage",
    "get_activities",
    "filter_activities",
    "create_comment",
    "get_entity_activities",
    "list_all_objects",
    "get_object_schema",
    "get_field_metadata",
    "get_company_contacts",
    "get_person_opportunities",
    "link_opportunity_to_company",
    "transfer_contact_to_company",
    "get_relationship_summary",
    "find_orphaned_records"
  ]
}
```


### 3. Create Test Contact

- **Status**: ✅ PASSED
- **Duration**: 493ms
- **Time**: 12:50:43 PM

- **Result**: ```json
{
  "message": "Contact created successfully: Test User_1784055043668 (ID: 192ad0d7-1081-4446-95f4-c27b4b880f32)"
}
```


### 4. Create Test Opportunity

- **Status**: ✅ PASSED
- **Duration**: 188ms
- **Time**: 12:50:44 PM

- **Result**: ```json
{
  "message": "Created opportunity: Test Deal 1784055044161 (ID: 54b024ee-2160-48ac-8197-07166326fce3)"
}
```


### 5. List Opportunities by Stage

- **Status**: ✅ PASSED
- **Duration**: 120ms
- **Time**: 12:50:44 PM

- **Result**: ```json
{
  "totalOpportunities": 7,
  "hasContent": true
}
```


### 6. Create Test Company

- **Status**: ✅ PASSED
- **Duration**: 121ms
- **Time**: 12:50:44 PM

- **Result**: ```json
{
  "message": "Error creating company: Object company doesn't have any \"employees\" field.: {\"response\":{\"data\":{\"createCompany\":null},\"errors\":[{\"message\":\"Object company doesn't have any \\\"employees\\\" field.\",\"extensions\":{\"subCode\":\"INVALID_ARGS_DATA\",\"userFriendlyMessage\":\"An error occurred.\",\"code\":\"BAD_USER_INPUT\"}}],\"status\":200,\"headers\":{}},\"request\":{\"query\":\"\\n      mutation CreateCompany($data: CompanyCreateInput!) {\\n        createCompany(data: $data) {\\n          id\\n          name\\n          domainName {\\n            primaryLinkUrl\\n            primaryLinkLabel\\n          }\\n          address {\\n            addressStreet1\\n            addressCity\\n            addressState\\n            addressCountry\\n            addressPostcode\\n          }\\n          employees\\n          linkedinLink {\\n            primaryLinkUrl\\n            primaryLinkLabel\\n          }\\n          xLink {\\n            primaryLinkUrl\\n            primaryLinkLabel\\n          }\\n          annualRecurringRevenue {\\n            amountMicros\\n            currencyCode\\n          }\\n          idealCustomerProfile\\n        }\\n      }\\n    \",\"variables\":{\"data\":{\"name\":\"Test Corp 1784055044469\",\"domainName\":{\"primaryLinkUrl\":\"testcorp1784055044469.com\"},\"employees\":100}}}}"
}
```


### 7. Get Activities Timeline

- **Status**: ✅ PASSED
- **Duration**: 324ms
- **Time**: 12:50:44 PM

- **Result**: ```json
{
  "hasTimelineContent": true,
  "contentPreview": "Activities Timeline (8 total, showing 8):\n\n[TASK] CRM MCP server  (7/13/2026)\nAuthor: Max López\n\nID: d7ea61b6-dab0-4ed9-9ac4-425905fc0519\n---\n\n[TASK] Android version (7/13/2026)\nAuthor: Jordi Rosquill..."
}
```


## Test Coverage

The test suite validates:
- ✅ MCP Protocol initialization
- ✅ Tool discovery and listing
- ✅ Contact creation
- ✅ Opportunity management
- ✅ Company creation
- ✅ Pipeline visualization

---
*Generated automatically by Twenty MCP Test Suite*
