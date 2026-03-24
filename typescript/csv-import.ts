/**
 * VSDH Config Import CSV Import Module
 *
 * Parses CSV text (RFC 4180 compliant, including multiline quoted fields), validates rows,
 * and calls a provided create*() callback for each valid record.
 *
 * Usage:
 *   import {
 *     importOrganizationsFromCsv,
 *     importBusinessesFromCsv,
 *     importLocationsFromCsv,
 *   } from './csv-import';
 *
 *   const result = await importBusinessesFromCsv(csvText, async (record) => {
 *     await db.business.create({ data: record });
 *   });
 *
 *   console.log(`Imported ${result.imported}/${result.total}`);
 */

import {
  BusinessLocationRecord,
  BusinessRecord,
  CsvColumnMap,
  DEFAULT_BUSINESS_COLUMN_MAP,
  DEFAULT_LOCATION_COLUMN_MAP,
  DEFAULT_ORGANIZATION_COLUMN_MAP,
  ImportResult,
  OrganizationRecord,
  RowError,
} from './types';

// ── Validation ─────────────────────────────────────────────────────────────

const US_STATES: ReadonlySet<string> = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN',
  'IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH',
  'NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT',
  'VT','VA','WA','WV','WI','WY',
]);

function normalizePhoneToE164(phone: string): string {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;

  // If it's already country-code-prefixed, allow it (basic E.164 bounds)
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  return '';
}

function isValidZip(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(String(zip || '').trim());
}

function normalizeState(state: string): string {
  return String(state || '').trim().toUpperCase();
}

function normalizeCountry(country: string | undefined): string {
  const c = String(country || '').trim();
  return c ? c : 'USA';
}

function normalizeFeeMode(mode: unknown): string | undefined {
  const m = String(mode ?? '').trim();
  if (!m) return undefined;
  const upper = m.toUpperCase();
  if (upper !== 'FIXED' && upper !== 'PERCENTAGE') return undefined;
  return upper;
}

function normalizeFeeAmount(amount: unknown): string | undefined {
  const raw = String(amount ?? '').trim();
  if (!raw) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) return undefined;
  return num.toFixed(2);
}

function parseTrueFalse(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === '1') return true;
  if (raw === '0') return false;
  if (raw === 'yes') return true;
  if (raw === 'no') return false;
  return null;
}

function normalizeServiceableStates(value: unknown): string | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  const hasBraces = raw.startsWith('{') && raw.endsWith('}');
  const inner = hasBraces ? raw.slice(1, -1) : raw;
  const parts = inner
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter(Boolean);

  if (!parts.length) return undefined;
  for (const code of parts) {
    if (!/^[A-Z]{2}$/.test(code)) return undefined;
    if (!US_STATES.has(code)) return undefined;
  }

  return `{${parts.join(',')}}`;
}

function validateFeePair(modeValue: unknown, amountValue: unknown, label: string): string | null {
  const mode = String(modeValue ?? '').trim();
  const amount = String(amountValue ?? '').trim();

  if (!mode && !amount) return null;

  const normalizedMode = normalizeFeeMode(mode);
  if (!normalizedMode) return `${label} mode must be FIXED or PERCENTAGE`;

  const normalizedAmount = normalizeFeeAmount(amount);
  if (!normalizedAmount) return `${label} amount must be numeric (2 decimals)`;

  return null;
}

function validateOrganizationRecord(record: Partial<OrganizationRecord>): string | null {
  if (!record.name?.trim()) return 'Missing name';
  return null;
}

function validateBusinessRecord(record: Partial<BusinessRecord>): string | null {
  if (!record.organization_name?.trim()) return 'Missing organization_name';
  if (!record.name?.trim()) return 'Missing name';
  if (!record.phone?.trim()) return 'Missing phone';
  if (!record.address_line1?.trim()) return 'Missing address_line1';
  if (!record.city?.trim()) return 'Missing city';

  const state = normalizeState(record.state || '');
  if (!state) return 'Missing state';
  if (!US_STATES.has(state)) return `Invalid state: ${state}`;

  const zip = String(record.zipcode || '').trim();
  if (!zip) return 'Missing zipcode';
  if (!isValidZip(zip)) return `Invalid zipcode: ${zip}`;

  const phone = normalizePhoneToE164(record.phone || '');
  if (!phone) return `Invalid phone: ${record.phone}`;

  if (record.do_not_display_on_header !== undefined) {
    const b = parseTrueFalse(record.do_not_display_on_header);
    if (b === null) return 'DoNotDisplayOnHeader must be True or False';
  }

  const feeClientError = validateFeePair(
    record.platform_fee_client_mode,
    record.platform_fee_client_amount,
    'Platform service fee (paid by client)'
  );
  if (feeClientError) return feeClientError;

  const feeCommError = validateFeePair(
    record.platform_fee_commission_mode,
    record.platform_fee_commission_amount,
    'Platform service fee (charged from business commission)'
  );
  if (feeCommError) return feeCommError;

  return null;
}

