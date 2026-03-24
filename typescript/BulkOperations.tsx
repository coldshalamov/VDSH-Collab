/**
 * VSDH Bulk Import/Export — Drop-in React Component
 *
 * Add this to your admin dashboard. Wire in your GraphQL mutations via props.
 *
 * Usage:
 *   import { BulkOperations } from './BulkOperations';
 *
 *   <BulkOperations
 *     onImportOrganization={async (record) => {
 *       await graphqlClient.mutate({ mutation: CREATE_ORGANIZATION, variables: record });
 *     }}
 *     onImportBusiness={async (record) => {
 *       await graphqlClient.mutate({ mutation: CREATE_BUSINESS, variables: record });
 *     }}
 *     onImportLocation={async (record) => {
 *       await graphqlClient.mutate({ mutation: CREATE_LOCATION, variables: record });
 *     }}
 *     onFetchExportData={async () => {
 *       const { data } = await graphqlClient.query({ query: GET_ALL_RECORDS });
 *       return data.submissions; // Array of OnboardingSubmission
 *     }}
 *   />
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  importOrganizationsFromCsv,
  importBusinessesFromCsv,
  importLocationsFromCsv,
} from './csv-import';
import {
  exportAllCsvs,
  downloadAllCsvs,
} from './csv-export';
import type {
  OrganizationRecord,
  BusinessRecord,
  BusinessLocationRecord,
  OnboardingSubmission,
  ImportResult,
  RowError,
} from './types';

// ── Types ──────────────────────────────────────────────────

interface BulkOperationsProps {
  /** Called for each organization row during import. Wire to your GraphQL CREATE_ORGANIZATION mutation. */
  onImportOrganization: (record: OrganizationRecord) => Promise<void>;
  /** Called for each business row during import. Wire to your GraphQL CREATE_BUSINESS mutation. */
  onImportBusiness: (record: BusinessRecord) => Promise<void>;
  /** Called for each location row during import. Wire to your GraphQL CREATE_LOCATION mutation. */
  onImportLocation: (record: BusinessLocationRecord) => Promise<void>;
  /** Fetch all records for export. Return an array of OnboardingSubmission objects. */
  onFetchExportData?: () => Promise<OnboardingSubmission[]>;
  /** Optional: custom class name for the container */
  className?: string;
}

type SheetType = 'Organization' | 'Business' | 'BusinessLocation';

interface ImportState {
  status: 'idle' | 'reading' | 'importing' | 'done' | 'error';
  sheet: SheetType | null;
  result: ImportResult | null;
  errorMessage: string | null;
}

interface ExportState {
  status: 'idle' | 'fetching' | 'done' | 'error';
  errorMessage: string | null;
  counts: { organizations: number; businesses: number; locations: number } | null;
}

// ── Component ──────────────────────────────────────────────

