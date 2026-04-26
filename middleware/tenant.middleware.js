function tenantMiddleware(req, res, next) {
  req.tenantId = req.user.tenantId;
  next();
}

module.exports = tenantMiddleware;
