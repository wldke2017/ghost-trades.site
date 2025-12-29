# Security Policy

## 🔒 Security Best Practices

### Critical Security Measures

1. **JWT Secret**
   - Use a strong, random string of at least 32 characters
   - Never commit the actual secret to version control
   - Rotate secrets periodically

2. **Admin Password**
   - Change the default admin password immediately after deployment
   - Use a strong password with mix of characters, numbers, and symbols
   - Enable 2FA for admin accounts in production

3. **Database Security**
   - Use strong database passwords
   - Restrict database access to application servers only
   - Enable SSL/TLS for database connections
   - Regular backups with encryption

4. **API Security**
   - All endpoints use HTTPS in production
   - Rate limiting is enabled on all routes
   - Input validation on all endpoints
   - CORS configured for specific origins only

5. **M-Pesa Integration**
   - Never expose real credentials in code or .env.example
   - Use environment variables for all sensitive data
   - Verify callback signatures
   - Implement idempotency for callback processing

6. **File Uploads**
   - File size limits enforced (5MB)
   - File type validation (server-side)
   - Stored outside webroot
   - Virus scanning recommended

### Environment Variables Security

Required secure environment variables:
- `JWT_SECRET` - Minimum 32 characters, random
- `DB_PASSWORD` - Strong database password
- `MPESA_CONSUMER_KEY` - From Safaricom
- `MPESA_CONSUMER_SECRET` - From Safaricom
- `MPESA_PASSKEY` - From Safaricom

### Production Checklist

- [ ] Changed default admin password
- [ ] Set strong JWT_SECRET (32+ characters)
- [ ] Database password is strong and unique
- [ ] SSL/TLS enabled for all connections
- [ ] CORS configured for production domain only
- [ ] Rate limiting enabled
- [ ] Helmet.js security headers enabled
- [ ] Environment variables set correctly
- [ ] M-Pesa credentials secured
- [ ] Database backups configured
- [ ] Error logging configured (without exposing sensitive data)
- [ ] Security headers verified
- [ ] Input validation on all endpoints
- [ ] SQL injection prevention verified
- [ ] XSS prevention verified

## Reporting Security Issues

If you discover a security vulnerability, please email: [security@yourdomain.com]

**Do not open public issues for security vulnerabilities.**

## Security Updates

We regularly update dependencies to patch security vulnerabilities. Run `npm audit` regularly to check for known vulnerabilities.

```bash
npm audit
npm audit fix
```

## Additional Recommendations

1. **Infrastructure**
   - Use a WAF (Web Application Firewall)
   - DDoS protection
   - Regular security audits
   - Penetration testing

2. **Monitoring**
   - Set up alerts for suspicious activities
   - Monitor failed login attempts
   - Track unusual transaction patterns
   - Log all admin actions

3. **Compliance**
   - Ensure GDPR compliance if handling EU users
   - Follow PCI DSS guidelines for payment processing
   - Maintain audit trails
   - Data retention policies

4. **Incident Response**
   - Have an incident response plan
   - Regular security drills
   - Contact information for security team
   - Backup and recovery procedures