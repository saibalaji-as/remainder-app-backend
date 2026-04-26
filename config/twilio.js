const twilio = require('twilio');

let _client = null;

function getClient() {
  if (!_client) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }
    _client = twilio(sid, token);
  }
  return _client;
}

// Proxy so existing code using `client.messages.create(...)` still works
module.exports = new Proxy({}, {
  get(_, prop) {
    return getClient()[prop];
  }
});
