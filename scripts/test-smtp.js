/**
 * Quick SMTP connectivity test — run this on Render via:
 *   node scripts/test-smtp.js
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

async function main() {
  console.log('EMAIL_USER:', process.env.EMAIL_USER);
  console.log('EMAIL_APP_PASSWORD set:', !!process.env.EMAIL_APP_PASSWORD);

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASSWORD,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  console.log('Verifying SMTP connection...');
  try {
    await transporter.verify();
    console.log('✅ SMTP connection OK — credentials and port are working');
  } catch (err) {
    console.error('❌ SMTP verify failed:', err.message);
    console.error('   Code:', err.code);
    console.error('   Command:', err.command);
  }
}

main();
