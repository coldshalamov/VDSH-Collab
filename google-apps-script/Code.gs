/**
 * VSDH Onboarding — Google Apps Script Backend
 *
 * Setup:
 *   1. Create a Google Sheet
 *   2. Extensions > Apps Script > paste this code
 *   3. Set script property: ADMIN_KEY (Project Settings > Script Properties)
 *   4. Deploy > New deployment > Web app > Execute as Me, Anyone can access
 *   5. Copy the /exec URL into your admin.html and onboard.html config
 *
 * All operations use POST to keep credentials out of URLs/logs.
 */

var INVITE_EXPIRY_DAYS = 30;

var INVITE_HEADERS = ['Token','Email','BusinessName','Status','CreatedAt','ExpiresAt','CompletedAt','InviteLink'];

// 3-tier onboarding sheets (matches PLAN.md)
var ORG_HEADERS = ['Timestamp','Token','name'];

var BIZ_HEADERS = ['Timestamp','Token','OrganizationName','name','Description','Phone',
  'Tagline','DoNotDisplayOnHeader','AddressLine1','AddressLine2','City','State',
  'Zipcode','Country','PlatformFeeClientMode','PlatformFeeClientAmount',
  'PlatformFeeCommissionMode','PlatformFeeCommissionAmount'];

var LOC_HEADERS = ['Timestamp','Token','BusinessName','Name','Phone','OperationType',
  'ServiceableStates','AddressLine1','AddressLine2','City','State','Zipcode','Country'];
var US_STATE_CODES = {
  AL: true, AK: true, AZ: true, AR: true, CA: true, CO: true, CT: true, DE: true, DC: true,
  FL: true, GA: true, HI: true, ID: true, IL: true, IN: true, IA: true, KS: true, KY: true,
  LA: true, ME: true, MD: true, MA: true, MI: true, MN: true, MS: true, MO: true, MT: true,
  NE: true, NV: true, NH: true, NJ: true, NM: true, NY: true, NC: true, ND: true, OH: true,
  OK: true, OR: true, PA: true, RI: true, SC: true, SD: true, TN: true, TX: true, UT: true,
  VT: true, VA: true, WA: true, WV: true, WI: true, WY: true
};

// ── Routing ─────────────────────────────────────────────

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    switch (data.action) {
      case 'create_invites':    return requireAdmin(data, createInvites);
      case 'send_emails':       return requireAdmin(data, sendInviteEmails);
      case 'list_invites':      return requireAdmin(data, function() { return listInvites(); });
      case 'stats':             return requireAdmin(data, function() { return getStats(); });
      case 'export_onboarding_csvs': return requireAdmin(data, function() { return exportOnboardingCsvs(); });
      case 'validate_token':    return ok(validateToken(data.token));
      case 'submit_onboarding': return ok(submitOnboarding(data));
      default: return err('Unknown action');
    }
  } catch (ex) {
    return err(ex.message);
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Auth ────────────────────────────────────────────────

function getAdminKey() {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!key) throw new Error('ADMIN_KEY script property is not configured');
  return key;
}

function requireAdmin(data, fn) {
  if (data.admin_key !== getAdminKey()) return err('Unauthorized');
  return ok(fn(data));
}

// ── Sanitization ────────────────────────────────────────

