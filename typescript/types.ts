/**
 * VSDH Config Import — Shared Types
 *
 * Source of truth: PLAN.md (3-tier schema)
 */

export interface OrganizationRecord {
  name: string;
}

export interface BusinessRecord {
  organization_name: string;
  name: string;
  description?: string;
  phone: string; // E.164: +18887776543
  tagline?: string;
  do_not_display_on_header: boolean; // default false (export as "True"/"False")
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string; // 2-letter
  zipcode: string;
  country: string; // default "USA"
  platform_fee_client_mode?: string; // "FIXED" | "PERCENTAGE"
  platform_fee_client_amount?: string; // "10.00"
  platform_fee_commission_mode?: string; // "FIXED" | "PERCENTAGE"
  platform_fee_commission_amount?: string; // "10.00"
}

export interface BusinessLocationRecord {
  business_name: string;
  name: string;
  phone: string; // E.164
  operation_type: string; // "Virtual"
  serviceable_states?: string; // "{AZ,CA,GA}"
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zipcode: string;
  country: string; // default "USA"
}

export interface OnboardingSubmission {
  organization: OrganizationRecord;
  business: BusinessRecord;
  location: BusinessLocationRecord;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: RowError[];
}

export interface RowError {
  row: number;
  sheet: string;
  data: Record<string, unknown>;
  reason: string;
}

/** Maps lowercase/normalized CSV header → record key */
export type CsvColumnMap<T extends object> = Record<string, keyof T>;

export const DEFAULT_ORGANIZATION_COLUMN_MAP: CsvColumnMap<OrganizationRecord> = {
  name: 'name',
  organizationname: 'name',
  organization_name: 'name',
  'organization name': 'name',
  orgname: 'name',
  org_name: 'name',
  'org name': 'name',
};

export const DEFAULT_BUSINESS_COLUMN_MAP: CsvColumnMap<BusinessRecord> = {
  organizationname: 'organization_name',
  organization_name: 'organization_name',
  'organization name': 'organization_name',

  name: 'name',
  businessname: 'name',
  business_name: 'name',
  'business name': 'name',

  description: 'description',
  phone: 'phone',
  tagline: 'tagline',

  donotdisplayonheader: 'do_not_display_on_header',
  do_not_display_on_header: 'do_not_display_on_header',
  'do not display on header': 'do_not_display_on_header',
  'do not display on the header': 'do_not_display_on_header',

  addressline1: 'address_line1',
  address_line1: 'address_line1',
  'address line 1': 'address_line1',
  'address line1': 'address_line1',
  address1: 'address_line1',

  addressline2: 'address_line2',
  address_line2: 'address_line2',
  'address line 2': 'address_line2',
  'address line2': 'address_line2',
  address2: 'address_line2',

  city: 'city',
  state: 'state',

  zipcode: 'zipcode',
  zip: 'zipcode',
  zip_code: 'zipcode',
  'zip code': 'zipcode',

  country: 'country',

  // Template-style fee headers
  'platform service fee (paid by client) - mode': 'platform_fee_client_mode',
  'platform service fee (paid by client) mode': 'platform_fee_client_mode',
  platformservicefeeclientmode: 'platform_fee_client_mode',
  platformservicefeeclient_mode: 'platform_fee_client_mode',
  platformfeeclientmode: 'platform_fee_client_mode',
  platformfeeclient_mode: 'platform_fee_client_mode',
  platform_fee_client_mode: 'platform_fee_client_mode',
  'platform service fee (paid by client) - amount': 'platform_fee_client_amount',
  'platform service fee (paid by client) amount': 'platform_fee_client_amount',
  platformservicefeeclientamount: 'platform_fee_client_amount',
  platformfeeclientamount: 'platform_fee_client_amount',
  platform_fee_client_amount: 'platform_fee_client_amount',

  'platform service fee (charged from business commission) - mode': 'platform_fee_commission_mode',
  'platform service fee (charged from business commission) mode': 'platform_fee_commission_mode',
  platformservicefeecommissionmode: 'platform_fee_commission_mode',
  platformfeecommissionmode: 'platform_fee_commission_mode',
  platform_fee_commission_mode: 'platform_fee_commission_mode',

  'platform service fee (charged from business commission) - amount': 'platform_fee_commission_amount',
  'platform service fee (charged from business commission) amount': 'platform_fee_commission_amount',
  platformservicefeecommissionamount: 'platform_fee_commission_amount',
  platformfeecommissionamount: 'platform_fee_commission_amount',
  platform_fee_commission_amount: 'platform_fee_commission_amount',
};

export const DEFAULT_LOCATION_COLUMN_MAP: CsvColumnMap<BusinessLocationRecord> = {
  businessname: 'business_name',
  business_name: 'business_name',
  'business name': 'business_name',

  name: 'name',
  locationname: 'name',
  location_name: 'name',
  'location name': 'name',

  phone: 'phone',

  operationtype: 'operation_type',
  operation_type: 'operation_type',
  'operation type': 'operation_type',

  serviceablestates: 'serviceable_states',
  serviceable_states: 'serviceable_states',
  'serviceable states': 'serviceable_states',

  addressline1: 'address_line1',
  address_line1: 'address_line1',
  'address line 1': 'address_line1',
  'address line1': 'address_line1',
  address1: 'address_line1',

  addressline2: 'address_line2',
  address_line2: 'address_line2',
  'address line 2': 'address_line2',
  'address line2': 'address_line2',
  address2: 'address_line2',

  city: 'city',
  state: 'state',

  zipcode: 'zipcode',
  zip: 'zipcode',
  zip_code: 'zipcode',
  'zip code': 'zipcode',

  country: 'country',
};