function validateLocationRecord(record: Partial<BusinessLocationRecord>): string | null {
  if (!record.business_name?.trim()) return 'Missing business_name';
  if (!record.name?.trim()) return 'Missing name';
  if (!record.phone?.trim()) return 'Missing phone';
  if (!record.address_line1?.trim()) return 'Missing address_line1';
  if (!record.city?.trim()) return 'Missing city';

  const state = normalizeState(record.state || '');
  if (!state) return 'Missing state';
  if (!US_STATES.has(state)) return `Invalid state: ${state}`;

  const zip = String(record.zipcode || '').trim();
  if (!zip) return 'Missing zipcode';
  if (!isValidZip(zip)) return `Invalid zipcode: ${zip}`;

  const phone = normalizePhoneToE164(record.phone || '');
  if (!phone) return `Invalid phone: ${record.phone}`;

  if (record.serviceable_states?.trim()) {
    const normalized = normalizeServiceableStates(record.serviceable_states);
    if (!normalized) return `Invalid ServiceableStates: ${record.serviceable_states}`;
  }

  return null;
}

function normalizeOrganizationRecord(record: Partial<OrganizationRecord>): OrganizationRecord {
  return { name: String(record.name || '').trim() };
}

function normalizeBusinessRecord(record: Partial<BusinessRecord>): BusinessRecord {
  const doNotDisplay = parseTrueFalse(record.do_not_display_on_header);
  const clientMode = normalizeFeeMode(record.platform_fee_client_mode);
  const clientAmount = normalizeFeeAmount(record.platform_fee_client_amount);
  const commMode = normalizeFeeMode(record.platform_fee_commission_mode);
  const commAmount = normalizeFeeAmount(record.platform_fee_commission_amount);

  return {
    organization_name: String(record.organization_name || '').trim(),
    name: String(record.name || '').trim(),
    description: record.description ? String(record.description).trim() : undefined,
    phone: normalizePhoneToE164(String(record.phone || '')),
    tagline: record.tagline ? String(record.tagline).trim() : undefined,
    do_not_display_on_header: doNotDisplay === null ? false : doNotDisplay,
    address_line1: String(record.address_line1 || '').trim(),
    address_line2: record.address_line2 ? String(record.address_line2).trim() : undefined,
    city: String(record.city || '').trim(),
    state: normalizeState(String(record.state || '')),
    zipcode: String(record.zipcode || '').trim(),
    country: normalizeCountry(record.country),
    platform_fee_client_mode: clientMode,
    platform_fee_client_amount: clientAmount,
    platform_fee_commission_mode: commMode,
    platform_fee_commission_amount: commAmount,
  };
}

function normalizeLocationRecord(record: Partial<BusinessLocationRecord>): BusinessLocationRecord {
  return {
    business_name: String(record.business_name || '').trim(),
    name: String(record.name || '').trim(),
    phone: normalizePhoneToE164(String(record.phone || '')),
    operation_type: String(record.operation_type || 'Virtual').trim() || 'Virtual',
    serviceable_states: normalizeServiceableStates(record.serviceable_states),
    address_line1: String(record.address_line1 || '').trim(),
    address_line2: record.address_line2 ? String(record.address_line2).trim() : undefined,
    city: String(record.city || '').trim(),
    state: normalizeState(String(record.state || '')),
    zipcode: String(record.zipcode || '').trim(),
    country: normalizeCountry(record.country),
  };
}

// ── CSV Parsing (RFC 4180 compliant, handles multiline fields) ──────────────

/**
 * Parse CSV text into a 2D array of strings.
 * Handles quoted fields, escaped quotes (""), and multiline values inside quotes.
 */
function parseCsvRows(csvText: string): string[][] {
  // Strip UTF-8 BOM if present (common in Excel exports)
  if (csvText.charCodeAt(0) === 0xfeff) {
    csvText = csvText.slice(1);
  }

  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let fields: string[] = [];

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];

    if (ch === '"') {
      if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && i + 1 < csvText.length && csvText[i + 1] === '\n') i++;
      fields.push(current);
      if (fields.some(f => f.trim() !== '')) rows.push(fields);
      fields = [];
      current = '';
    } else {
      current += ch;
    }
  }

  // Last row (no trailing newline)
  fields.push(current);
  if (fields.some(f => f.trim() !== '')) rows.push(fields);

  return rows;
}

