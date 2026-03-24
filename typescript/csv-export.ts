/**
 * VSDH Config Import CSV Export Module
 *
 * Exports 3-tier records to CSV matching VSDH's import template headers.
 *
 * Usage:
 *   import {
 *     exportOrganizationsCsv,
 *     exportBusinessesCsv,
 *     exportLocationsCsv,
 *     exportAllCsvs,
 *     downloadAllCsvs,
 *     downloadCsv,
 *   } from './csv-export';
 *
 *   const csvs = exportAllCsvs(submissions);
 *   downloadAllCsvs(csvs);
 */

import {
  BusinessLocationRecord,
  BusinessRecord,
  OnboardingSubmission,
  OrganizationRecord,
} from './types';

type ExportColumn<T> = {
  header: string;
  get: (record: T) => unknown;
};

export const ORG_COLUMNS: readonly ExportColumn<OrganizationRecord>[] = [{ header: 'name', get: r => r.name }] as const;

export const BUSINESS_COLUMNS: readonly ExportColumn<BusinessRecord>[] = [
  { header: 'OrganizationName', get: r => r.organization_name },
  { header: 'name', get: r => r.name },
  { header: 'Description', get: r => r.description },
  { header: 'Phone', get: r => r.phone },
  { header: 'Tagline', get: r => r.tagline },
  { header: 'Do not display on the header', get: r => (r.do_not_display_on_header ? 'True' : 'False') },
  { header: 'AddressLine1', get: r => r.address_line1 },
  { header: 'AddressLine2', get: r => r.address_line2 },
  { header: 'City', get: r => r.city },
  { header: 'State', get: r => r.state },
  { header: 'Zipcode', get: r => r.zipcode },
  { header: 'Country', get: r => r.country },
  { header: 'Platform service fee (paid by client) - Mode', get: r => r.platform_fee_client_mode },
  { header: 'Platform service fee (paid by client) - Amount', get: r => r.platform_fee_client_amount },
  { header: 'Platform service fee (Charged from business commission) - Mode', get: r => r.platform_fee_commission_mode },
  { header: 'Platform service fee (Charged from business commission) - Amount', get: r => r.platform_fee_commission_amount },
] as const;

export const LOCATION_COLUMNS: readonly ExportColumn<BusinessLocationRecord>[] = [
  { header: 'BusinessName', get: r => r.business_name },
  { header: 'Name', get: r => r.name },
  { header: 'Phone', get: r => r.phone },
  { header: 'OperationType', get: r => r.operation_type },
  { header: 'ServiceableStates', get: r => r.serviceable_states },
  { header: 'AddressLine1', get: r => r.address_line1 },
  { header: 'AddressLine2', get: r => r.address_line2 },
  { header: 'City', get: r => r.city },
  { header: 'State', get: r => r.state },
  { header: 'Zipcode', get: r => r.zipcode },
  { header: 'Country', get: r => r.country },
] as const;

function escapeCsvField(value: string): string {
  if (!value) return '';
  // Prevent CSV formula injection (=, +, -, @, tab, CR can trigger formulas in Excel)
  if (/^[=+\-@\t\r]/.test(value)) {
    value = "'" + value;
  }
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function exportCsv<T>(
  records: T[],
  columns: readonly ExportColumn<T>[],
  options: { includeHeaders?: boolean } = {}
): string {
  const { includeHeaders = true } = options;
  const lines: string[] = [];

  if (includeHeaders) {
    lines.push(columns.map(c => c.header).join(','));
  }

  for (const record of records) {
    const values = columns.map(c => escapeCsvField(String(c.get(record) ?? '')));
    lines.push(values.join(','));
  }

  return lines.join('\r\n');
}

export function exportOrganizationsCsv(records: OrganizationRecord[], options: { includeHeaders?: boolean } = {}): string {
  return exportCsv(records, ORG_COLUMNS, options);
}

export function exportBusinessesCsv(records: BusinessRecord[], options: { includeHeaders?: boolean } = {}): string {
  return exportCsv(records, BUSINESS_COLUMNS, options);
}

export function exportLocationsCsv(records: BusinessLocationRecord[], options: { includeHeaders?: boolean } = {}): string {
  return exportCsv(records, LOCATION_COLUMNS, options);
}

export function exportAllCsvs(submissions: OnboardingSubmission[]): {
  organization: string;
  business: string;
  location: string;
} {
  const orgByName = new Map<string, OrganizationRecord>();
  const bizByName = new Map<string, BusinessRecord>();
  const locByKey = new Map<string, BusinessLocationRecord>();

  for (const s of submissions) {
    const orgName = String(s.organization?.name || '').trim();
    if (orgName) orgByName.set(orgName.toLowerCase(), { name: orgName });

    const bizName = String(s.business?.name || '').trim();
    if (bizName) {
      bizByName.set(bizName.toLowerCase(), {
        ...s.business,
        organization_name: s.business.organization_name || orgName,
      });
    }

    const locName = String(s.location?.name || '').trim();
    const locKey = `${bizName.toLowerCase()}::${locName.toLowerCase()}`;
    if (bizName && locName) {
      locByKey.set(locKey, {
        ...s.location,
        business_name: s.location.business_name || bizName,
      });
    }
  }

  const orgs = Array.from(orgByName.values());
  const businesses = Array.from(bizByName.values());
  const locations = Array.from(locByKey.values());

  return {
    organization: exportOrganizationsCsv(orgs),
    business: exportBusinessesCsv(businesses),
    location: exportLocationsCsv(locations),
  };
}

/**
 * Trigger a CSV file download in the browser.
 * Prepends UTF-8 BOM for Excel compatibility.
 */
export function downloadCsv(csvText: string, filename: string = 'export.csv'): void {
  // BOM ensures Excel opens the file as UTF-8
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadAllCsvs(
  csvs: { organization: string; business: string; location: string },
  options: { organizationName?: string; businessName?: string } = {}
): void {
  const orgSuffix = options.organizationName ? `-${options.organizationName}` : '';
  const bizSuffix = options.businessName ? `-${options.businessName}` : '';

  downloadCsv(csvs.organization, `Organization${orgSuffix}.csv`);
  downloadCsv(csvs.business, `Business${bizSuffix}.csv`);
  downloadCsv(csvs.location, `BusinessLocation${bizSuffix}.csv`);
}
