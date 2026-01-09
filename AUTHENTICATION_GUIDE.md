# Dual Authentication System

## Overview

This device tracker now supports **two authentication methods**:

1. **Email/Password Authentication** - Traditional username/password login
2. **Google OAuth** - Sign in with Google account

Users can choose either method based on their preference. Both methods work seamlessly with the web app and Android app.

## Why Email/Password Authentication?

### The Problem
Imagine you lost your phone and want to track it from a friend's device or a public computer. With only Google OAuth:
- You'd need to login to Google on that device
- This creates security concerns on untrusted devices
- Some users may not have Google accounts

### The Solution
With email/password authentication:
- ✅ **Quick Access**: Login with just email and password on any device
- ✅ **No Google Required**: Users without Google accounts can still use the service
- ✅ **Multi-Device Support**: Same credentials work everywhere
- ✅ **Lost Device Recovery**: Track your lost device from any browser or phone
- ✅ **Privacy**: Alternative for users who prefer not to use Google services

## Features

### Web Application

#### Login Page (`/login`)
- Email/password login form
- Google OAuth button
- Link to registration page
- Responsive design
- Error handling and validation

#### Registration Page (`/register`)
- Create new account with email/password
- Google OAuth option
- Password strength validation
- Confirm password matching
- Email format validation

### Mobile Application (Android)

#### API Endpoints

**Register**: `POST /api/app/register`
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "User Name"
}
```

**Login**: `POST /api/app/login`
```json
{
  "email": "user@example.com",
  "password": "securepassword"
}
```

Both endpoints return a JWT token valid for 7 days:
```json
{
  "success": true,
  "userId": "abc123",
  "name": "User Name",
  "email": "user@example.com",
  "token": "eyJhbGc...",
  "tokenExpiry": 1704758400000
}
```

## Security Features

### Password Security
- **Bcrypt hashing** with 10 salt rounds
- Minimum 6 character password requirement
- Passwords never stored in plain text
- Passwords never sent in logs

### Token Security
- **JWT tokens** for mobile app authentication
- 7-day token validity
- Secure token verification
- Token refresh support

### Data Protection
- Email addresses stored in lowercase for consistency
- Unique email constraint in database
- Password field excluded from API responses
- Session-based authentication for web
- Authorization headers for mobile

## Database Schema

### User Model (Email/Password)
```javascript
{
  id: "unique-hash",
  email: "user@example.com",      // Lowercase, unique
  name: "User Name",
  password: "bcrypt-hash",         // Hashed password
  authType: "email",               // "email" or "google"
  photo: null,
  devices: [],
  registeredDevices: [],
  createdAt: "2026-01-09T..."
}
```

### User Model (Google OAuth)
```javascript
{
  id: "google-id",
  email: "user@gmail.com",
  name: "User Name",
  photo: "https://...",
  authType: "google",              // No password field
  devices: [],
  registeredDevices: []
}
```

## How It Works

### Web Flow

1. **Registration**:
   - User visits `/register`
   - Enters name, email, password
   - System validates and hashes password
   - Creates user account
   - Auto-login and redirect to dashboard

2. **Login**:
   - User visits `/login`
   - Enters email and password
   - System verifies credentials
   - Creates session
   - Redirects to dashboard

3. **Google OAuth** (existing):
   - User clicks "Continue with Google"
   - Redirects to Google
   - Returns with profile data
   - Creates/updates user account
   - Redirects to dashboard

### Mobile Flow

1. **Registration**:
   - User opens app
   - Taps "Sign Up"
   - Enters credentials
   - App calls `/api/app/register`
   - Receives JWT token
   - Stores token locally
   - Navigates to main screen

2. **Login**:
   - User opens app
   - Enters email/password
   - App calls `/api/app/login`
   - Receives JWT token
   - Stores token locally
   - Navigates to main screen

3. **Using Token**:
   - All API requests include: `Authorization: Bearer {token}`
   - Token valid for 7 days
   - Auto-refresh before expiry

## Use Case Example

### Scenario: Lost Device Recovery

**Problem**: Sarah loses her phone at a coffee shop. She wants to track it but she's at her friend's house.

**Old System** (Google OAuth only):
1. Sarah borrows friend's phone
2. Opens browser to tracking website
3. Needs to login to Google account on friend's phone ❌ (Security risk)
4. Can't easily logout afterwards
5. Privacy concerns

**New System** (Email/Password):
1. Sarah borrows friend's phone ✅
2. Opens browser to tracking website ✅
3. Enters her email/password ✅ (No Google account needed)
4. Tracks her phone ✅
5. Logs out ✅ (Simple and secure)
6. No trace left on friend's device ✅

## Migration

### Existing Users
- Google OAuth users continue working as before
- No action required from existing users
- Both systems work simultaneously

### New Users
- Can choose email/password OR Google OAuth
- Can't mix (one email = one auth method)
- Clear error messages guide users

### Attempting Wrong Method
- Email/password user tries Google → Error: "Please use email/password login"
- Google user tries email/password → Error: "This account uses Google Sign-In"

## API Reference

### Web Routes

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/login` | Login page | No |
| GET | `/register` | Registration page | No |
| POST | `/login` | Email/password login | No |
| POST | `/register` | Create new account | No |
| GET | `/logout` | Logout user | Yes |
| GET | `/auth/google` | Google OAuth start | No |
| GET | `/auth/google/callback` | Google OAuth callback | No |

