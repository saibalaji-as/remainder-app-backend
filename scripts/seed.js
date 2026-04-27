require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabase');

// ─── Helpers ────────────────────────────────────────────────────────────────

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function hoursOffset(isoDate, hours) {
  return new Date(new Date(isoDate).getTime() + hours * 60 * 60 * 1000).toISOString();
}

function minutesOffset(isoDate, minutes) {
  return new Date(new Date(isoDate).getTime() + minutes * 60 * 1000).toISOString();
}

async function query(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`[${label}] ${error.message}`);
  return data;
}

// ─── Clear ───────────────────────────────────────────────────────────────────

async function clearSeedData() {
  const tables = ['reminders', 'appointments', 'contacts', 'subscriptions', 'users', 'tenants'];
  for (const table of tables) {
    await query(`clear:${table}`, supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000'));
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Starting seed...\n');

  await clearSeedData();

  // 1. TENANT
  const [tenant] = await query('tenants', supabase
    .from('tenants')
    .insert({ name: 'SmileCare Dental Clinic', email: 'admin@smilecare.com', plan: 'basic' })
    .select()
  );
  console.log('✅ Tenant created:', tenant.name);

  // 2. USERS
  const passwordHash = await bcrypt.hash('Password@123', 10);
  const users = await query('users', supabase
    .from('users')
    .insert([
      { tenant_id: tenant.id, name: 'Dr. Priya Sharma', email: 'priya@smilecare.com', password_hash: passwordHash, role: 'owner' },
      { tenant_id: tenant.id, name: 'Ravi Kumar',       email: 'ravi@smilecare.com',  password_hash: passwordHash, role: 'staff' },
    ])
    .select()
  );
  console.log('✅ Users created:', users.length);

  // 3. CONTACTS
  const contacts = await query('contacts', supabase
    .from('contacts')
    .insert([
      { tenant_id: tenant.id, name: 'Arjun Mehta',     phone: '+918667205872', email: 'arjun@example.com'   },
      { tenant_id: tenant.id, name: 'Sneha Patel',     phone: '+918667205872', email: 'sneha@example.com'   },
      { tenant_id: tenant.id, name: 'Karthik Rajan',   phone: '+918667205872', email: 'karthik@example.com' },
      { tenant_id: tenant.id, name: 'Divya Nair',      phone: '+918667205872', email: 'divya@example.com'   },
      { tenant_id: tenant.id, name: 'Mohammed Farhan', phone: '+918667205872', email: 'farhan@example.com'  },
    ])
    .select()
  );
  console.log('✅ Contacts created:', contacts.length);

  // 4. APPOINTMENTS
  // Spread 10 appointments across 5 contacts (2 each, cycling)
  const appointmentRows = [
    // 4 upcoming — scheduled
    { contact_id: contacts[0].id, scheduled_at: daysFromNow(1), status: 'scheduled',  notes: 'Root canal follow-up'       },
    { contact_id: contacts[1].id, scheduled_at: daysFromNow(3), status: 'scheduled',  notes: 'Routine cleaning'            },
    { contact_id: contacts[2].id, scheduled_at: daysFromNow(5), status: 'scheduled',  notes: 'Braces adjustment'           },
    { contact_id: contacts[3].id, scheduled_at: daysFromNow(7), status: 'scheduled',  notes: 'Wisdom tooth consultation'   },
    // 3 completed — past
    { contact_id: contacts[4].id, scheduled_at: daysFromNow(-2), status: 'completed', notes: 'Teeth whitening session'     },
    { contact_id: contacts[0].id, scheduled_at: daysFromNow(-4), status: 'completed', notes: 'Cavity filling'              },
    { contact_id: contacts[1].id, scheduled_at: daysFromNow(-6), status: 'completed', notes: 'Dental X-ray'                },
    // 2 confirmed — upcoming
    { contact_id: contacts[2].id, scheduled_at: daysFromNow(1), status: 'confirmed',  notes: 'Crown fitting'               },
    { contact_id: contacts[3].id, scheduled_at: daysFromNow(2), status: 'confirmed',  notes: 'Post-surgery check-up'       },
    // 1 cancelled
    { contact_id: contacts[4].id, scheduled_at: daysFromNow(-1), status: 'cancelled', notes: 'Patient rescheduled'         },
  ].map(row => ({ ...row, tenant_id: tenant.id }));

  const appointments = await query('appointments', supabase
    .from('appointments')
    .insert(appointmentRows)
    .select()
  );
  console.log('✅ Appointments created:', appointments.length);

  // 5. REMINDERS — 3 per appointment
  const isPast = (isoDate) => new Date(isoDate) < new Date();

  const reminderRows = appointments.flatMap((appt) => {
    const past = isPast(appt.scheduled_at);
    const sentAt = past ? minutesOffset(appt.scheduled_at, -10) : null;

    return [
      {
        appointment_id: appt.id,
        scheduled_at:   hoursOffset(appt.scheduled_at, -24),
        channel:        'sms',
        status:         past ? 'sent' : 'pending',
        sent_at:        past ? sentAt : null,
      },
      {
        appointment_id: appt.id,
        scheduled_at:   hoursOffset(appt.scheduled_at, -2),
        channel:        'sms',
        status:         past ? 'sent' : 'pending',
        sent_at:        past ? sentAt : null,
      },
      {
        appointment_id: appt.id,
        scheduled_at:   minutesOffset(appt.scheduled_at, -30),
        channel:        'email',
        status:         past ? 'sent' : 'pending',
        sent_at:        past ? sentAt : null,
      },
    ];
  });

  const reminders = await query('reminders', supabase
    .from('reminders')
    .insert(reminderRows)
    .select()
  );
  console.log('✅ Reminders created:', reminders.length);

  // 6. SUBSCRIPTION
  await query('subscriptions', supabase
    .from('subscriptions')
    .insert({
      tenant_id:   tenant.id,
      plan:        'basic',
      sms_credits: 200,
      status:      'active',
      renews_at:   daysFromNow(30),
    })
    .select()
  );
  console.log('✅ Subscription created');

  console.log('\n🎉 Seed complete!');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