function sanitize(val) {
  var s = String(val || '');
  // Prevent Google Sheets formula injection
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHtml(val) {
  var s = String(val || '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeInviteStatus(status, expiresAt) {
  var normalized = String(status || 'pending');
  var expires = new Date(expiresAt || '');
  if (normalized !== 'completed' && !isNaN(expires.getTime()) && expires < new Date()) return 'expired';
  return normalized;
}

function findLatestInviteByEmail(rows, email) {
  var wanted = String(email || '').trim().toLowerCase();
  for (var r = rows.length - 1; r >= 1; r--) {
    var rowEmail = String(rows[r][1] || '').trim().toLowerCase();
    if (rowEmail !== wanted) continue;
    return {
      token: rows[r][0],
      email: rows[r][1],
      business_name: rows[r][2],
      status: normalizeInviteStatus(rows[r][3], rows[r][5]),
      created_at: rows[r][4],
      expires_at: rows[r][5],
      completed_at: rows[r][6],
      link: rows[r][7]
    };
  }
  return null;
}

function normalizeStateCode(state) {
  return String(state || '').trim().toUpperCase();
}

function normalizePhoneE164(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits[0] === '1') return '+' + digits;
  if (digits.length >= 11 && digits.length <= 15) return '+' + digits;

  return '';
}

function normalizeCountry(country) {
  var c = String(country || '').trim();
  return c ? c : 'USA';
}

function normalizeFeeMode(mode) {
  var m = String(mode || '').trim().toUpperCase();
  if (!m) return '';
  if (m !== 'FIXED' && m !== 'PERCENTAGE') return '';
  return m;
}

function normalizeFeeAmount(amount) {
  var raw = String(amount || '').trim();
  if (!raw) return '';
  var num = Number(raw);
  if (!isFinite(num)) return '';
  return num.toFixed(2);
}

function parseTrueFalse(value) {
  if (value === true) return true;
  if (value === false) return false;
  var s = String(value || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === '1') return true;
  if (s === '0') return false;
  if (s === 'yes') return true;
  if (s === 'no') return false;
  return null;
}

function normalizeServiceableStates(value) {
  var raw = String(value || '').trim();
  if (!raw) return '';

  var hasBraces = raw[0] === '{' && raw[raw.length - 1] === '}';
  var inner = hasBraces ? raw.slice(1, -1) : raw;
  var parts = inner.split(',').map(function(p) { return normalizeStateCode(p); }).filter(Boolean);
  if (!parts.length) return '';

  for (var i = 0; i < parts.length; i++) {
    var code = parts[i];
    if (!/^[A-Z]{2}$/.test(code)) return '';
    if (!US_STATE_CODES[code]) return '';
  }

  return '{' + parts.join(',') + '}';
}

function validateFeePair(modeValue, amountValue, label) {
  var modeRaw = String(modeValue || '').trim();
  var amountRaw = String(amountValue || '').trim();
  if (!modeRaw && !amountRaw) return '';

  var mode = normalizeFeeMode(modeRaw);
  if (!mode) return label + ' mode must be FIXED or PERCENTAGE';

  var amt = normalizeFeeAmount(amountRaw);
  if (!amt) return label + ' amount must be numeric (2 decimals)';

  return '';
}

function validateOnboardingFields(fields) {
  var f = fields || {};
  var org = f.organization || {};
  var biz = f.business || {};
  var loc = f.location || {};

  var orgName = String(org.name || '').trim();
  if (!orgName) return 'Organization name is required';

  var bizName = String(biz.name || '').trim();
  if (!bizName) return 'Business name is required';

  var bizOrgName = String(biz.organization_name || '').trim();
  if (bizOrgName && bizOrgName !== orgName) return 'OrganizationName must match Organization name';

  var bizPhone = normalizePhoneE164(biz.phone || '');
  if (!bizPhone) return 'Valid business phone required (E.164)';

  if (!String(biz.address_line1 || '').trim()) return 'Business address is required';
  if (!String(biz.city || '').trim()) return 'Business city is required';

  var bizState = normalizeStateCode(biz.state);
  if (!bizState) return 'Business state is required';
  if (!US_STATE_CODES[bizState]) return 'Valid business state is required';

  var bizZip = String(biz.zipcode || '').trim();
  if (!/^\d{5}(-\d{4})?$/.test(bizZip)) return 'Valid business ZIP code required';

  var feeClientErr = validateFeePair(biz.platform_fee_client_mode, biz.platform_fee_client_amount, 'Platform fee (paid by client)');
  if (feeClientErr) return feeClientErr;

  var feeCommErr = validateFeePair(biz.platform_fee_commission_mode, biz.platform_fee_commission_amount, 'Platform fee (charged from business commission)');
  if (feeCommErr) return feeCommErr;

  var locBizName = String(loc.business_name || '').trim();
  if (locBizName && locBizName !== bizName) return 'BusinessName must match Business name';

  var locName = String(loc.name || '').trim();
  if (!locName) return 'Location name is required';

  var locPhone = normalizePhoneE164(loc.phone || '');
  if (!locPhone) return 'Valid location phone required (E.164)';

  if (!String(loc.address_line1 || '').trim()) return 'Location address is required';
  if (!String(loc.city || '').trim()) return 'Location city is required';

  var locState = normalizeStateCode(loc.state);
  if (!locState) return 'Location state is required';
  if (!US_STATE_CODES[locState]) return 'Valid location state is required';

  var locZip = String(loc.zipcode || '').trim();
  if (!/^\d{5}(-\d{4})?$/.test(locZip)) return 'Valid location ZIP code required';

  var svc = String(loc.serviceable_states || '').trim();
  if (svc) {
    var normalizedSvc = normalizeServiceableStates(svc);
    if (!normalizedSvc) return 'ServiceableStates must be in {AZ,CA,GA} format';
  }

  var op = String(loc.operation_type || '').trim();
  if (op && op !== 'Virtual' && op !== 'Physical' && op !== 'Hybrid') {
    return 'OperationType must be Virtual, Physical, or Hybrid';
  }

  // Boolean parsing for DoNotDisplayOnHeader if present
  if (biz.do_not_display_on_header !== undefined) {
    var b = parseTrueFalse(biz.do_not_display_on_header);
    if (b === null) return 'DoNotDisplayOnHeader must be True or False';
  }

  return '';
}

// ── Invite Creation ─────────────────────────────────────

function createInvites(data) {
  var sheet = getOrCreateSheet('Invites', INVITE_HEADERS);
  var baseUrl = String(data.base_url || '').trim();
  if (!baseUrl) throw new Error('base_url is required (onboard.html URL)');
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('base_url must start with http:// or https://');
  if (/[?&]token=/.test(baseUrl)) throw new Error('base_url must not already include a token= query param');
  var invites = data.invites || [];
  var results = [];
  var rows = sheet.getDataRange().getValues();

  for (var i = 0; i < invites.length; i++) {
    var inv = invites[i];
    var email = (inv.email || '').trim();
    var biz = (inv.business_name || '').trim();

    if (!isValidEmail(email)) {
      results.push({ email: email, status: 'skipped', reason: 'Invalid email' });
      continue;
    }

    var existing = findLatestInviteByEmail(rows, email);
    if (existing) {
      if (existing.status === 'completed') {
        results.push({ email: email, business_name: existing.business_name || biz, status: 'skipped', reason: 'Already submitted' });
        continue;
      }
      if (existing.status === 'pending' || existing.status === 'emailed') {
        results.push({
          email: email,
          business_name: existing.business_name || biz,
          token: existing.token,
          link: existing.link,
          status: 'existing',
          reason: 'Existing active invite reused'
        });
        continue;
      }
    }

    var token = Utilities.getUuid();
    var now = new Date();
    var expires = new Date(now.getTime() + INVITE_EXPIRY_DAYS * 86400000);
    var joiner = baseUrl.indexOf('?') === -1 ? '?' : '&';
    var link = baseUrl + joiner + 'token=' + encodeURIComponent(token);
    var row = [
      token, sanitize(email), sanitize(biz), 'pending',
      now.toISOString(), expires.toISOString(), '', link
    ];

    sheet.appendRow(row);
    rows.push(row);

    results.push({ email: email, business_name: biz, token: token, link: link, status: 'created' });
  }

  return { results: results, created: results.filter(function(r) { return r.status === 'created'; }).length };
}

// ── Email Sending ───────────────────────────────────────

function sendInviteEmails(data) {
  var tokens = data.tokens || [];
  var sheet = getOrCreateSheet('Invites', INVITE_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var sent = 0;
  var failed = 0;
  var failedDetails = [];

  // Check quota upfront
  var remaining = MailApp.getRemainingDailyQuota();
  if (remaining < 1) {
    return { sent: 0, failed: tokens.length, error: 'Daily email quota exhausted (' + remaining + ' remaining)' };
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { sent: 0, failed: tokens.length, error: 'Server busy, try again' };

  try {
    for (var i = 0; i < tokens.length; i++) {
      if (MailApp.getRemainingDailyQuota() < 1) {
        failedDetails.push({ token: tokens[i], error: 'Quota exhausted' });
        failed++;
        continue;
      }

      var matched = false;
      for (var r = 1; r < rows.length; r++) {
        if (rows[r][0] === tokens[i]) {
          matched = true;

          var status = String(rows[r][3] || '');
          var expires = new Date(rows[r][5]);

          if (status !== 'pending') {
            failedDetails.push({ token: tokens[i], error: 'Invite is not pending (status=' + status + ')' });
            failed++;
            break;
          }

          if (!isNaN(expires.getTime()) && expires < new Date()) {
            failedDetails.push({ token: tokens[i], error: 'Invite is expired' });
            failed++;
            break;
          }

          try {
            sendOneInviteEmail(rows[r][1], rows[r][2], rows[r][7]);
            sheet.getRange(r + 1, 4).setValue('emailed');
            rows[r][3] = 'emailed';
            sent++;
          } catch (ex) {
            failedDetails.push({ token: tokens[i], error: ex.message });
            failed++;
          }
          break;
        }
      }

      if (!matched) {
        failedDetails.push({ token: tokens[i], error: 'Token not found' });
        failed++;
      }
    }
  } finally {
    lock.releaseLock();
  }

  return { sent: sent, failed: failed, details: failedDetails };
}

function sendOneInviteEmail(to, businessName, link) {
  if (!/^https?:\/\//.test(String(link || ''))) {
    throw new Error('Invite link must start with http:// or https://');
  }

  var safeLink = escapeHtml(link);
  var greeting = businessName ? 'Hello ' + businessName + ' team,' : 'Hello,';
  var plainText = greeting + '\n\n'
    + 'You\'ve been invited to set up your business on the VS Digital Health platform.\n\n'
    + 'Complete onboarding: ' + link + '\n\n'
    + 'This link expires in ' + INVITE_EXPIRY_DAYS + ' days.\n\n'
    + 'Powered by VS Digital Health';
  var html = '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#1A1A17;">'
    + '<h1 style="color:#1B4D3E;font-size:22px;margin:0 0 24px;">Business Onboarding</h1>'
    + '<p>' + escapeHtml(greeting) + '</p>'
    + '<p style="margin:16px 0;">You\'ve been invited to set up your business on the VS Digital Health platform.</p>'
    + '<div style="text-align:center;margin:32px 0;">'
    + '<a href="' + safeLink + '" style="background:#1B4D3E;color:#fff;padding:14px 36px;text-decoration:none;border-radius:8px;font-weight:600;display:inline-block;">Complete Onboarding</a>'
    + '</div>'
    + '<p style="font-size:13px;color:#6B6B63;">If the button doesn\'t work, copy this link:<br><a href="' + safeLink + '" style="color:#1B4D3E;word-break:break-all;">' + safeLink + '</a></p>'
    + '<p style="font-size:13px;color:#9C9C93;margin-top:24px;">This link expires in ' + INVITE_EXPIRY_DAYS + ' days.</p>'
    + '<hr style="border:none;border-top:1px solid #E5E2DC;margin:24px 0;">'
    + '<p style="font-size:11px;color:#9C9C93;text-align:center;">Powered by VS Digital Health</p>'
    + '</div>';

  MailApp.sendEmail({
    to: to,
    subject: "You're Invited - Complete Your Business Onboarding",
    body: plainText,
    htmlBody: html
  });
}

// ── Token Validation ────────────────────────────────────

function validateToken(token) {
  if (!token) return { valid: false, reason: 'Missing token' };

  var sheet = getOrCreateSheet('Invites', INVITE_HEADERS);
  var rows = sheet.getDataRange().getValues();

  for (var r = 1; r < rows.length; r++) {
    if (rows[r][0] === token) {
      var status = rows[r][3];
      var expires = new Date(rows[r][5]);

      if (status === 'completed') return { valid: false, reason: 'Already submitted' };
      if (expires < new Date()) return { valid: false, reason: 'Expired' };

      return {
        valid: true,
        invite: {
          email: rows[r][1],
          business_name: rows[r][2],
          status: status
        }
      };
    }
  }

  return { valid: false, reason: 'Invalid token' };
}

// ── Form Submission (with lock to prevent double-submit) ─

function submitOnboarding(data) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { submitted: false, reason: 'Server busy, please try again' };

  try {
    var token = data.token;
    var validation = validateToken(token);
    if (!validation.valid) return { submitted: false, reason: validation.reason };

    var f = data.fields || {};
    var validationError = validateOnboardingFields(f);
    if (validationError) return { submitted: false, reason: validationError };

    var org = f.organization || {};
    var biz = f.business || {};
    var loc = f.location || {};

    var orgName = String(org.name || '').trim();
    var bizName = String(biz.name || '').trim();

    // Fail closed: business name must match invite (if provided on invite)
    var invitedBizName = validation.invite && validation.invite.business_name ? String(validation.invite.business_name || '').trim() : '';
    if (invitedBizName && invitedBizName !== bizName) {
      return { submitted: false, reason: 'Business name must match your invitation' };
    }

    var nowIso = new Date().toISOString();

    // Normalize values (store in sheet-friendly format)
    var bizPhone = normalizePhoneE164(biz.phone || '');
    var locPhone = normalizePhoneE164(loc.phone || '');

    var doNotDisplay = parseTrueFalse(biz.do_not_display_on_header);
    var doNotDisplayStr = doNotDisplay === true ? 'True' : 'False';

    var bizCountry = normalizeCountry(biz.country);
    var locCountry = normalizeCountry(loc.country);

    var bizState = normalizeStateCode(biz.state);
    var locState = normalizeStateCode(loc.state);

    var feeClientMode = normalizeFeeMode(biz.platform_fee_client_mode);
    var feeClientAmount = normalizeFeeAmount(biz.platform_fee_client_amount);
    var feeCommMode = normalizeFeeMode(biz.platform_fee_commission_mode);
    var feeCommAmount = normalizeFeeAmount(biz.platform_fee_commission_amount);

    var locOperationType = String(loc.operation_type || 'Virtual').trim() || 'Virtual';
    var locServiceableStates = normalizeServiceableStates(loc.serviceable_states);

    // Write to 3 sheets (token ties them together)
    // Idempotent under retries/crashes: if a row for this token already exists, do not append a duplicate.
    var orgSheet = getOrCreateSheet('Organizations', ORG_HEADERS);
    if (!sheetHasTokenRow_(orgSheet, token)) {
      orgSheet.appendRow([nowIso, token, sanitize(orgName)]);
    }

    var bizSheet = getOrCreateSheet('Businesses', BIZ_HEADERS);
    if (!sheetHasTokenRow_(bizSheet, token)) {
      bizSheet.appendRow([
        nowIso, token,
        sanitize(orgName), sanitize(bizName),
        sanitize(biz.description || ''), sanitize(bizPhone),
        sanitize(biz.tagline || ''), sanitize(doNotDisplayStr),
        sanitize(biz.address_line1 || ''), sanitize(biz.address_line2 || ''),
        sanitize(biz.city || ''), sanitize(bizState || ''), sanitize(biz.zipcode || ''),
        sanitize(bizCountry),
        sanitize(feeClientMode || ''), sanitize(feeClientAmount || ''),
        sanitize(feeCommMode || ''), sanitize(feeCommAmount || '')
      ]);
    }

    var locSheet = getOrCreateSheet('BusinessLocations', LOC_HEADERS);
    if (!sheetHasTokenRow_(locSheet, token)) {
      locSheet.appendRow([
        nowIso, token,
        sanitize(bizName), sanitize(loc.name || ''),
        sanitize(locPhone), sanitize(locOperationType),
        sanitize(locServiceableStates || ''),
        sanitize(loc.address_line1 || ''), sanitize(loc.address_line2 || ''),
        sanitize(loc.city || ''), sanitize(locState || ''), sanitize(loc.zipcode || ''),
        sanitize(locCountry)
      ]);
    }

    // Mark invite as completed
    var inviteSheet = getOrCreateSheet('Invites', INVITE_HEADERS);
    var rows = inviteSheet.getDataRange().getValues();
    for (var r = 1; r < rows.length; r++) {
      if (rows[r][0] === token) {
        inviteSheet.getRange(r + 1, 4).setValue('completed');
        inviteSheet.getRange(r + 1, 7).setValue(new Date().toISOString());
        break;
      }
    }

    return { submitted: true };
  } finally {
    lock.releaseLock();
  }
}

// ── Admin Reads ─────────────────────────────────────────

function listInvites() {
  var sheet = getOrCreateSheet('Invites', INVITE_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var invites = [];

  for (var r = 1; r < rows.length; r++) {
    var expires = new Date(rows[r][5]);
    var status = rows[r][3];
    if (status !== 'completed' && expires < new Date()) status = 'expired';

    invites.push({
      token: rows[r][0],
      email: rows[r][1],
      business_name: rows[r][2],
      status: status,
      created_at: rows[r][4],
      expires_at: rows[r][5],
      completed_at: rows[r][6],
      link: rows[r][7]
    });
  }

  return { invites: invites };
}

function getStats() {
  var sheet = getOrCreateSheet('Invites', INVITE_HEADERS);
  var rows = sheet.getDataRange().getValues();
  var stats = { total: 0, pending: 0, emailed: 0, completed: 0, expired: 0 };

  for (var r = 1; r < rows.length; r++) {
    stats.total++;
    var status = rows[r][3];
    var expires = new Date(rows[r][5]);
    if (status === 'completed') stats.completed++;
    else if (expires < new Date()) stats.expired++;
    else if (status === 'emailed') stats.emailed++;
    else stats.pending++;
  }

  return stats;
}

// ── Onboarding Export (Admin) ──────────────────────────────────────────────

function escapeCsvField(value) {
  var s = String(value || '');
  if (!s) return '';
  // Prevent CSV/Sheets formula injection (=, +, -, @, tab, CR can trigger formulas)
  if (/^[=+\-@\t\r]/.test(s)) {
    // E.164 phone numbers legitimately start with "+", and we do not want to mutate them.
    var isE164Phone = /^\+\d{8,15}$/.test(s);
    if (!isE164Phone) s = "'" + s;
  }
  if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function buildCsv(headers, rows) {
  var lines = [];
  lines.push(headers.map(function(h) { return escapeCsvField(h); }).join(','));
  for (var i = 0; i < rows.length; i++) {
    var line = [];
    for (var c = 0; c < headers.length; c++) {
      line.push(escapeCsvField(rows[i][c]));
    }
    lines.push(line.join(','));
  }
  return lines.join('\r\n');
}

function exportOnboardingCsvs() {
  var orgSheet = getOrCreateSheet('Organizations', ORG_HEADERS);
  var bizSheet = getOrCreateSheet('Businesses', BIZ_HEADERS);
  var locSheet = getOrCreateSheet('BusinessLocations', LOC_HEADERS);

  var orgRows = orgSheet.getDataRange().getValues();
  var bizRows = bizSheet.getDataRange().getValues();
  var locRows = locSheet.getDataRange().getValues();

  // Organizations export: just "name"
  var orgExportRows = [];
  var orgSeen = {};
  for (var r = 1; r < orgRows.length; r++) {
    var name = String(orgRows[r][2] || '').trim();
    if (!name) continue;
    var key = name.toLowerCase();
    if (orgSeen[key]) continue;
    orgSeen[key] = true;
    orgExportRows.push([name]);
  }

  // Businesses export: template headers (long form)
  var bizExportHeaders = [
    'OrganizationName',
    'name',
    'Description',
    'Phone',
    'Tagline',
    'Do not display on the header',
    'AddressLine1',
    'AddressLine2',
    'City',
    'State',
    'Zipcode',
    'Country',
    'Platform service fee (paid by client) - Mode',
    'Platform service fee (paid by client) - Amount',
    'Platform service fee (Charged from business commission) - Mode',
    'Platform service fee (Charged from business commission) - Amount'
  ];

  var bizExportRows = [];
  for (var b = 1; b < bizRows.length; b++) {
    // BIZ_HEADERS: [Timestamp,Token,OrganizationName,name,Description,Phone,Tagline,DoNotDisplayOnHeader,AddressLine1,AddressLine2,City,State,Zipcode,Country,PlatformFeeClientMode,PlatformFeeClientAmount,PlatformFeeCommissionMode,PlatformFeeCommissionAmount]
    bizExportRows.push([
      bizRows[b][2] || '',
      bizRows[b][3] || '',
      bizRows[b][4] || '',
      bizRows[b][5] || '',
      bizRows[b][6] || '',
      bizRows[b][7] || '',
      bizRows[b][8] || '',
      bizRows[b][9] || '',
      bizRows[b][10] || '',
      bizRows[b][11] || '',
      bizRows[b][12] || '',
      bizRows[b][13] || '',
      bizRows[b][14] || '',
      bizRows[b][15] || '',
      bizRows[b][16] || '',
      bizRows[b][17] || ''
    ]);
  }

  // Locations export
  var locExportHeaders = [
    'BusinessName',
    'Name',
    'Phone',
    'OperationType',
    'ServiceableStates',
    'AddressLine1',
    'AddressLine2',
    'City',
    'State',
    'Zipcode',
    'Country'
  ];

  var locExportRows = [];
  for (var l = 1; l < locRows.length; l++) {
    // LOC_HEADERS: [Timestamp,Token,BusinessName,Name,Phone,OperationType,ServiceableStates,AddressLine1,AddressLine2,City,State,Zipcode,Country]
    locExportRows.push([
      locRows[l][2] || '',
      locRows[l][3] || '',
      locRows[l][4] || '',
      locRows[l][5] || '',
      locRows[l][6] || '',
      locRows[l][7] || '',
      locRows[l][8] || '',
      locRows[l][9] || '',
      locRows[l][10] || '',
      locRows[l][11] || '',
      locRows[l][12] || ''
    ]);
  }

  return {
    counts: {
      organizations: orgExportRows.length,
      businesses: bizExportRows.length,
      locations: locExportRows.length
    },
    organization: buildCsv(['name'], orgExportRows),
    business: buildCsv(bizExportHeaders, bizExportRows),
    location: buildCsv(locExportHeaders, locExportRows)
  };
}

// ── Helpers ─────────────────────────────────────────────

function getOrCreateSheet(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('No active spreadsheet (expected container-bound Apps Script)');

  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);

  // If the sheet exists but has no rows yet, add header row.
  if (headers && headers.length && sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

function sheetHasTokenRow_(sheet, token) {
  var wanted = String(token || '');
  if (!wanted) return false;

  // For all onboarding sheets in this project, "Token" is column 2 (0-based index 1).
  var tokenColIndex = 1;
  var rows = sheet.getDataRange().getValues();
  for (var r = 1; r < rows.length; r++) {
    if (String(rows[r][tokenColIndex] || '') === wanted) return true;
  }
  return false;
}

function ok(data) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success', data: data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(message) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'error', message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