function normalizeHeaderKey(header: string): string {
  return header.toLowerCase().trim();
}

function stripHeaderKey(header: string): string {
  return header.replace(/[^a-z0-9]/g, '');
}

function buildColumnLookup<T extends object>(
  defaultMap: CsvColumnMap<T>,
  customMap?: Partial<CsvColumnMap<T>>
): Record<string, keyof T> {
  const lookup: Record<string, keyof T> = { ...(defaultMap as Record<string, keyof T>) };
  if (!customMap) return lookup;

  for (const key of Object.keys(customMap)) {
    const field = customMap[key];
    if (!field) continue;
    const normalized = normalizeHeaderKey(key);
    const stripped = stripHeaderKey(normalized);
    lookup[normalized] = field;
    lookup[stripped] = field;
  }

  return lookup;
}

function mapHeaders<T extends object>(
  headerRow: string[],
  defaultMap: CsvColumnMap<T>,
  customMap?: Partial<CsvColumnMap<T>>
): Map<number, keyof T> {
  const map = new Map<number, keyof T>();
  const lookup = buildColumnLookup(defaultMap, customMap);

  headerRow.forEach((header, index) => {
    const normalized = normalizeHeaderKey(header);
    const stripped = stripHeaderKey(normalized);

    const field = lookup[normalized] || lookup[stripped];
    if (field) map.set(index, field);
  });

  return map;
}

function parseCsv<T extends object>(
  csvText: string,
  defaultMap: CsvColumnMap<T>,
  customColumnMap?: Partial<CsvColumnMap<T>>
): { records: Array<{ data: Partial<T>; sourceRow: number }>; headerMap: Map<number, keyof T> } {
  const allRows = parseCsvRows(csvText);
  if (allRows.length < 2) return { records: [], headerMap: new Map() };

  const headerRow = allRows[0];
  const headerMap = mapHeaders<T>(headerRow, defaultMap, customColumnMap);

  const records: Array<{ data: Partial<T>; sourceRow: number }> = [];

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    const record: Partial<T> = {};

    headerMap.forEach((field, colIndex) => {
      if (colIndex < cols.length && cols[colIndex].trim()) {
        (record as Record<string, unknown>)[String(field)] = cols[colIndex].trim();
      }
    });

    // Skip completely empty rows
    if (Object.keys(record).length > 0) {
      records.push({ data: record, sourceRow: i + 1 }); // +1 for 1-based row number
    }
  }

  return { records, headerMap };
}

// ── Main Import Functions ──────────────────────────────────────────────────

export interface ImportOptions<T extends object> {
  /** Custom column name mapping. Merged with defaults. */
  columnMap?: Partial<CsvColumnMap<T>>;
  /** Skip validation (not recommended). Default: false. */
  skipValidation?: boolean;
  /** Continue on error instead of stopping. Default: true. */
  continueOnError?: boolean;
  /** Callback before each insert — return false to skip this record. */
  beforeInsert?: (record: T, row: number) => boolean | Promise<boolean>;
}

async function importFromCsv<T extends object>(
  csvText: string,
  sheet: string,
  defaultColumnMap: CsvColumnMap<T>,
  validate: (record: Partial<T>) => string | null,
  normalize: (record: Partial<T>) => T,
  createRecord: (record: T) => Promise<void>,
  options: ImportOptions<T> = {}
): Promise<ImportResult> {
  const { columnMap, skipValidation = false, continueOnError = true, beforeInsert } = options;

  const { records } = parseCsv<T>(csvText, defaultColumnMap, columnMap);

  const result: ImportResult = {
    total: records.length,
    imported: 0,
    skipped: 0,
    errors: [],
  };

  for (const { data: raw, sourceRow } of records) {
    if (!skipValidation) {
      const error = validate(raw);
      if (error) {
        result.errors.push({ row: sourceRow, sheet, data: raw as Record<string, unknown>, reason: error });
        result.skipped++;
        if (!continueOnError) break;
        continue;
      }
    }

    const normalized = normalize(raw);

    if (beforeInsert) {
      const proceed = await beforeInsert(normalized, sourceRow);
      if (!proceed) {
        result.skipped++;
        continue;
      }
    }

    try {
      await createRecord(normalized);
      result.imported++;
    } catch (e: unknown) {
      const reason = e instanceof Error ? e.message : String(e);
      result.errors.push({ row: sourceRow, sheet, data: raw as Record<string, unknown>, reason });
      result.skipped++;
      if (!continueOnError) break;
    }
  }

  return result;
}

