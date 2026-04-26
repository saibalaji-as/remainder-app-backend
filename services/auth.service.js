const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

const SALT_ROUNDS = 10;

async function hashPassword(plain) {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

async function register({ name, email, password, tenantName }) {
  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .insert({ name: tenantName, email, plan: 'basic' })
    .select()
    .single();
  if (tenantError) throw tenantError;

  const passwordHash = await hashPassword(password);

  const { data: user, error: userError } = await supabase
    .from('users')
    .insert({ tenant_id: tenant.id, name, email, password_hash: passwordHash, role: 'owner' })
    .select()
    .single();
  if (userError) throw userError;

  const token = signToken({ userId: user.id, tenantId: tenant.id, email: user.email });
  return { token };
}

async function login({ email, password }) {
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  // PGRST116 = no rows found — treat as invalid credentials
  if (error && error.code !== 'PGRST116') throw error;

  if (!user) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const err = new Error('Invalid credentials');
    err.status = 401;
    throw err;
  }

  const token = signToken({ userId: user.id, tenantId: user.tenant_id, email: user.email });
  return { token };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, register, login };
