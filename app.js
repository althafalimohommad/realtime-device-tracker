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
const database = require('./database');

const server = http.createServer(app);
const io = socketio(server);

// Store for sharing tokens (token -> {socketId, userId, expiresAt})
const shareTokens = new Map();

// User storage file (fallback)
const USERS_FILE = path.join(__dirname, 'users.json');

// In-memory user cache
let usersDB = {};
let useMongoDb = false;

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

// Update device location in database
async function updateDeviceLocation(userId, fingerprint, locationData) {
    const user = usersDB[userId];
    if (!user || !user.registeredDevices) {
        console.log(`⚠️ Cannot update location: user or registeredDevices not found for ${userId}`);
        return;
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

// API endpoint for Android app to send location updates
app.post('/api/location-update-app', async function(req, res) {
    try {
        const { latitude, longitude, accuracy, deviceName, battery, charging, timestamp } = req.body;
        const userAgent = req.headers['user-agent'];
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        
        const userId = authHeader.replace('Bearer ', '');
        
        console.log(`📱 Android app location update from user ${userId}: ${latitude}, ${longitude}`);
        
        // Update device location in database
        if (userId && userAgent) {
            await updateDeviceLocation(userId, userAgent, {
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
                    latitude: device.latitude,
                    longitude: device.longitude,
                    lastLocationUpdate: device.lastLocationUpdate,
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
    });
}).catch(error => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
});