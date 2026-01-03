require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const http = require("http");
const socketio = require("socket.io");
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const fs = require('fs');
const crypto = require('crypto');

const server = http.createServer(app);
const io = socketio(server);

// Store for sharing tokens (token -> {socketId, userId, expiresAt})
const shareTokens = new Map();

// User storage file
const USERS_FILE = path.join(__dirname, 'users.json');

// Load or create users database
let usersDB = {};
if (fs.existsSync(USERS_FILE)) {
    usersDB = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers() {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersDB, null, 2));
}

// Passport configuration
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
    // Store user in database
    const userId = profile.id;
    if (!usersDB[userId]) {
        usersDB[userId] = {
            id: userId,
            email: profile.emails[0].value,
            name: profile.displayName,
            photo: profile.photos[0].value,
            devices: [],
            registeredDevices: []
        };
        saveUsers();
    }
    return done(null, usersDB[userId]);
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    done(null, usersDB[id]);
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
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
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
    
    // Handle device registration with name, user, and device info
    socket.on("register-device", function(data) {
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
                saveUsers();
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
    socket.on("send-location", function(data) {
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
    socket.on("disconnect", function() {
        const device = devices.get(socket.id);
        const userId = device?.userId;
        
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

app.get("/register-device", isAuthenticated, function (req, res) {
    res.render("register-device", { user: req.user });
});

app.get("/find-device", isAuthenticated, function (req, res) {
    // Check if user has registered devices
    const user = req.user;
    if (!user.registeredDevices || user.registeredDevices.length === 0) {
        return res.redirect('/register-device');
    }
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

app.get('/api/user', isAuthenticated, function(req, res) {
    res.json(req.user);
});

// API endpoint to register a device
app.post('/api/register-device', isAuthenticated, function(req, res) {
    try {
        const userId = req.user.id;
        const { deviceName, deviceType, deviceModel, platform, browser, deviceIcon } = req.body;
        
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
            fingerprint: req.headers['user-agent'] // Basic fingerprinting
        };
        
        // Initialize registeredDevices array if it doesn't exist
        if (!usersDB[userId].registeredDevices) {
            usersDB[userId].registeredDevices = [];
        }
        
        // Check if this device is already registered (by fingerprint)
        const existingDevice = usersDB[userId].registeredDevices.find(
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
            usersDB[userId].registeredDevices.push(deviceRegistration);
        }
        
        saveUsers();
        
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
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));