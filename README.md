# VSDH Bulk Onboarding System

Bulk onboarding pipeline for VS Digital Health. Collects business info via invite links, stores it in a Google Sheet, and exports CSVs that match VSDH's exact import template.

## How It Works

```
admin.html                    onboard.html                 Google Sheet
─────────────────             ─────────────────            ──────────────
Upload CSV of emails    →     Business owner clicks   →    Data lands in 3 tabs:
Create invite links           invite link, fills out       Organization
Send emails                   org/biz/location info        Business
Download export CSVs                                       BusinessLocation
                                                           (+ Invites tab)
```

The exported CSVs match `Config Import.xlsx` exactly — same tab names, headers, and value formats. VSDH imports them directly using the TypeScript module below.

---

## For the Operator (invite management)

### Setup

1. Open the Google Sheet → **Extensions → Apps Script** → paste `google-apps-script/Code.gs`
2. In Apps Script: **Project Settings → Script Properties** → add `ADMIN_KEY` with a secret value
3. **Deploy → New deployment → Web app** → Execute as: Me, Who has access: Anyone → Deploy
4. Copy the `/exec` URL

### Sending Invites

1. Open `admin.html` in a browser (can be hosted anywhere or opened locally)
2. In Settings, enter:
   - **Script URL**: the `/exec` URL from step 4 above
   - **Admin Key**: the `ADMIN_KEY` value you set
   - **Onboarding Page URL**: the URL where `onboard.html` is hosted
3. Upload a CSV with columns `email` and `business_name` (one row per invite)
4. Click **Create Invites** → then **Send Emails**
5. Business owners receive an email with a link to `onboard.html`

### Exporting for Import

After businesses complete onboarding:
1. In `admin.html`, click **Download Import CSVs**
2. You get 3 files: `Organization.csv`, `Business.csv`, `BusinessLocation.csv`
3. These match `Config Import.xlsx` and are ready for VSDH import

---

## For VSDH (bulk import/export in your dashboard)

Everything in the `typescript/` folder is yours. Drop it into your React project.

### Files

| File | Purpose |
|------|---------|
| `types.ts` | Shared interfaces (`OrganizationRecord`, `BusinessRecord`, `BusinessLocationRecord`) and CSV column maps |
| `csv-import.ts` | Parses CSVs, validates every field, normalizes to your schema, calls your callback per row |
| `csv-export.ts` | Exports records to CSV with headers matching `Config Import.xlsx` |
| `BulkOperations.tsx` | Drop-in React component with Import and Export buttons |

### Quick Start

```tsx
import { BulkOperations } from './BulkOperations';

function AdminDashboard() {
  return (
    <BulkOperations
      onImportOrganization={async (record) => {
        // Wire to your GraphQL mutation
        await graphqlClient.mutate({
          mutation: CREATE_ORGANIZATION,
          variables: { input: { name: record.name } },
        });
      }}
      onImportBusiness={async (record) => {
        await graphqlClient.mutate({
          mutation: CREATE_BUSINESS,
          variables: { input: record },
        });
      }}
      onImportLocation={async (record) => {
        await graphqlClient.mutate({
          mutation: CREATE_LOCATION,
          variables: { input: record },
        });
      }}
      onFetchExportData={async () => {
        // Return array of { organization, business, location } objects
        const { data } = await graphqlClient.query({ query: GET_ALL_SUBMISSIONS });
        return data.submissions;
      }}
    />
  );
}
```

### Using the Functions Directly (without the component)

```ts
import { importBusinessesFromCsv } from './csv-import';
import { downloadAllCsvs, exportAllCsvs } from './csv-export';

// Import: reads CSV, validates, calls your callback per row
const result = await importBusinessesFromCsv(csvText, async (record) => {
  await yourGraphqlMutation(record);
});
console.log(`${result.imported} imported, ${result.errors.length} errors`);

// Export: takes your records, downloads 3 CSVs
const csvs = exportAllCsvs(submissions);
downloadAllCsvs(csvs);
```

### Import Order

Import in this order (parent records must exist before children reference them):
1. **Organization** — just `name`
2. **Business** — references `OrganizationName`
3. **BusinessLocation** — references `BusinessName`

### Data Formats

| Field | Format | Example |
|-------|--------|---------|
| Phone | E.164 | `+18887776543` |
| State | 2-letter uppercase | `AZ` |
| Country | 3-letter | `USA` |
| ServiceableStates | Curly-brace list | `{AZ,CA,GA}` |
| OperationType | String | `Virtual` |
| DoNotDisplayOnHeader | String boolean | `True` / `False` |
| Fee Mode | Enum | `FIXED` / `PERCENTAGE` |
| Fee Amount | 2 decimals | `10.00` |

---

## File Map

```
├── admin.html                     Operator dashboard (invite management + CSV export)
├── onboard.html                   Public onboarding form (4-step wizard)
├── google-apps-script/
│   └── Code.gs                    Google Apps Script backend (serverless)
├── typescript/
│   ├── types.ts                   Shared TypeScript interfaces + column maps
│   ├── csv-import.ts              CSV parser, validator, importer (callback pattern)
│   ├── csv-export.ts              CSV exporter (matching Config Import.xlsx headers)
│   └── BulkOperations.tsx         Drop-in React component for VSDH dashboard
└── Config Import.xlsx             VSDH's import template (source of truth for schema)
```

## Google Sheet Tab Structure

| Tab | Created By | Purpose |
|-----|-----------|---------|
| `Organization` | Code.gs | Organization records (name) |
| `Business` | Code.gs | Business records (16 fields) |
| `BusinessLocation` | Code.gs | Location records (11 fields) |
| `Invites` | Code.gs | Invite tracking (tokens, status, timestamps) |

These tab names match `Config Import.xlsx` exactly.