export function BulkOperations({
  onImportOrganization,
  onImportBusiness,
  onImportLocation,
  onFetchExportData,
  className,
}: BulkOperationsProps) {
  const [importState, setImportState] = useState<ImportState>({
    status: 'idle',
    sheet: null,
    result: null,
    errorMessage: null,
  });
  const [exportState, setExportState] = useState<ExportState>({
    status: 'idle',
    errorMessage: null,
    counts: null,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeSheetRef = useRef<SheetType | null>(null);

  // ── Import ───────────────────────────────────────────

  const startImport = useCallback((sheet: SheetType) => {
    activeSheetRef.current = sheet;
    setImportState({ status: 'idle', sheet, result: null, errorMessage: null });
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !activeSheetRef.current) return;

      // Reset input so the same file can be re-selected
      e.target.value = '';

      const sheet = activeSheetRef.current;

      if (!file.name.toLowerCase().endsWith('.csv')) {
        setImportState({ status: 'error', sheet, result: null, errorMessage: 'File must be a .csv' });
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setImportState({ status: 'error', sheet, result: null, errorMessage: 'File too large (max 10MB)' });
        return;
      }

      setImportState({ status: 'reading', sheet, result: null, errorMessage: null });

      try {
        const csvText = await file.text();

        setImportState({ status: 'importing', sheet, result: null, errorMessage: null });

        let result: ImportResult;
        switch (sheet) {
          case 'Organization':
            result = await importOrganizationsFromCsv(csvText, onImportOrganization);
            break;
          case 'Business':
            result = await importBusinessesFromCsv(csvText, onImportBusiness);
            break;
          case 'BusinessLocation':
            result = await importLocationsFromCsv(csvText, onImportLocation);
            break;
        }

        setImportState({ status: 'done', sheet, result, errorMessage: null });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setImportState({ status: 'error', sheet, result: null, errorMessage: msg });
      }
    },
    [onImportOrganization, onImportBusiness, onImportLocation]
  );

  // ── Export ───────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (!onFetchExportData) return;

    setExportState({ status: 'fetching', errorMessage: null, counts: null });

    try {
      const submissions = await onFetchExportData();

      if (!submissions.length) {
        setExportState({ status: 'error', errorMessage: 'No records to export', counts: null });
        return;
      }

      const csvs = exportAllCsvs(submissions);
      downloadAllCsvs(csvs);

      // Count unique entries for display
      const orgNames = new Set(submissions.map(s => s.organization?.name).filter(Boolean));
      const bizNames = new Set(submissions.map(s => s.business?.name).filter(Boolean));
      const locKeys = new Set(
        submissions.map(s => `${s.business?.name}::${s.location?.name}`).filter(k => k !== '::')
      );

      setExportState({
        status: 'done',
        errorMessage: null,
        counts: {
          organizations: orgNames.size,
          businesses: bizNames.size,
          locations: locKeys.size,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExportState({ status: 'error', errorMessage: msg, counts: null });
    }
  }, [onFetchExportData]);

  // ── Render ───────────────────────────────────────────

  const importing = importState.status === 'reading' || importState.status === 'importing';
  const exporting = exportState.status === 'fetching';

  return (
    <div className={className} style={{ fontFamily: 'inherit' }}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />

      {/* ── Import Section ─────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px' }}>Bulk Import from CSV</h3>
        <p style={{ margin: '0 0 12px', color: '#666', fontSize: 14 }}>
          Import records from CSV files matching the Config Import template.
          Upload one sheet type at a time. Order: Organization, then Business, then BusinessLocation.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => startImport('Organization')}
            disabled={importing}
            style={buttonStyle}
          >
            {importing && importState.sheet === 'Organization' ? 'Importing...' : 'Import Organizations'}
          </button>
          <button
            onClick={() => startImport('Business')}
            disabled={importing}
            style={buttonStyle}
          >
            {importing && importState.sheet === 'Business' ? 'Importing...' : 'Import Businesses'}
          </button>
          <button
            onClick={() => startImport('BusinessLocation')}
            disabled={importing}
            style={buttonStyle}
          >
            {importing && importState.sheet === 'BusinessLocation' ? 'Importing...' : 'Import Locations'}
          </button>
        </div>

        {/* Import result */}
        {importState.status === 'done' && importState.result && (
          <div style={{ ...resultBox, borderColor: importState.result.errors.length ? '#e67e22' : '#27ae60' }}>
            <strong>{importState.sheet}</strong>: {importState.result.imported} imported,{' '}
            {importState.result.skipped} skipped, {importState.result.errors.length} errors
            {importState.result.errors.length > 0 && (
              <ErrorTable errors={importState.result.errors} />
            )}
          </div>
        )}

        {importState.status === 'error' && (
          <div style={{ ...resultBox, borderColor: '#e74c3c' }}>
            Error: {importState.errorMessage}
          </div>
        )}
      </div>

      {/* ── Export Section ─────────────────────── */}
      {onFetchExportData && (
        <div>
          <h3 style={{ margin: '0 0 12px' }}>Bulk Export to CSV</h3>
          <p style={{ margin: '0 0 12px', color: '#666', fontSize: 14 }}>
            Download all records as 3 CSV files (Organization.csv, Business.csv, BusinessLocation.csv).
          </p>

          <button
            onClick={handleExport}
            disabled={exporting}
            style={buttonStyle}
          >
            {exporting ? 'Exporting...' : 'Export All CSVs'}
          </button>

          {exportState.status === 'done' && exportState.counts && (
            <div style={{ ...resultBox, borderColor: '#27ae60' }}>
              Downloaded: {exportState.counts.organizations} organizations,{' '}
              {exportState.counts.businesses} businesses,{' '}
              {exportState.counts.locations} locations
            </div>
          )}

          {exportState.status === 'error' && (
            <div style={{ ...resultBox, borderColor: '#e74c3c' }}>
              Error: {exportState.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Error Table ────────────────────────────────────────────

function ErrorTable({ errors }: { errors: RowError[] }) {
  const maxDisplay = 20;
  const shown = errors.slice(0, maxDisplay);
  const remaining = errors.length - maxDisplay;

  return (
    <div style={{ marginTop: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={thStyle}>Row</th>
            <th style={thStyle}>Error</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((err, i) => (
            <tr key={i}>
              <td style={tdStyle}>{err.row}</td>
              <td style={tdStyle}>{err.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {remaining > 0 && (
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#999' }}>
          ...and {remaining} more errors
        </p>
      )}
    </div>
  );
}

// ── Minimal inline styles (override with className prop) ───

const buttonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 14,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};

const resultBox: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderLeft: '4px solid',
  background: '#fafafa',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  borderBottom: '1px solid #ddd',
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid #eee',
};
