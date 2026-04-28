const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY environment variable is not set');
}

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

module.exports = stripe;