### Mobile API Routes

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/api/app/register` | Mobile registration | No |
| POST | `/api/app/login` | Mobile login | No |
| POST | `/api/verify-google-user` | Google OAuth mobile | No |
| POST | `/api/refresh-token` | Refresh JWT token | Yes |

## Environment Variables

No new environment variables required. Uses existing:
- `SESSION_SECRET` - Also used for JWT signing
- `MONGODB_URI` - Database connection (optional)

## Testing

### Manual Testing

1. **Test Registration**:
   ```
   1. Go to /register
   2. Enter name, email, password
   3. Click "Create Account"
   4. Should auto-login and redirect to dashboard
   ```

2. **Test Login**:
   ```
   1. Go to /login
   2. Enter email, password
   3. Click "Sign In"
   4. Should redirect to dashboard
   ```

3. **Test Google OAuth**:
   ```
   1. Go to /login
   2. Click "Continue with Google"
   3. Complete Google authentication
   4. Should redirect to dashboard
   ```

4. **Test Mobile API**:
   ```bash
   # Register
   curl -X POST http://localhost:3000/api/app/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123","name":"Test User"}'
   
   # Login
   curl -X POST http://localhost:3000/api/app/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123"}'
   ```

### Error Cases to Test

1. ❌ Duplicate email registration
2. ❌ Invalid email format
3. ❌ Password too short (< 6 chars)
4. ❌ Wrong password
5. ❌ Non-existent email
6. ❌ Passwords don't match (web only)
7. ❌ Google user tries email/password login
8. ❌ Email user tries Google login

## Android Implementation

See detailed guide: [`android-app/EMAIL_PASSWORD_AUTH_GUIDE.md`](android-app/EMAIL_PASSWORD_AUTH_GUIDE.md)

**Quick Start**:
1. Add Retrofit dependency
2. Create API interface
3. Build login/register UI
4. Store JWT token in SharedPreferences
5. Use token in all API requests
6. Connect Socket.IO with token

## Best Practices

### For Users
- ✅ Use a strong, unique password
- ✅ Don't share your password
- ✅ Logout on shared devices
- ✅ Use Google OAuth when on your own device
- ✅ Use email/password when on public/friend's devices

### For Developers
- ✅ Always use HTTPS in production
- ✅ Validate all inputs server-side
- ✅ Hash passwords with bcrypt
- ✅ Use JWT for mobile authentication
- ✅ Implement rate limiting
- ✅ Add CSRF protection
- ✅ Monitor for suspicious login attempts

## Future Enhancements

Potential features to add:
- 🔄 Password reset via email
- 📧 Email verification
- 🔐 Two-factor authentication (2FA)
- 📱 SMS verification
- 🔑 Passkey/WebAuthn support
- 👤 Profile management
- 🔒 Account security settings
- 📊 Login history/activity log

## Support

For issues or questions:
1. Check this documentation
2. Review Android guide
3. Check server logs
4. Test with curl/Postman
5. Verify database connection

## Summary

✨ **Dual authentication system successfully implemented!**

Users can now:
- 📧 Register with email/password
- 🔐 Login with email/password
- 🌐 Use Google OAuth (existing)
- 📱 Login from Android app with both methods
- 🔄 Switch between devices seamlessly
- 🚀 Track lost devices from any device

The system is secure, flexible, and user-friendly!
