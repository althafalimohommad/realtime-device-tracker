# 📍 Real-Time Device Tracker

A production-ready real-time device tracking application with Google OAuth authentication, end-to-end encryption, and location sharing capabilities. Track multiple devices on an interactive map with live updates, similar to "Find My Device" functionality.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)

## ✨ Features

### 🔐 Security & Privacy
- **Google OAuth 2.0 Authentication** - Secure login with Google accounts
- **End-to-End Encryption (E2EE)** - AES-256-GCM encryption for all location data
- **Per-User Encryption Keys** - Each user has unique encryption keys stored locally
- **Session Management** - Secure 24-hour sessions with express-session

### 📱 Device Management
- **Automatic Device Detection** - Identifies 100+ device models:
  - Samsung Galaxy (S24, S23, S22 series, Note, Z Fold/Flip)
  - iPhone (15, 14, 13, 12, 11 series)
  - Google Pixel, OnePlus, Xiaomi, Huawei
  - Windows PC, MacBook (Intel/Apple Silicon), Linux, Chromebook
- **Multi-Device Support** - Track unlimited devices per user
- **Device Icons** - Visual device type indicators (📱 phone, 💻 laptop, 📲 tablet)
- **Battery Monitoring** - Real-time battery percentage and charging status
- **Custom Device Names** - Rename devices for easy identification

### 🗺️ Location Tracking
- **Real-Time Updates** - Live location tracking with Socket.IO rooms (zero delay)
- **Interactive Map** - Leaflet.js with OpenStreetMap integration
- **High Accuracy** - GPS coordinates with accuracy indicators
- **Speed & Altitude** - Additional location metadata
- **Auto-Zoom** - Automatically focuses on your current device

### 🔗 Location Sharing
- **Shareable Links** - Generate secure share links with one click
- **Google Maps Integration** - Direct "Open in Google Maps" button
- **Coordinates Display** - Shows exact latitude and longitude
- **24-Hour Expiration** - Share links auto-expire for security
- **Revoke Access** - Stop sharing instantly anytime
- **Public Access** - Recipients don't need to login

### 🎯 Additional Features
- **Locate Device** - Jump to any device location on the map
- **Alert Device** - Send sound alerts to remote devices
- **Connection Info** - Network type (4G, 5G, WiFi) detection
- **Responsive Design** - Works on desktop, tablet, and mobile
- **Dark Theme** - Modern gradient UI with animations

## 🚀 Quick Start

### Prerequisites
- Node.js >= 14.0.0
- npm or yarn
- Google OAuth 2.0 credentials ([Get here](https://console.cloud.google.com/))

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/althafalimohommad/realtime-device-tracker.git
cd realtime-device-tracker
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create a `.env` file in the root directory:
```env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
SESSION_SECRET=your-super-secret-session-key-change-this-in-production
CALLBACK_URL=http://localhost:3000/auth/google/callback
```

4. **Start the server**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

5. **Open your browser**
```
http://localhost:3000
```

## 📦 Dependencies

```json
{
  "express": "^4.x",
  "socket.io": "^4.x",
  "ejs": "^3.x",
  "passport": "^0.7.x",
  "passport-google-oauth20": "^2.x",
  "express-session": "^1.x",
  "dotenv": "^16.x"
}
```

## 🛠️ How It Works

### Authentication Flow
1. User clicks "Sign in with Google"
2. Google OAuth 2.0 authentication
3. User profile stored in `users.json`
4. Session created with 24-hour expiration
5. Encryption key generated for E2EE

### Device Registration
1. Client detects device type from User Agent
2. Connects to Socket.IO server
3. Joins user-specific room (`user_${userId}`)
4. Sends device info (name, type, icon, battery)
5. Server broadcasts to user's other devices

### Location Tracking
1. Browser requests geolocation permission
2. Watchposition API tracks location changes
3. Client encrypts coordinates with AES-256-GCM
4. Sends encrypted data + plain data (if sharing)
5. Server broadcasts to user's devices via Socket.IO rooms
6. Clients decrypt and display on map

### Location Sharing
1. User clicks "Share" button
2. Server generates unique 32-character token
3. Share link: `http://localhost:3000/share/token`
4. Recipients see live coordinates + Google Maps link
5. Auto-expires in 24 hours or on "Stop Sharing"

## 🔒 Security Features

- **No Server-Side Decryption** - Server never decrypts location data
- **Client-Side Encryption** - Web Crypto API (AES-256-GCM)
- **Secure Sessions** - httpOnly cookies with express-session
- **Environment Variables** - Sensitive credentials in `.env` (gitignored)
- **Token Validation** - Share tokens validated on every request
- **User Isolation** - Each user only sees their own devices

## 📂 Project Structure

```
realtime-device-tracker/
├── app.js                      # Express server & Socket.IO handlers
├── package.json                # Dependencies & scripts
├── .env                        # Environment variables (not committed)
├── .gitignore                  # Git ignore rules
├── users.json                  # User database (auto-generated)
├── public/
│   ├── css/
│   │   └── style.css           # UI styling
│   └── js/
│       ├── encryption.js       # E2EE utility (AES-256-GCM)
│       └── script.js           # Client-side logic
└── views/
    ├── login.ejs               # Google OAuth login page
    ├── index.ejs               # Main tracker interface
    └── share.ejs               # Public share page
```

## 🌐 Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `123456789.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-xxxxxxxxxx` |
| `SESSION_SECRET` | Express session secret | `random-secure-string` |
| `CALLBACK_URL` | OAuth redirect URL | `http://localhost:3000/auth/google/callback` |

## 🎨 Screenshots

### Login Page
Google OAuth authentication with modern gradient design

### Tracker Dashboard
- Device sidebar with battery indicators
- Interactive Leaflet map
- Real-time location markers
- Device type icons

### Share Page
- Live coordinates display
- Google Maps integration
- Battery & connection status
- Auto-refresh every 5 seconds

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👨‍💻 Author

**Mohmad Althaf Ali**
- GitHub: [@althafalimohommad](https://github.com/althafalimohommad)

## 🙏 Acknowledgments

- [Socket.IO](https://socket.io/) - Real-time communication
- [Leaflet](https://leafletjs.com/) - Interactive maps
- [OpenStreetMap](https://www.openstreetmap.org/) - Map tiles
- [Passport.js](http://www.passportjs.org/) - Authentication
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API) - Encryption

## 📞 Support

For support, email or open an issue in the GitHub repository.

## 🔮 Future Enhancements

- [ ] Geofencing with alerts
- [ ] Location history and timeline
- [ ] Offline mode with service workers
- [ ] Push notifications
- [ ] Database integration (MongoDB/PostgreSQL)
- [ ] Docker containerization
- [ ] Mobile apps (React Native)
- [ ] Two-factor authentication
- [ ] Export location data (CSV/JSON)

---

⭐ **Star this repo if you find it useful!**
