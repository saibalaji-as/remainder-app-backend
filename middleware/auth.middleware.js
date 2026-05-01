const authService = require('../services/auth.service');

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  // Also accept token as query param for SSE connections (EventSource doesn't support headers)
  const queryToken = req.query && req.query.token;

  let token;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (queryToken) {
    token = queryToken;
  } else {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }

  try {
    const decoded = authService.verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
