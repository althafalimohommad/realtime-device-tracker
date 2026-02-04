require('dotenv').config();
const express = require('express');
const app = express();

// Behind Render/HTTPS proxy: trust proxy so secure cookies are set
app.set('trust proxy', 1);
const path = require('path');
const http = require("http");
const socketio = require("socket.io");
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer');
const database = require('./database');

// JWT Configuration
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
const JWT_EXPIRY = '7d'; // 7 days validity for mobile app tokens
const SALT_ROUNDS = 10; // bcrypt salt rounds for password hashing

// ===============================
// EMAIL CONFIGURATION (for password reset)
// ===============================
// Email configuration - only create transporter if credentials exist
let emailTransporter = null;
let emailConfigured = false;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    
    // Verify email configuration on startup
    emailTransporter.verify(function(error, success) {
        if (error) {
            console.error('❌ Email configuration error:', error.message);
            emailConfigured = false;
        } else {
            console.log('✅ Email server is ready to send messages');
            emailConfigured = true;
        }
    });
} else {
    console.warn('⚠️ EMAIL_USER or EMAIL_PASS not set - password reset emails will not work');
}

// Store for password reset codes (email -> {code, expiresAt, attempts})
const passwordResetCodes = new Map();

// Generate 6-digit verification code
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send password reset email
async function sendPasswordResetEmail(email, code, userName) {
    if (!emailTransporter || !emailConfigured) {
        throw new Error('Email service is not configured. Please contact support.');
    }
    
    const mailOptions = {
        from: `"Device Tracker" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: '🔐 Password Reset Code - Device Tracker',
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0;">📍 Device Tracker</h1>
                </div>
                <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px;">
                    <h2 style="color: #333;">Hi ${userName || 'there'},</h2>
                    <p style="color: #666; font-size: 16px;">You requested to reset your password. Use the code below to verify your identity:</p>
                    <div style="background: #667eea; color: white; font-size: 32px; font-weight: bold; text-align: center; padding: 20px; border-radius: 10px; letter-spacing: 8px; margin: 20px 0;">
                        ${code}
                    </div>
                    <p style="color: #666; font-size: 14px;">⏰ This code expires in <strong>10 minutes</strong>.</p>
                    <p style="color: #999; font-size: 12px;">If you didn't request this, please ignore this email. Your password will remain unchanged.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                    <p style="color: #999; font-size: 12px; text-align: center;">© ${new Date().getFullYear()} Device Tracker App</p>
                </div>
            </div>
        `
    };
    
    console.log(`📧 Attempting to send email to: ${email}`);
    const result = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email sent successfully. Message ID: ${result.messageId}`);
    return result;
}

// Generate JWT token for mobile app authentication
function generateAppToken(userId, email) {
    return jwt.sign(
        { userId, email, type: 'mobile_app' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );
}

// Verify JWT token
function verifyAppToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch (error) {
        return null;
    }
}

// Middleware to authenticate mobile app requests using JWT or Google ID token
async function authenticateMobileApp(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authorization token required' });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    // Check if token looks like a JWT (3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length === 3) {
        // Try to verify as our custom JWT
        const jwtPayload = verifyAppToken(token);
        if (jwtPayload && jwtPayload.type === 'mobile_app') {
            req.appUser = {
                userId: jwtPayload.userId,
                email: jwtPayload.email
            };
            return next();
        }
        
        // If our JWT fails, try Google ID token (also has 3 parts)
        try {
            const payload = await verifyGoogleIdToken(token);
            req.appUser = {
                userId: payload.sub,
                email: payload.email
            };
            return next();
        } catch (error) {
            console.log('⚠️ Token verification failed:', error.message);
            return res.status(401).json({ success: false, message: 'Invalid or expired token - please re-login' });
        }
    } else {
        // Token doesn't look like JWT - likely old format or corrupted
        console.log(`⚠️ Token verification failed: Wrong number of segments in token: ${token.substring(0, 30)}...`);
        return res.status(401).json({ 
            success: false, 
            message: 'Invalid token format - please logout and login again',
            code: 'INVALID_TOKEN_FORMAT'
        });
    }
}

const server = http.createServer(app);
const io = socketio(server);

// Store for sharing tokens (token -> {socketId, userId, expiresAt})
const shareTokens = new Map();

// User storage file (fallback)
const USERS_FILE = path.join(__dirname, 'users.json');

// In-memory user cache
let usersDB = {};
let useMongoDb = false;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

async function verifyGoogleIdToken(idToken) {
    const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
    });
    return ticket.getPayload();
}

// Initialize database connection
async function initializeDatabase() {
    useMongoDb = await database.connect();
    
    if (useMongoDb) {
        // Load users from MongoDB
        usersDB = await database.getAllUsers();
        console.log('📊 Loaded users from MongoDB');
    } else {
        // Fallback to file storage
        if (fs.existsSync(USERS_FILE)) {
            usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        }
        console.log('📁 Using local file storage');
    }
}

// Save users to database or file
async function saveUsers() {
    if (useMongoDb) {
        // Users are saved individually in MongoDB, no need for batch save
        return;
    } else {
        // Fallback to file storage
        fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
    }
}

// Save individual user
async function saveUser(user) {
    usersDB[user.id] = user;
    if (useMongoDb) {
        await database.saveUser(user);
    } else {
        saveUsers();
    }
}

// Fetch user from cache or DB
async function getUserById(userId) {
    let user = usersDB[userId];
    if (!user && useMongoDb) {
        user = await database.getUser(userId);
        if (user) {
            usersDB[userId] = user;
        }
    }
    return user;
}

// Update device location in database
async function updateDeviceLocation(userId, fingerprint, locationData) {
    const user = await getUserById(userId);
    if (!user) {
        console.log(`⚠️ Cannot update location: user not found for ${userId}`);
        return;
    }

    if (!user.registeredDevices) {
        user.registeredDevices = [];
    }
    
    const device = user.registeredDevices.find(d => d.fingerprint === fingerprint);
    if (device) {
        console.log(`💾 Updating location for device: ${device.name}`);
        device.lastLatitude = locationData.latitude;
        device.lastLongitude = locationData.longitude;
        device.lastAccuracy = locationData.accuracy;
        device.lastSeen = new Date().toISOString();
        device.lastBattery = locationData.battery;
        device.lastCharging = locationData.charging;
        
        await saveUser(user);
        console.log(`✅ Location saved for ${device.name}`);
    } else {
        console.log(`⚠️ Device not found in registeredDevices. Fingerprint: ${fingerprint?.substring(0, 50)}...`);
        console.log(`Available devices:`, user.registeredDevices.map(d => ({ name: d.name, fp: d.fingerprint?.substring(0, 30) })));
    }
}

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    // Store user in database
    const userId = profile.id;
    
    // Check if user exists in cache or database
    let user = usersDB[userId];
    
    if (!user) {
        // Try to load from database
        if (useMongoDb) {
            user = await database.getUser(userId);
        }
        
        // Create new user if not found
        if (!user) {
            user = {
                id: userId,
                email: profile.emails[0].value,
                name: profile.displayName,
                photo: profile.photos[0].value,
                devices: [],
                registeredDevices: []
            };
        }
        
        // Save to database
        await saveUser(user);
    }
    
    return done(null, user);
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    let user = usersDB[id];
    
    // If not in cache and using MongoDB, fetch from database
    if (!user && useMongoDb) {
        user = await database.getUser(id);
        if (user) {
            usersDB[id] = user; // Cache it
        }
    }
    
    done(null, user);
});

// Middleware
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
    }
}));
app.use(passport.initialize());
app.use(passport.session());

// Authentication middleware
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

// Store connected devices with user association
const devices = new Map();

io.on("connection", function(socket) {
    console.log("Device connected:", socket.id);
    
    // Handle viewer connection (web browsers just viewing, not tracking)
    socket.on("viewer-connected", function(data) {
        const { userId, email } = data;
        console.log(`👁️  Viewer connected: ${email} (${socket.id})`);
        
        // Join user room to receive real-time device updates
        if (userId) {
            socket.join(`user_${userId}`);
            
            // Send currently online registered devices
            const userDevices = Array.from(devices.values())
                .filter(d => d.userId === userId && d.isRegistered === true);
            socket.emit("devices-update", userDevices);
        }
    });
    
    // Handle device registration with name, user, and device info
    socket.on("register-device", async function(data) {
        const device = {
            id: socket.id,
            name: data.name || `Device ${socket.id.substring(0, 5)}`,
            userId: data.userId || null,
            isRegistered: data.isRegistered || false,
            lastSeen: new Date(),
            latitude: null,
            longitude: null,
            battery: null,
            charging: false,
            platform: data.deviceInfo?.platform || 'Unknown',
            fingerprint: data.deviceInfo?.userAgent || null,
            connection: data.deviceInfo?.connection || 'unknown',
            deviceType: data.deviceInfo?.deviceType || 'Unknown Device',
            deviceIcon: data.deviceInfo?.deviceIcon || '📱'
        };
        
        devices.set(socket.id, device);
        
        // Join user-specific room for instant broadcasting
        if (data.userId) {
            socket.join(`user_${data.userId}`);
        }
        
        // Only update user's devices in database if device is registered
        if (data.isRegistered && data.userId && usersDB[data.userId]) {
            if (!usersDB[data.userId].devices.includes(data.name)) {
                usersDB[data.userId].devices.push(data.name);
                await saveUser(usersDB[data.userId]);
            }
        }
        
        // Send only registered devices to this user
        if (data.userId) {
            const userDevices = Array.from(devices.values())
                .filter(d => d.userId === data.userId && d.isRegistered === true);
            // Broadcast to ALL devices in this user's room (including the new one)
            io.to(`user_${data.userId}`).emit("devices-update", userDevices);
        }
    });
    
    // Handle location updates (encrypted)
    socket.on("send-location", async function(data) {
        const device = devices.get(socket.id);
        if (device && device.isRegistered) { // Only process location for registered devices
            // Store encrypted data without decrypting (E2EE)
            device.encryptedLocation = data.encrypted;
            device.battery = data.battery || null;
            device.charging = data.charging || false;
            device.lastSeen = new Date();
            
            // Store plain coordinates for sharing (if sharing is enabled)
            if (data.latitude !== undefined && data.longitude !== undefined) {
                device.latitude = data.latitude;
                device.longitude = data.longitude;
                
                // Save last known location to database using fingerprint
                if (device.userId && device.fingerprint) {
                    console.log(`💾 Saving location for user ${device.userId}, device fingerprint: ${device.fingerprint?.substring(0, 50)}...`);
                    await updateDeviceLocation(device.userId, device.fingerprint, {
                        latitude: data.latitude,
                        longitude: data.longitude,
                        accuracy: data.accuracy,
                        battery: data.battery,
                        charging: data.charging
                    });
                }
            }
            
            // Broadcast instantly to user's room (all their registered devices)
            if (device.userId) {
                // Send location to all of this user's devices (instant room broadcast)
                io.to(`user_${device.userId}`).emit("receive-location", { 
                    id: socket.id, 
                    encrypted: data.encrypted,
                    battery: data.battery,
                    charging: data.charging
                });
                
                // Update devices list with battery info (instant room broadcast)
                const userDevices = Array.from(devices.values())
                    .filter(d => d.userId === device.userId && d.isRegistered === true);
                io.to(`user_${device.userId}`).emit("devices-update", userDevices);
            }
        }
    });
    
    // Handle alert request
    socket.on("alert-device", function(targetId) {
        io.to(targetId).emit("play-alert");
    });
    
    // Handle request location from device
    socket.on("request-location", function(targetId) {
        const device = devices.get(socket.id);
        const targetDevice = devices.get(targetId);
        
        // Only allow location requests from devices in the same user account
        if (device && targetDevice && device.userId === targetDevice.userId) {
            io.to(targetId).emit("location-requested", socket.id);
            console.log(`Location requested for device ${targetId} by ${socket.id}`);
        }
    });
    
    // Handle start sharing
    socket.on("start-sharing", function() {
        const device = devices.get(socket.id);
        if (device) {
            // Generate unique share token
            const token = crypto.randomBytes(16).toString('hex');
            const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
            
            shareTokens.set(token, {
                socketId: socket.id,
                userId: device.userId,
                deviceName: device.name,
                expiresAt: expiresAt
            });
            
            device.isSharing = true;
            device.shareToken = token;
            
            // Send share link back to user
            socket.emit('share-link', { token: token, expiresAt: expiresAt });
            socket.emit('share-status', { isSharing: true });
            
            console.log(`Sharing started for device ${socket.id}, token: ${token}`);
        }
    });
    
    // Handle stop sharing
    socket.on("stop-sharing", function() {
        const device = devices.get(socket.id);
        if (device && device.shareToken) {
            shareTokens.delete(device.shareToken);
            device.isSharing = false;
            device.shareToken = null;
            
            socket.emit('share-status', { isSharing: false });
            console.log(`Sharing stopped for device ${socket.id}`);
        }
    });
    
    // Handle disconnect
    socket.on("disconnect", async function() {
        const device = devices.get(socket.id);
        const userId = device?.userId;
        
        // Save last known location to database before device disconnects
        if (device && device.isRegistered && device.userId && device.latitude && device.longitude && device.fingerprint) {
            console.log(`💾 Saving last location on disconnect for device ${socket.id}, fingerprint: ${device.fingerprint?.substring(0, 50)}...`);
            await updateDeviceLocation(device.userId, device.fingerprint, {
                latitude: device.latitude,
                longitude: device.longitude,
                accuracy: device.accuracy,
                battery: device.battery,
                charging: device.charging
            });
            console.log(`✅ Saved last known location for device ${socket.id}`);
        }
        
        // Clean up share token on disconnect
        if (device && device.shareToken) {
            shareTokens.delete(device.shareToken);
        }
        
        devices.delete(socket.id);
        
        // Notify user's room instantly (all their other devices)
        if (userId) {
            io.to(`user_${userId}`).emit("user-disconnected", socket.id);
        }
        
        console.log("Device disconnected:", socket.id);
    });
});

// Routes
app.get("/", function (req, res) {
    if (!req.isAuthenticated()) {
        return res.redirect('/login');
    }
    res.render("home", { user: req.user });
});

app.get("/find-device", isAuthenticated, function (req, res) {
    // Redirect to tracker - will show message if no devices registered
    res.redirect('/tracker');
});

app.get("/tracker", isAuthenticated, function (req, res) {
    res.render("index", { user: req.user });
});

app.get("/login", function (req, res) {
    res.render("login");
});

app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    function(req, res) {
        res.redirect('/');
    }
);

app.get('/logout', function(req, res) {
    req.logout(function(err) {
        if (err) { return next(err); }
        res.redirect('/login');
    });
});

// Email/Password Login Route (Web only - no registration on web)
app.post('/login', async function(req, res) {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }
        
        const normalizedEmail = email.toLowerCase();
        
        // Find user by email
        let user = null;
        if (useMongoDb) {
            user = await database.getUserByEmail(normalizedEmail);
        } else {
            user = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
        
        // Check if user registered with Google OAuth
        if (!user.password) {
            return res.status(400).json({ 
                success: false, 
                message: 'This account uses Google Sign-In. Please use the Google button to login.' 
            });
        }
        
        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
        
        // Update cache
        usersDB[user.id] = user;
        
        // Log the user in
        req.login(user, function(err) {
            if (err) {
                console.error('Error logging in:', err);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Login failed. Please try again.' 
                });
            }
            
            // Ensure session is saved before sending response
            req.session.save(function(saveErr) {
                if (saveErr) {
                    console.error('Error saving session:', saveErr);
                    return res.status(500).json({ 
                        success: false, 
                        message: 'Login failed. Please try again.' 
                    });
                }
                
                console.log(`✅ User logged in: ${email}`);
                res.json({ 
                    success: true, 
                    message: 'Login successful',
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name
                    }
                });
            });
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Login failed. Please try again.' 
        });
    }
});

app.get('/api/user', isAuthenticated, function(req, res) {
    res.json(req.user);
});

// API endpoint to get last known locations for all registered devices
app.get('/api/last-known-locations', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        
        // Get user from cache or database
        let user = usersDB[userId];
        if (!user && useMongoDb) {
            user = await database.getUser(userId);
            if (user) {
                usersDB[userId] = user;
            }
        }
        
        if (!user || !user.registeredDevices) {
            return res.json({ devices: [] });
        }
        
        // Return ALL registered devices with their last known locations (if any)
        const devicesData = user.registeredDevices.map(d => ({
            id: d.id,
            name: d.name,
            fingerprint: d.fingerprint,
            icon: d.icon || '📱',
            type: d.type,
            latitude: d.lastLatitude || null,
            longitude: d.lastLongitude || null,
            accuracy: d.lastAccuracy || null,
            lastSeen: d.lastSeen || d.registeredAt,
            battery: d.lastBattery || null,
            charging: d.lastCharging || false,
            hasLocation: !!(d.lastLatitude && d.lastLongitude),
            isOnline: false // Will be updated by frontend if device is connected
        }));
        
        console.log(`📍 Returning ${devicesData.length} registered devices, ${devicesData.filter(d => d.hasLocation).length} with location`);
        
        res.json({ devices: devicesData });
    } catch (error) {
        console.error('Error fetching last known locations:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint to register a device
// API endpoint to update device location
app.post('/api/update-location', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        const { latitude, longitude, accuracy } = req.body;
        const fingerprint = req.headers['user-agent'];
        
        console.log(`📍 Location update from user ${userId}: ${latitude}, ${longitude}`);
        
        // Get user from cache or database
        let user = usersDB[userId];
        if (!user && useMongoDb) {
            user = await database.getUser(userId);
            if (user) {
                usersDB[userId] = user;
            }
        }
        
        if (!user || !user.registeredDevices) {
            return res.status(404).json({ success: false, message: 'User or device not found' });
        }
        
        // Find the registered device
        const device = user.registeredDevices.find(d => d.fingerprint === fingerprint);
        if (!device) {
            return res.status(404).json({ success: false, message: 'Device not registered' });
        }
        
        // Update device location
        device.latitude = latitude;
        device.longitude = longitude;
        device.accuracy = accuracy;
        device.lastLocationUpdate = new Date().toISOString();
        
        // Save to database
        await saveUser(user);
        
        // Broadcast location to all user's connected devices via socket
        io.to(`user_${userId}`).emit('location-updated', {
            deviceId: device.id,
            deviceName: device.name,
            latitude,
            longitude,
            accuracy,
            timestamp: device.lastLocationUpdate
        });
        
        res.json({ success: true, message: 'Location updated' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint for Android app to verify Google OAuth user and get JWT
app.post('/api/verify-google-user', async function(req, res) {
    try {
        let { email, name, googleId, idToken } = req.body;
        
        // If only idToken is provided, extract user info from it
        if (idToken) {
            try {
                const payload = await verifyGoogleIdToken(idToken);
                // Extract user info from verified token
                googleId = googleId || payload.sub;
                email = email || payload.email;
                name = name || payload.name;
                
                // Verify the token matches the claimed identity (if both provided)
                if (req.body.googleId && payload.sub !== req.body.googleId) {
                    console.log(`❌ Token mismatch for googleId`);
                    return res.status(401).json({ success: false, message: 'Token verification failed' });
                }
                if (req.body.email && payload.email !== req.body.email) {
                    console.log(`❌ Token mismatch for email`);
                    return res.status(401).json({ success: false, message: 'Token verification failed' });
                }
                console.log(`✅ Google ID token verified for: ${email}`);
            } catch (tokenError) {
                console.log(`⚠️ Google ID token verification failed: ${tokenError.message}`);
                // If token verification fails and no email/googleId provided, reject
                if (!email || !googleId) {
                    return res.status(401).json({ success: false, message: 'Invalid or expired Google token' });
                }
            }
        }
        
        if (!email || !googleId) {
            return res.status(400).json({ success: false, message: 'Email and googleId required (or valid idToken)' });
        }
        
        console.log(`🔐 Android app Google login attempt: ${email}`);
        
        const normalizedEmail = email.toLowerCase();
        
        // 🔗 ACCOUNT LINKING: Check if user exists with this email (regardless of auth method)
        let user = null;
        if (useMongoDb) {
            user = await database.getUserByEmail(normalizedEmail);
        } else {
            user = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        if (user) {
            // User exists with this email - link Google ID to existing account
            console.log(`🔗 Linking Google account to existing user: ${email}`);
            
            // Add Google ID to user if not already present
            if (!user.googleId) {
                user.googleId = googleId;
                user.authType = user.authType ? 'both' : 'google';
                await saveUser(user);
                console.log(`✅ Google ID linked to existing account: ${user.id}`);
            }
        } else {
            // Check if user exists with this Google ID
            for (const userId in usersDB) {
                if (usersDB[userId].id === googleId || usersDB[userId].googleId === googleId) {
                    user = usersDB[userId];
                    break;
                }
            }
            
            if (!user) {
                // Create new user with Google authentication
                console.log(`🆕 Creating new user from Google login: ${email}`);
                user = {
                    id: crypto.randomBytes(16).toString('hex'), // Use consistent ID format
                    googleId: googleId,
                    email: normalizedEmail,
                    name: name || email.split('@')[0],
                    authType: 'google',
                    devices: [],
                    registeredDevices: [],
                    createdAt: new Date().toISOString()
                };
                await saveUser(user);
            }
        }
        
        // Generate long-lived JWT for mobile app
        const appToken = generateAppToken(user.id, user.email);
        
        console.log(`✅ Google user verified and JWT issued: ${email} (userId: ${user.id})`);
        res.json({ 
            success: true, 
            userId: user.id,
            name: user.displayName || user.name || email.split('@')[0],
            email: user.email,
            token: appToken,  // Backend JWT for persistent authentication
            tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days from now
        });
        
    } catch (error) {
        console.error('Error verifying Google user:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint for mobile app to login with email/password
app.post('/api/app/login', async function(req, res) {
    try {
        const { email, password } = req.body;
        
        // Validate input
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and password are required' 
            });
        }
        
        console.log(`📱 Mobile app email/password login attempt: ${email}`);
        
        const normalizedEmail = email.toLowerCase();
        
        // Find user by email
        let user = null;
        if (useMongoDb) {
            user = await database.getUserByEmail(normalizedEmail);
        } else {
            user = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
        
        // Check if user registered with Google OAuth only
        if (!user.password) {
            return res.status(400).json({ 
                success: false, 
                message: 'This account uses Google Sign-In. Please use Google authentication or set a password first.' 
            });
        }
        
        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password);
        
        if (!passwordMatch) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid email or password' 
            });
        }
        
        // Update cache
        usersDB[user.id] = user;
        
        // Generate long-lived JWT for mobile app
        const appToken = generateAppToken(user.id, user.email);
        
        console.log(`✅ Mobile app email/password login successful: ${email} (userId: ${user.id})`);
        res.json({ 
            success: true, 
            userId: user.id,
            name: user.name,
            email: user.email,
            token: appToken,
            tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days from now
        });
        
    } catch (error) {
        console.error('Mobile app login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Login failed. Please try again.' 
        });
    }
});

// ===============================
// PASSWORD RESET ENDPOINTS
// ===============================

// Step 1: Request password reset - sends verification code to email
app.post('/api/forgot-password', async function(req, res) {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email is required' 
            });
        }
        
        const normalizedEmail = email.toLowerCase();
        console.log(`🔐 Password reset requested for: ${normalizedEmail}`);
        
        // Find user by email
        let user = null;
        if (useMongoDb) {
            user = await database.getUserByEmail(normalizedEmail);
        } else {
            user = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        // Always return success to prevent email enumeration attacks
        // But only send email if user exists
        if (user && user.password) {
            // Check rate limiting (max 3 requests per 10 minutes)
            const existingRequest = passwordResetCodes.get(normalizedEmail);
            if (existingRequest && existingRequest.attempts >= 3 && 
                Date.now() < existingRequest.rateLimitExpires) {
                return res.status(429).json({
                    success: false,
                    message: 'Too many reset attempts. Please try again in 10 minutes.'
                });
            }
            
            // Generate verification code
            const code = generateVerificationCode();
            const expiresAt = Date.now() + (10 * 60 * 1000); // 10 minutes
            
            // Store the code
            passwordResetCodes.set(normalizedEmail, {
                code,
                expiresAt,
                attempts: (existingRequest?.attempts || 0) + 1,
                rateLimitExpires: Date.now() + (10 * 60 * 1000),
                userId: user.id
            });
            
            // Send email
            try {
                await sendPasswordResetEmail(normalizedEmail, code, user.name);
                console.log(`📧 Password reset code sent to: ${normalizedEmail}`);
            } catch (emailError) {
                console.error('Failed to send reset email:', emailError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to send email. Please try again later.'
                });
            }
        } else if (user && !user.password) {
            // User exists but uses Google OAuth only
            return res.json({
                success: false,
                message: 'This account uses Google Sign-In. Please login with Google.'
            });
        } else {
            // User not found - return error
            return res.json({
                success: false,
                message: 'No account found with this email. Please check your email or register.'
            });
        }
        
        // Email sent successfully
        res.json({
            success: true,
            message: 'Verification code sent to your email.'
        });
        
    } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Something went wrong. Please try again.' 
        });
    }
});

// Step 2: Verify the reset code
app.post('/api/verify-reset-code', async function(req, res) {
    try {
        const { email, code } = req.body;
        
        if (!email || !code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email and verification code are required' 
            });
        }
        
        const normalizedEmail = email.toLowerCase();
        const resetData = passwordResetCodes.get(normalizedEmail);
        
        if (!resetData) {
            return res.status(400).json({
                success: false,
                message: 'No reset request found. Please request a new code.'
            });
        }
        
        if (Date.now() > resetData.expiresAt) {
            passwordResetCodes.delete(normalizedEmail);
            return res.status(400).json({
                success: false,
                message: 'Verification code has expired. Please request a new one.'
            });
        }
        
        if (resetData.code !== code) {
            return res.status(400).json({
                success: false,
                message: 'Invalid verification code. Please check and try again.'
            });
        }
        
        // Code is valid - generate a temporary token for password reset
        const resetToken = jwt.sign(
            { email: normalizedEmail, purpose: 'password_reset' },
            JWT_SECRET,
            { expiresIn: '15m' }
        );
        
        console.log(`✅ Reset code verified for: ${normalizedEmail}`);
        res.json({
            success: true,
            message: 'Code verified successfully.',
            resetToken
        });
        
    } catch (error) {
        console.error('Code verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Verification failed. Please try again.' 
        });
    }
});

// Step 3: Reset password with verified token
app.post('/api/reset-password', async function(req, res) {
    try {
        const { resetToken, newPassword } = req.body;
        
        if (!resetToken || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: 'Reset token and new password are required' 
            });
        }
        
        // Validate password strength
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long.'
            });
        }
        
        // Verify reset token
        let tokenPayload;
        try {
            tokenPayload = jwt.verify(resetToken, JWT_SECRET);
        } catch (err) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset token. Please start over.'
            });
        }
        
        if (tokenPayload.purpose !== 'password_reset') {
            return res.status(400).json({
                success: false,
                message: 'Invalid reset token.'
            });
        }
        
        const normalizedEmail = tokenPayload.email;
        
        // Find user
        let user = null;
        if (useMongoDb) {
            user = await database.getUserByEmail(normalizedEmail);
        } else {
            user = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found.'
            });
        }
        
        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        
        // Update user password
        user.password = hashedPassword;
        user.passwordUpdatedAt = new Date().toISOString();
        
        // Save to database
        await saveUser(user);
        
        // Clear the reset code
        passwordResetCodes.delete(normalizedEmail);
        
        console.log(`✅ Password reset successful for: ${normalizedEmail}`);
        res.json({
            success: true,
            message: 'Password reset successfully. You can now login with your new password.'
        });
        
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Password reset failed. Please try again.' 
        });
    }
});

// API endpoint for mobile app to register with email/password
app.post('/api/app/register', async function(req, res) {
    try {
        const { email, password, name } = req.body;
        
        // Validate input
        if (!email || !password || !name) {
            return res.status(400).json({ 
                success: false, 
                message: 'Email, password, and name are required' 
            });
        }
        
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid email format' 
            });
        }
        
        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: 'Password must be at least 6 characters' 
            });
        }
        
        console.log(`📱 Mobile app registration attempt: ${email}`);
        
        const normalizedEmail = email.toLowerCase();
        
        // 🔗 ACCOUNT LINKING: Check if user exists with this email
        let existingUser = null;
        if (useMongoDb) {
            existingUser = await database.getUserByEmail(normalizedEmail);
        } else {
            existingUser = Object.values(usersDB).find(u => u.email === normalizedEmail);
        }
        
        if (existingUser) {
            // User exists - check if they registered with Google
            if (existingUser.googleId && !existingUser.password) {
                // User registered with Google, now adding password
                console.log(`🔗 Adding password to existing Google account: ${email}`);
                
                const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
                existingUser.password = hashedPassword;
                existingUser.authType = 'both';
                await saveUser(existingUser);
                
                const appToken = generateAppToken(existingUser.id, existingUser.email);
                
                console.log(`✅ Password added to Google account: ${email}`);
                return res.json({ 
                    success: true,
                    message: 'Password added to your Google account',
                    userId: existingUser.id,
                    name: existingUser.name,
                    email: existingUser.email,
                    token: appToken,
                    tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000)
                });
            } else {
                // User already has email/password account
                return res.status(400).json({ 
                    success: false, 
                    message: 'Email already registered. Please login instead.' 
                });
            }
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        
        // Create new user
        const userId = crypto.randomBytes(16).toString('hex');
        const newUser = {
            id: userId,
            email: normalizedEmail,
            name: name,
            password: hashedPassword,
            authType: 'email',
            photo: null,
            devices: [],
            registeredDevices: [],
            createdAt: new Date().toISOString()
        };
        
        // Save user
        await saveUser(newUser);
        
        // Generate JWT for mobile app
        const appToken = generateAppToken(newUser.id, newUser.email);
        
        console.log(`✅ Mobile app registration successful: ${email} (userId: ${newUser.id})`);
        res.json({ 
            success: true,
            message: 'Registration successful',
            userId: newUser.id,
            name: newUser.name,
            email: newUser.email,
            token: appToken,
            tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000)
        });
        
    } catch (error) {
        console.error('Mobile app registration error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Registration failed. Please try again.' 
        });
    }
});

// API endpoint to refresh app token (call this before token expires)
app.post('/api/refresh-token', authenticateMobileApp, async function(req, res) {
    try {
        const { userId, email } = req.appUser;
        
        // Verify user still exists
        const user = await getUserById(userId);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
        
        // Generate new token
        const newToken = generateAppToken(userId, email);
        
        console.log(`🔄 Token refreshed for user: ${email}`);
        res.json({
            success: true,
            token: newToken,
            tokenExpiry: Date.now() + (7 * 24 * 60 * 60 * 1000)
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// API endpoint for Android app to send location updates (supports JWT and Google ID token)
app.post('/api/location-update-app', authenticateMobileApp, async function(req, res) {
    try {
        const { latitude, longitude, accuracy, deviceName, battery, charging, timestamp, fingerprint: bodyFingerprint } = req.body;
        const userAgent = req.headers['user-agent'];
        const headerFingerprint = req.headers['x-device-fingerprint'];
        const fingerprint = bodyFingerprint || headerFingerprint || userAgent;
        
        // User is authenticated via middleware
        const { userId, email } = req.appUser;

        console.log(`📱 Android app location update from user ${userId}: ${latitude}, ${longitude} (fp: ${fingerprint?.substring(0, 40)})`);

        let user = await getUserById(userId);
        if (!user) {
            // Auto-provision user on first app contact
            user = {
                id: userId,
                email: email || 'unknown',
                name: email || 'Android User',
                devices: [],
                registeredDevices: []
            };
            await saveUser(user);
        }

        if (!user.registeredDevices) {
            user.registeredDevices = [];
        }

        let device = user.registeredDevices.find(d => d.fingerprint === fingerprint);

        // Auto-register the Android device if it has not been registered via the web
        if (!device) {
            device = {
                id: crypto.randomBytes(16).toString('hex'),
                name: deviceName || 'Android Device',
                type: 'Android',
                model: userAgent?.substring(0, 100) || 'Android',
                platform: 'android-app',
                browser: 'android-app',
                icon: '📱',
                registeredAt: new Date().toISOString(),
                fingerprint: fingerprint,
                lastLatitude: null,
                lastLongitude: null,
                lastAccuracy: null,
                lastSeen: null,
                lastBattery: null,
                lastCharging: null
            };
            user.registeredDevices.push(device);
            await saveUser(user);
            console.log(`🆕 Auto-registered Android device for user ${userId}: ${device.name}`);
        }

        // Update device location in database
        if (userId && fingerprint) {
            await updateDeviceLocation(userId, fingerprint, {
                latitude,
                longitude,
                accuracy,
                battery,
                charging
            });
            
            console.log(`✅ Location saved from Android app: ${deviceName}`);
        }
        
        res.json({ success: true, message: 'Location updated' });
    } catch (error) {
        console.error('Error processing app location update:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Device registration removed from web - use mobile app only
// app.post('/api/register-device', ...) - REMOVED

// Keeping this commented for reference:
/*
app.post('/api/register-device', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        const { deviceName, deviceType, deviceModel, platform, browser, deviceIcon, initialLocation } = req.body;
        
        // Create device registration
        const deviceId = crypto.randomBytes(16).toString('hex');
        const deviceRegistration = {
            id: deviceId,
            name: deviceName,
            type: deviceType,
            model: deviceModel,
            platform: platform,
            browser: browser,
            icon: deviceIcon,
            registeredAt: new Date().toISOString(),
            fingerprint: req.headers['user-agent'], // Basic fingerprinting
            latitude: initialLocation?.latitude || null,
            longitude: initialLocation?.longitude || null,
            lastLocationUpdate: initialLocation ? new Date().toISOString() : null
        };
        
        // Get user from cache or database
        let user = usersDB[userId];
        if (!user && useMongoDb) {
            user = await database.getUser(userId);
            if (user) {
                usersDB[userId] = user;
            }
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        // Initialize registeredDevices array if it doesn't exist
        if (!user.registeredDevices) {
            user.registeredDevices = [];
        }
        
        // Check if this device is already registered (by fingerprint)
        const existingDevice = user.registeredDevices.find(
            d => d.fingerprint === deviceRegistration.fingerprint
        );
        
        if (existingDevice) {
            // Update existing device
            existingDevice.name = deviceName;
            existingDevice.type = deviceType;
            existingDevice.model = deviceModel;
            existingDevice.lastUpdated = new Date().toISOString();
        } else {
            // Add new device
            user.registeredDevices.push(deviceRegistration);
        }
        
        // Save to database
        await saveUser(user);
        
        res.json({ 
            success: true, 
            deviceId: existingDevice ? existingDevice.id : deviceId,
            message: existingDevice ? 'Device updated successfully' : 'Device registered successfully'
        });
    } catch (error) {
        console.error('Error registering device:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});
*/

// Unregister device endpoint
app.post('/api/unregister-device', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        const { deviceId } = req.body;
        
        if (!deviceId) {
            return res.status(400).json({ success: false, message: 'Device ID required' });
        }
        
        // Get user from cache or database
        let user = usersDB[userId];
        if (!user && useMongoDb) {
            user = await database.getUser(userId);
            if (user) {
                usersDB[userId] = user;
            }
        }
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        
        if (!user.registeredDevices) {
            return res.status(404).json({ success: false, message: 'No registered devices found' });
        }
        
        // Find device to unregister
        const deviceIndex = user.registeredDevices.findIndex(d => d.id === deviceId);
        
        if (deviceIndex === -1) {
            return res.status(404).json({ success: false, message: 'Device not found' });
        }
        
        // Remove device from array
        const removedDevice = user.registeredDevices.splice(deviceIndex, 1)[0];
        
        // Save to database
        await saveUser(user);
        
        console.log(`Device unregistered: ${removedDevice.name} for user ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Device unregistered successfully',
            deviceName: removedDevice.name
        });
    } catch (error) {
        console.error('Error unregistering device:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete user account endpoint
app.post('/api/delete-account', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        
        // Delete from database
        if (useMongoDb) {
            await database.deleteUser(userId);
        }
        
        // Remove from cache
        delete usersDB[userId];
        
        // Logout user
        req.logout(function(err) {
            if (err) {
                console.error('Logout error:', err);
            }
        });
        
        console.log(`✅ Account deleted for user: ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Account deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting account:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Clear location history endpoint
app.post('/api/clear-location-history', isAuthenticated, async function(req, res) {
    try {
        const userId = req.user.id;
        
        // Clear location history in database
        if (useMongoDb) {
            await database.clearUserLocationHistory(userId);
        }
        
        // Update cache
        let user = usersDB[userId];
        if (!user && useMongoDb) {
            user = await database.getUser(userId);
        }
        
        if (user && user.registeredDevices) {
            user.registeredDevices = user.registeredDevices.map(device => ({
                ...device,
                latitude: null,
                longitude: null,
                accuracy: null,
                lastLocationUpdate: null
            }));
            usersDB[userId] = user;
        }
        
        console.log(`✅ Location history cleared for user: ${userId}`);
        
        res.json({ 
            success: true, 
            message: 'Location history cleared successfully'
        });
    } catch (error) {
        console.error('Error clearing location history:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Admin middleware
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

function isAdmin(req, res, next) {
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
        const token = auth.substring(7);
        if (token === ADMIN_PASSWORD) {
            return next();
        }
    }
    res.status(401).json({ error: 'Unauthorized' });
}

// Privacy policy page
app.get('/privacy', function(req, res) {
    res.render('privacy');
});

// Admin dashboard page
app.get('/admin', function(req, res) {
    res.render('admin');
});

// Admin API - Get all users and devices
app.get('/api/admin/users', isAdmin, async function(req, res) {
    try {
        // Get real IP address (works with proxies like Render)
        const realIP = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                       req.headers['x-real-ip'] || 
                       req.ip || 
                       req.connection.remoteAddress || 
                       'Unknown';
        
        // Log admin access
        if (useMongoDb) {
            await database.logAdminAccess('VIEW_ALL_USERS', {
                ip: realIP
            });
        }
        
        const allUsers = await database.getAllUsersArray();
        
        const stats = {
            totalUsers: allUsers.length,
            totalDevices: allUsers.reduce((sum, user) => {
                return sum + (user.registeredDevices?.length || 0);
            }, 0),
            users: allUsers.map(user => ({
                id: user.id,
                email: user.email,
                name: user.name,
                photo: user.photo,
                devices: (user.registeredDevices || []).map(device => ({
                    id: device.id,
                    name: device.name,
                    icon: device.icon || '📱',
                    type: device.type,
                    model: device.model,
                    // Use the most recent location fields (Android uses lastLatitude/lastLongitude)
                    latitude: device.lastLatitude || device.latitude || null,
                    longitude: device.lastLongitude || device.longitude || null,
                    accuracy: device.lastAccuracy || device.accuracy || null,
                    lastLocationUpdate: device.lastSeen || device.lastLocationUpdate || null,
                    registeredAt: device.registeredAt
                }))
            }))
        };
        
        res.json(stats);
    } catch (error) {
        console.error('Admin API error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin API - Get audit logs
app.get('/api/admin/audit-logs', isAdmin, async function(req, res) {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = await database.getAdminAuditLog(limit);
        
        res.json({
            success: true,
            logs: logs,
            total: logs.length
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ error: error.message });
    }
});

// Public share route
app.get('/share/:token', function(req, res) {
    const token = req.params.token;
    const shareData = shareTokens.get(token);
    
    if (!shareData) {
        return res.status(404).send('Share link not found or expired');
    }
    
    // Check if expired
    if (Date.now() > shareData.expiresAt) {
        shareTokens.delete(token);
        return res.status(404).send('Share link expired');
    }
    
    res.render('share', { 
        deviceName: shareData.deviceName,
        token: token 
    });
});

// API endpoint for shared location
app.get('/api/share/:token', function(req, res) {
    const token = req.params.token;
    const shareData = shareTokens.get(token);
    
    if (!shareData || Date.now() > shareData.expiresAt) {
        return res.status(404).json({ error: 'Share link not found or expired' });
    }
    
    const device = devices.get(shareData.socketId);
    if (!device) {
        return res.status(404).json({ error: 'Device offline' });
    }
    
    res.json({
        deviceName: device.name,
        deviceType: device.deviceType,
        deviceIcon: device.deviceIcon,
        latitude: device.latitude,
        longitude: device.longitude,
        battery: device.battery,
        charging: device.charging,
        lastSeen: device.lastSeen
    });
});

const PORT = process.env.PORT || 3000;

// Auto-delete old location data daily (runs every 24 hours)
if (useMongoDb) {
    setInterval(async () => {
        try {
            const deletedCount = await database.deleteOldLocationData(30);
            console.log(`🗑️  Auto-cleanup: Removed ${deletedCount} old location records`);
        } catch (error) {
            console.error('Error in auto-cleanup:', error);
        }
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Run once on startup
    setTimeout(async () => {
        try {
            const deletedCount = await database.deleteOldLocationData(30);
            console.log(`🗑️  Initial cleanup: Removed ${deletedCount} old location records`);
        } catch (error) {
            console.error('Error in initial cleanup:', error);
        }
    }, 10000); // Wait 10 seconds after startup
}

// Initialize database and start server
initializeDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server listening on port ${PORT}`);
        console.log(`📊 Database: ${useMongoDb ? 'MongoDB Atlas (Cloud)' : 'Local File Storage'}`);
        
        // Keep-alive ping to prevent Render free tier from sleeping (runs every 14 minutes)
        // Only run in production (not on localhost)
        const isProduction = process.env.NODE_ENV === 'production' || process.env.CALLBACK_URL?.includes('render.com') || process.env.CALLBACK_URL?.includes('railway.app');
        
        if (isProduction) {
            const appUrl = process.env.CALLBACK_URL?.replace('/auth/google/callback', '') || `https://realtime-device-tracker-s9ua.onrender.com`;
            
            setInterval(async () => {
                try {
                    const https = require('https');
                    https.get(appUrl, (res) => {
                        console.log(`⏰ Keep-alive ping sent to ${appUrl} - Status: ${res.statusCode}`);
                    }).on('error', (err) => {
                        console.log('⚠️ Keep-alive ping failed:', err.message);
                    });
                } catch (error) {
                    console.log('⚠️ Keep-alive error:', error.message);
                }
            }, 14 * 60 * 1000); // 14 minutes (before 15-min timeout)
            
            console.log('⏰ Keep-alive service activated (pings every 14 minutes to prevent sleep)');
        } else {
            console.log('💻 Running in development mode - keep-alive disabled');
        }
    });
}).catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});