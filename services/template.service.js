const supabase = require('../config/supabase');

const ALLOWED_TAGS = new Set(['{{contactName}}', '{{appointmentDate}}', '{{notes}}']);

/**
 * Returns the hardcoded default email template.
 */
const getDefaults = () => ({
  subject:  'Appointment Reminder — {{appointmentDate}}',
  greeting: 'Hi {{contactName}},',
  body:     'This is a reminder for your upcoming appointment scheduled on {{appointmentDate}}.\n{{notes}}',
  closing:  'If you need to reschedule, please reply to this email.',
});

/**
 * Fetches the email template for a given tenant from Supabase.
 * Returns the row { subject, greeting, body, closing } or null if not found.
 */
const getByTenant = async (tenantId) => {
  const { data, error } = await supabase
    .from('email_templates')
    .select('subject, greeting, body, closing')
    .eq('tenant_id', tenantId)
    .single();

  if (error) {
    // PGRST116 = "no rows returned" — treat as not found
    if (error.code === 'PGRST116') return null;
    // PGRST205 = table not in schema cache (table doesn't exist yet) — fall back to defaults
    if (error.code === 'PGRST205') return null;
    throw error;
  }

  return data;
};

/**
 * Upserts an email template row for the given tenant.
 * Returns the saved row.
 */
const upsert = async (tenantId, fields) => {
  const { data, error } = await supabase
    .from('email_templates')
    .upsert(
      { tenant_id: tenantId, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id' }
    )
    .select()
    .single();

  if (error) {
    // PGRST205 = table doesn't exist yet — return the fields as-is so the UI doesn't break
    if (error.code === 'PGRST205') return { tenant_id: tenantId, ...fields };
    throw error;
  }
  return data;
};

/**
 * Replaces merge tags in each field of the template with values from context.
 * Unknown/missing context values are replaced with an empty string.
 */
const renderTemplate = (fields, context) => {
  const safeContext = {
    contactName:     context.contactName     ?? '',
    appointmentDate: context.appointmentDate ?? '',
    notes:           context.notes           ?? '',
  };

  const replace = (text) =>
    text
      .replace(/\{\{contactName\}\}/g,     () => safeContext.contactName)
      .replace(/\{\{appointmentDate\}\}/g, () => safeContext.appointmentDate)
      .replace(/\{\{notes\}\}/g,           () => safeContext.notes);

  return {
    subject:  replace(fields.subject  ?? ''),
    greeting: replace(fields.greeting ?? ''),
    body:     replace(fields.body     ?? ''),
    closing:  replace(fields.closing  ?? ''),
  };
};

/**
 * Finds all {{...}} tags in text that are not in the allowed set.
 * Returns an array of unrecognised tag strings.
 */
const validateMergeTags = (text) => {
  const found = text.match(/\{\{[^}]+\}\}/g) ?? [];
  return found.filter((tag) => !ALLOWED_TAGS.has(tag));
};

module.exports = { getDefaults, getByTenant, upsert, renderTemplate, validateMergeTags };