function validateCsv<T extends object>(
  csvText: string,
  sheet: string,
  defaultColumnMap: CsvColumnMap<T>,
  validate: (record: Partial<T>) => string | null,
  columnMap?: Partial<CsvColumnMap<T>>
): RowError[] {
  const { records } = parseCsv<T>(csvText, defaultColumnMap, columnMap);
  const errors: RowError[] = [];

  for (const { data: raw, sourceRow } of records) {
    const error = validate(raw);
    if (error) errors.push({ row: sourceRow, sheet, data: raw as Record<string, unknown>, reason: error });
  }

  return errors;
}

// ── Sheet-specific wrappers ────────────────────────────────────────────────

export function parseOrganizationsCsv(
  csvText: string,
  customColumnMap?: Partial<CsvColumnMap<OrganizationRecord>>
): {
  records: Array<{ data: Partial<OrganizationRecord>; sourceRow: number }>;
  headerMap: Map<number, keyof OrganizationRecord>;
} {
  return parseCsv<OrganizationRecord>(csvText, DEFAULT_ORGANIZATION_COLUMN_MAP, customColumnMap);
}

export function parseBusinessesCsv(
  csvText: string,
  customColumnMap?: Partial<CsvColumnMap<BusinessRecord>>
): {
  records: Array<{ data: Partial<BusinessRecord>; sourceRow: number }>;
  headerMap: Map<number, keyof BusinessRecord>;
} {
  return parseCsv<BusinessRecord>(csvText, DEFAULT_BUSINESS_COLUMN_MAP, customColumnMap);
}

export function parseLocationsCsv(
  csvText: string,
  customColumnMap?: Partial<CsvColumnMap<BusinessLocationRecord>>
): {
  records: Array<{ data: Partial<BusinessLocationRecord>; sourceRow: number }>;
  headerMap: Map<number, keyof BusinessLocationRecord>;
} {
  return parseCsv<BusinessLocationRecord>(csvText, DEFAULT_LOCATION_COLUMN_MAP, customColumnMap);
}

export async function importOrganizationsFromCsv(
  csvText: string,
  createOrganization: (record: OrganizationRecord) => Promise<void>,
  options: ImportOptions<OrganizationRecord> = {}
): Promise<ImportResult> {
  return importFromCsv<OrganizationRecord>(
    csvText,
    'Organization',
    DEFAULT_ORGANIZATION_COLUMN_MAP,
    validateOrganizationRecord,
    normalizeOrganizationRecord,
    createOrganization,
    options
  );
}

export async function importBusinessesFromCsv(
  csvText: string,
  createBusiness: (record: BusinessRecord) => Promise<void>,
  options: ImportOptions<BusinessRecord> = {}
): Promise<ImportResult> {
  return importFromCsv<BusinessRecord>(
    csvText,
    'Business',
    DEFAULT_BUSINESS_COLUMN_MAP,
    validateBusinessRecord,
    normalizeBusinessRecord,
    createBusiness,
    options
  );
}

export async function importLocationsFromCsv(
  csvText: string,
  createLocation: (record: BusinessLocationRecord) => Promise<void>,
  options: ImportOptions<BusinessLocationRecord> = {}
): Promise<ImportResult> {
  return importFromCsv<BusinessLocationRecord>(
    csvText,
    'BusinessLocation',
    DEFAULT_LOCATION_COLUMN_MAP,
    validateLocationRecord,
    normalizeLocationRecord,
    createLocation,
    options
  );
}

export function validateOrganizationsCsv(
  csvText: string,
  columnMap?: Partial<CsvColumnMap<OrganizationRecord>>
): RowError[] {
  return validateCsv<OrganizationRecord>(
    csvText,
    'Organization',
    DEFAULT_ORGANIZATION_COLUMN_MAP,
    validateOrganizationRecord,
    columnMap
  );
}

export function validateBusinessesCsv(csvText: string, columnMap?: Partial<CsvColumnMap<BusinessRecord>>): RowError[] {
  return validateCsv<BusinessRecord>(csvText, 'Business', DEFAULT_BUSINESS_COLUMN_MAP, validateBusinessRecord, columnMap);
}

export function validateLocationsCsv(
  csvText: string,
  columnMap?: Partial<CsvColumnMap<BusinessLocationRecord>>
): RowError[] {
  return validateCsv<BusinessLocationRecord>(
    csvText,
    'BusinessLocation',
    DEFAULT_LOCATION_COLUMN_MAP,
    validateLocationRecord,
    columnMap
  );
}
