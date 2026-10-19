# Changelog

All notable changes to Twenty MCP Server will be documented in this file.

## [Unreleased]

### 🐛 Bug Fixes
- `search_opportunities` fallaba siempre (`Argument not allowed: skip`). Ahora pagina por
  cursor (`first`/`after`) y regresa `pageInfo`/`totalCount`. También incluye el ID de cada
  oportunidad en la respuesta para poder usar `get_opportunity`.
- `search_contacts` y `search_companies` ignoraban `offset` sin avisar. Ahora usan `cursor`.
- `get_tasks` ignoraba `limit` y devolvía `body` vacío (Twenty movió el contenido a
  `bodyV2`). Ahora devuelve body, responsable, vencimiento y registros vinculados, y acepta
  filtros por estatus, responsable o registro vinculado.
- Sesión MCP con token renovado: la sesión seguía usando el token original y Twenty
  respondía "Token has expired". Ahora usa el token nuevo del mismo usuario, y un token
  expirado (por `exp` del JWT) o ya rechazado por Twenty recibe HTTP 401 `invalid_token`
  para que el cliente lo renueve solo.
- `list_opportunities_by_stage` pedía 100 registros en una sola consulta y Twenty limita a
  60 por consulta. Ahora recorre todas las páginas.
- Las herramientas de esquema (`list_all_objects`, `get_object_schema`, `get_field_metadata`)
  consultaban `/graphql` y pedían `isCustom`, que ya no existe en Twenty 2.x. Ahora usan
  `/metadata` y distinguen los objetos y campos personalizados por su aplicación. Verificadas
  contra crm.setec.one y activadas en el servidor HTTP.
- `create_note` mandaba `authorId`, que no existe en Twenty.
- `create_contact` / `update_contact` / `create_company` / `update_company` usaban campos que
  Twenty 2.x ya no tiene (`city`, `employees`, `xLink`, `annualRecurringRevenue`,
  `idealCustomerProfile`) y `update_contact` mandaba los datos planos (`firstName`, `email`...)
  en vez de la forma anidada de Twenty. Ahora se mapean bien; la empresa acepta
  `annualRevenue` (con `currency`, default MXN) y `accountOwnerId`, y los teléfonos sin `+`
  se mandan con su país (`phoneCountry`, default MX). Verificado con
  `scripts/check-write-fields.ts`.

### 🎉 Added
- `get_task`, `update_task`, `get_notes`, `get_note`, `list_workspace_members`.
- `create_task` y `create_note` aceptan `companyId`, `personId` y `opportunityId`.
  `link_activity` vincula una tarea o nota ya existente. Los nombres de columna
  (`companyId` o `targetCompanyId`) se detectan según la versión de Twenty.
- `delete_record` en dos pasos: la primera llamada muestra qué se borraría y entrega un
  `confirmationToken` de un solo uso (10 min). Solo se borra con ese código. Está marcada
  como destructiva (`destructiveHint`). Los registros van a la papelera de Twenty.
- La raíz `/` responde igual que `/mcp`. Se sirven los metadatos OAuth también en
  `/.well-known/oauth-protected-resource/mcp` (RFC 9728).
- `npm run test:unit`, `npm run verify:live`, `npm run e2e:write` y `npm run e2e:http`.

### 💔 Breaking Changes
- Las búsquedas y `get_tasks` usan `cursor` en lugar de `offset`, y regresan
  `{ results, pageInfo, totalCount }` en lugar de un arreglo.
- Se quitaron los parámetros `city` (contactos) y `employees`, `xUrl`,
  `annualRecurringRevenue`, `idealCustomerProfile` (empresas), que Twenty 2.x rechaza.

## [1.3.0] - 2026-01-12

### 🎉 Added
- **Docker MCP Support**: Now available on [Docker Hub MCP Registry](https://hub.docker.com/mcp)!
  - Install via Docker Desktop MCP Catalog
  - Or use `docker mcp install twenty-mcp`
  - Configuration files in `docker-mcp/` directory

### 🔒 Security
- Updated MCP SDK to latest version (security fixes)
- Fixed all npm audit vulnerabilities (was 7, now 0)
- Updated body-parser, js-yaml, qs, and tmp dependencies

### 📚 Documentation
- Added Docker MCP installation option to README
- Updated installation comparison table

### 🔧 Technical Improvements
- Repository unarchived and refreshed for continued maintenance

## [1.2.0] - 2025-06-24

### 🎉 Added
- **npx Support**: Try Twenty MCP Server instantly without installation!
  - Run `npx twenty-mcp-server setup` to get started immediately
  - No global installation required - perfect for evaluation
  - Configuration automatically persists between npx runs
  - Smart context detection for npx vs global installation
  
### 🚀 Features
- Execution context detection system (npx/global/local)
- Context-aware CLI messaging and headers
- npx-specific welcome messages and onboarding
- Performance tips for first-time npx users
- Clear migration path from npx to global installation
- Optimized package size (114.5 KB) for fast npx downloads

### 📚 Documentation
- README now prominently features npx as the quickest way to try
- Added npx examples throughout documentation
- IDE configuration notes for npx users
- Installation comparison table with npx option

### 🔧 Technical Improvements
- Created `src/cli/utils/execution-context.ts` for context detection
- Created `src/cli/utils/npx-helpers.ts` for npx-specific utilities
- Updated CLI entry point with context awareness
- Enhanced setup wizard with npx-specific guidance
- Smart postinstall script that detects execution context

### 🐛 Bug Fixes
- None in this release

### 💔 Breaking Changes
- None - full backward compatibility maintained

## [1.1.0] - Previous Release

- Initial OAuth 2.1 implementation
- IP address protection features
- Enhanced setup wizard
- Cross-platform compatibility improvements