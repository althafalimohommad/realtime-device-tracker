const socket = io();

let deviceName = localStorage.getItem('deviceName');
let currentUser = null;
let encryptionKey = null;
const devices = new Map();

// Device detection utility
function detectDevice() {
    const ua = navigator.userAgent;
    let deviceType = 'Unknown Device';
    let deviceIcon = '📱';
    
    // Detect if mobile or desktop
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua);
    
    if (isMobile && !isTablet) {
        deviceIcon = '📱';
        
        // Try to detect specific phone models
        if (ua.includes('iPhone')) {
            // Extract iPhone model
            const match = ua.match(/iPhone\s*([\d,]+)?/);
            deviceType = match ? 'iPhone' : 'iPhone';
            if (ua.includes('iPhone15')) deviceType = 'iPhone 15';
            else if (ua.includes('iPhone14')) deviceType = 'iPhone 14';
            else if (ua.includes('iPhone13')) deviceType = 'iPhone 13';
        } else if (ua.includes('Samsung') || ua.includes('SM-')) {
            // Samsung devices
            if (ua.includes('SM-S928')) deviceType = 'Samsung Galaxy S24 Ultra';
            else if (ua.includes('SM-S926')) deviceType = 'Samsung Galaxy S24+';
            else if (ua.includes('SM-S921')) deviceType = 'Samsung Galaxy S24';
            else if (ua.includes('SM-S918')) deviceType = 'Samsung Galaxy S23 Ultra';
            else if (ua.includes('SM-S916')) deviceType = 'Samsung Galaxy S23+';
            else if (ua.includes('SM-S911')) deviceType = 'Samsung Galaxy S23';
            else if (ua.includes('SM-')) {
                const smMatch = ua.match(/SM-([A-Z0-9]+)/);
                deviceType = smMatch ? `Samsung ${smMatch[1]}` : 'Samsung Phone';
            } else {
                deviceType = 'Samsung Phone';
            }
        } else if (ua.includes('Pixel')) {
            // Google Pixel
            const match = ua.match(/Pixel\s*(\d+\s*\w*)/);
            deviceType = match ? `Google Pixel ${match[1]}` : 'Google Pixel';
        } else if (ua.includes('OnePlus') || ua.includes('ONEPLUS')) {
            const match = ua.match(/ONEPLUS\s*([A-Z0-9]+)/i);
            deviceType = match ? `OnePlus ${match[1]}` : 'OnePlus Phone';
        } else if (ua.includes('Xiaomi') || ua.includes('Mi ') || ua.includes('Redmi')) {
            if (ua.includes('Redmi')) {
                const match = ua.match(/Redmi\s*([A-Z0-9\s]+)/i);
                deviceType = match ? `Xiaomi Redmi ${match[1].trim()}` : 'Xiaomi Redmi';
            } else {
                const match = ua.match(/Mi\s*([A-Z0-9\s]+)/i);
                deviceType = match ? `Xiaomi Mi ${match[1].trim()}` : 'Xiaomi Phone';
            }
        } else if (ua.includes('Huawei')) {
            const match = ua.match(/Huawei\s*([A-Z0-9\s]+)/i);
            deviceType = match ? `Huawei ${match[1].trim()}` : 'Huawei Phone';
        } else if (ua.includes('Android')) {
            deviceType = 'Android Phone';
        } else {
            deviceType = 'Mobile Phone';
        }
    } else if (isTablet) {
        deviceIcon = '📲';
        if (ua.includes('iPad')) {
            if (ua.includes('iPad Pro')) deviceType = 'iPad Pro';
            else if (ua.includes('iPad Air')) deviceType = 'iPad Air';
            else if (ua.includes('iPad Mini')) deviceType = 'iPad Mini';
            else deviceType = 'iPad';
        } else {
            deviceType = 'Tablet';
        }
    } else {
        // Desktop/Laptop detection
        deviceIcon = '💻';
        
        if (ua.includes('Windows NT 10')) deviceType = 'Windows 11 PC';
        else if (ua.includes('Windows NT 6.3')) deviceType = 'Windows 8.1 PC';
        else if (ua.includes('Windows NT 6.2')) deviceType = 'Windows 8 PC';
        else if (ua.includes('Windows NT 6.1')) deviceType = 'Windows 7 PC';
        else if (ua.includes('Windows')) deviceType = 'Windows PC';
        else if (ua.includes('Mac OS X')) {
            const match = ua.match(/Mac OS X\s*([\d_]+)?/);
            deviceType = 'MacBook';
            if (match) {
                const version = match[1]?.replace(/_/g, '.');
                if (version && parseFloat(version) >= 11) deviceType = 'MacBook (Apple Silicon)';
            }
        } else if (ua.includes('Linux')) deviceType = 'Linux PC';
        else if (ua.includes('CrOS')) deviceType = 'Chromebook';
        else deviceType = 'Computer';
    }
    
    return { name: deviceType, icon: deviceIcon };
}

// Fetch current user info
fetch('/api/user')
    .then(res => res.json())
    .then(async user => {
        currentUser = user;
        console.log('Logged in as:', user.email);
        console.log('Registered devices:', user.registeredDevices);
        
        // Initialize registeredDevices array if it doesn't exist
        if (!currentUser.registeredDevices) {
            currentUser.registeredDevices = [];
        }
        
        // Check if user has registered devices
        if (currentUser.registeredDevices.length === 0) {
            // Redirect to register device if no devices registered
            if (window.location.pathname === '/tracker') {
                alert('Please register this device first to use Find Device feature.');
                window.location.href = '/register-device';
                return;
            }
        }
        
        // Initialize encryption key for this user
        encryptionKey = await encryption.getOrCreateKey(currentUser.id);
        console.log('🔐 End-to-end encryption enabled');
        
        // Check if THIS device is registered
        const userAgent = navigator.userAgent;
        const isThisDeviceRegistered = currentUser.registeredDevices.some(d => d.fingerprint === userAgent);
        
        // Always load and show registered devices first
        loadRegisteredDevicesLocations();
        
        if (!isThisDeviceRegistered && window.location.pathname === '/tracker') {
            const hasOtherDevices = currentUser.registeredDevices && currentUser.registeredDevices.length > 0;
            const message = hasOtherDevices 
                ? `This device is not registered yet.\n\nYou have ${currentUser.registeredDevices.length} other registered device(s) that you can track.\n\nWould you like to register this device as well?`
                : 'This device is not registered. Would you like to register it now?';
            
            // Delay the prompt to allow map to load first
            setTimeout(() => {
                if (confirm(message)) {
                    window.location.href = '/register-device';
                }
            }, 1000);
        }
        
        initializeDevice();
    })
    .catch(err => {
        console.error('Not authenticated:', err);
        window.location.href = '/login';
    });

async function initializeDevice() {
    // Request location permission first
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser.");
        return;
    }

    // Check if THIS device is registered
    const userAgent = navigator.userAgent;
    const registeredDevice = currentUser.registeredDevices?.find(d => d.fingerprint === userAgent);
    
    if (!registeredDevice) {
        console.warn('⚠️ This device is not registered. Location will not be tracked.');
        deviceName = detectDevice().name;
        localStorage.setItem('deviceName', deviceName);
        
        // Register device but don't track location
        const detectedDevice = detectDevice();
        const deviceInfo = {
            battery: null,
            charging: false,
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            deviceType: detectedDevice.name,
            deviceIcon: detectedDevice.icon,
            isRegistered: false
        };
        
        socket.emit("register-device", { 
            name: deviceName, 
            userId: currentUser.id,
            deviceInfo: deviceInfo,
            isRegistered: false
        });
        
        return; // Don't track location for unregistered devices
    }

    // Request location permission for registered devices only
    try {
        await requestLocationPermission();
    } catch (error) {
        console.error('Location permission denied:', error);
        alert('Please enable location access to use Find My Device.\n\nGo to browser settings → Site permissions → Location → Allow');
        return;
    }

    // Use registered device name
    deviceName = registeredDevice.name;
    console.log(`📱 Using registered device: ${deviceName}`);
    localStorage.setItem('deviceName', deviceName);

    // Get device information
    async function getDeviceInfo() {
        const detectedDevice = detectDevice();
        const info = {
            battery: null,
            charging: false,
            platform: navigator.platform,
            userAgent: navigator.userAgent,
            screenResolution: `${screen.width}x${screen.height}`,
            connection: null,
            deviceType: detectedDevice.name,
            deviceIcon: detectedDevice.icon
        };

        // Get battery info
        if ('getBattery' in navigator) {
            try {
                const battery = await navigator.getBattery();
                info.battery = Math.round(battery.level * 100);
                info.charging = battery.charging;
            } catch (err) {
                console.log('Battery API not available');
            }
        }

        // Get connection info
        if ('connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator) {
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            info.connection = conn.effectiveType || conn.type || 'unknown';
        }

        return info;
    }

    // Register device with user ID and device info
    getDeviceInfo().then(deviceInfo => {
        deviceInfo.isRegistered = true; // Mark as registered
        
        socket.emit("register-device", { 
            name: deviceName, 
            userId: currentUser.id,
            deviceInfo: deviceInfo,
            isRegistered: true
        });
        
        // Start location tracking immediately after registration
        startLocationTracking();
    });
}

// Request location permission
async function requestLocationPermission() {
    return new Promise((resolve, reject) => {
        // Check if permission was already granted
        if (navigator.permissions) {
            navigator.permissions.query({ name: 'geolocation' }).then((result) => {
                if (result.state === 'granted') {
                    // Permission already granted, get location
                    navigator.geolocation.getCurrentPosition(resolve, reject, {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    });
                } else {
                    // Show permission modal
                    showPermissionModal(resolve, reject);
                }
            }).catch(() => {
                // Fallback if permissions API not available
                showPermissionModal(resolve, reject);
            });
        } else {
            // Fallback for browsers without permissions API
            showPermissionModal(resolve, reject);
        }
    });
}

// Show location permission modal
function showPermissionModal(resolve, reject) {
    const modal = document.getElementById('permission-modal');
    if (modal) {
        modal.style.display = 'flex';
        
        document.getElementById('allow-location-btn').onclick = () => {
            modal.style.display = 'none';
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    console.log('✅ Location permission granted');
                    resolve(position);
                },
                (error) => {
                    console.error('❌ Location permission denied:', error);
                    modal.style.display = 'none';
                    alert('Location access denied. Please enable it in your browser settings:\n\n1. Click the lock icon in the address bar\n2. Find Location permissions\n3. Select "Allow"');
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                }
            );
        };
        
        document.getElementById('deny-location-btn').onclick = () => {
            modal.style.display = 'none';
            alert('Location access is required to use Find My Device. You can enable it later in browser settings.');
            reject(new Error('User denied location permission'));
        };
    } else {
        // Fallback if modal not found
        navigator.geolocation.getCurrentPosition(
            (position) => {
                console.log('✅ Location permission granted');
                resolve(position);
            },
            (error) => {
                console.error('❌ Location permission denied:', error);
                reject(error);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    }
}

// Start continuous location tracking
function startLocationTracking() {
    console.log('🌍 Starting location tracking...');
    
    // Send initial location immediately
    sendCurrentLocation();
    
    // Update location every 1 minute (60000 ms)
    setInterval(() => {
        sendCurrentLocation();
        console.log('🔄 Updating location (every 1 minute)');
    }, 60000);
    
    // Also watch position for real-time updates
    if (navigator.geolocation) {
        const watchId = navigator.geolocation.watchPosition(
            async (position) => {
                const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
                
                // Log accuracy for debugging
                console.log(`📍 Location update - Accuracy: ${accuracy}m, Lat: ${latitude}, Lng: ${longitude}`);
                
                // Get current device info
                const deviceInfo = await getDeviceInfo();
                
                // Encrypt location data before sending
                const encryptedLocation = await encryption.encrypt(
                    { 
                        latitude, 
                        longitude, 
                        accuracy,
                        altitude,
                        speed,
                        heading,
                        timestamp: Date.now(),
                        battery: deviceInfo.battery,
                        charging: deviceInfo.charging,
                        connection: deviceInfo.connection
                    },
                    encryptionKey
                );
                
                const locationData = { 
                    encrypted: encryptedLocation,
                    battery: deviceInfo.battery,
                    charging: deviceInfo.charging,
                    latitude: latitude,  // Always send for database storage
                    longitude: longitude,
                    accuracy: accuracy
                };
                
                socket.emit("send-location", locationData);
            },
            (error) => {
                console.error('Geolocation error:', error);
                let errorMsg = "Location access error. ";
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMsg += "Please allow location access in your browser settings.";
                        showToast('Location permission denied. Please enable it in browser settings.');
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMsg += "Location information unavailable. Make sure GPS is enabled.";
                        break;
                    case error.TIMEOUT:
                        errorMsg += "Location request timed out. Trying again...";
                        break;
                }
                console.warn(errorMsg);
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 30000, // Accept cached position up to 30 seconds old
            }
        );
        
        // Store watchId for cleanup if needed
        window.locationWatchId = watchId;
    } else {
        alert("Geolocation is not supported by your browser.");
    }
}

// Helper function to get device info (needed for location tracking)
async function getDeviceInfo() {
    const detectedDevice = detectDevice();
    const info = {
        battery: null,
        charging: false,
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        screenResolution: `${screen.width}x${screen.height}`,
        connection: null,
        deviceType: detectedDevice.name,
        deviceIcon: detectedDevice.icon
    };

    // Get battery info
    if ('getBattery' in navigator) {
        try {
            const battery = await navigator.getBattery();
            info.battery = Math.round(battery.level * 100);
            info.charging = battery.charging;
        } catch (err) {
            console.log('Battery API not available');
        }
    }

    // Get connection info
    if ('connection' in navigator || 'mozConnection' in navigator || 'webkitConnection' in navigator) {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        info.connection = conn.effectiveType || conn.type || 'unknown';
    }

    return info;
}

// Setup geolocation with encryption and device info (REMOVED - now using startLocationTracking)
/*
if (navigator.geolocation) {
    // This code is now handled by startLocationTracking()
}
*/

// Initialize map
const map = L.map("map").setView([0, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
}).addTo(map);

const markers = {};

// Function to send current location immediately
async function sendCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async (position) => {
                const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
                console.log(`📍 Sending current location - Accuracy: ${accuracy}m, Lat: ${latitude.toFixed(5)}, Lng: ${longitude.toFixed(5)}`);
                
                const deviceInfo = await getDeviceInfo();
                const encryptedLocation = await encryption.encrypt(
                    { 
                        latitude, longitude, accuracy, altitude, speed, heading,
                        timestamp: Date.now(),
                        battery: deviceInfo.battery,
                        charging: deviceInfo.charging,
                        connection: deviceInfo.connection
                    },
                    encryptionKey
                );
                
                const locationData = { 
                    encrypted: encryptedLocation,
                    battery: deviceInfo.battery,
                    charging: deviceInfo.charging,
                    latitude: latitude,  // Always include for database storage
                    longitude: longitude,
                    accuracy: accuracy
                };
                
                const currentDevice = devices.get(socket.id);
                if (currentDevice?.isSharing) {
                    locationData.latitude = latitude;
                    locationData.longitude = longitude;
                }
                
                socket.emit("send-location", locationData);
            },
            (error) => {
                console.error('Failed to get current location:', error);
                showToast('Unable to get location. Please check permissions.');
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    }
}

// Listen for location requests from other devices
socket.on("location-requested", (requesterId) => {
    console.log(`📍 Location requested by device ${requesterId}`);
    sendCurrentLocation();
});

// Receive encrypted location updates
socket.on("receive-location", async (data) => {
    const { id, encrypted, battery, charging } = data;
    
    try {
        // Decrypt location data
        const decrypted = await encryption.decrypt(encrypted, encryptionKey);
        const { latitude, longitude, timestamp, accuracy, speed, altitude, connection } = decrypted;
        
        // Update device object with location data for locate feature
        const device = devices.get(id);
        if (device) {
            device.latitude = latitude;
            device.longitude = longitude;
            device.battery = battery;
            device.charging = charging;
            device.lastSeen = Date.now();
            device.isOffline = false; // Mark as online when receiving location
        }
        
        // Battery icon and color
        const getBatteryIcon = (level, isCharging) => {
            if (isCharging) return '🔌';
            if (level > 80) return '🔋';
            if (level > 50) return '🔋';
            if (level > 20) return '🪫';
            return '🪫';
        };
        
        const getBatteryColor = (level) => {
            if (level > 50) return '#10b981';
            if (level > 20) return '#f59e0b';
            return '#ef4444';
        };
        
        if (markers[id]) {
            markers[id].setLatLng([latitude, longitude]);
            // Update popup with new info
            const deviceInfo = devices.get(id);
            const name = deviceInfo ? deviceInfo.name : `Device ${id.substring(0, 5)}`;
            const timeAgo = new Date(timestamp).toLocaleTimeString();
            const batteryDisplay = battery !== null ? 
                `<span style="color: ${getBatteryColor(battery)}">${getBatteryIcon(battery, charging)} ${battery}%</span>` : 
                'N/A';
            
            markers[id].setPopupContent(`
                <div class="device-popup">
                    <b>${name}</b> 🔐<br>
                    <div class="popup-info">
                        <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" style="color: #1a73e8; text-decoration: none;">📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</a><br>
                        ${battery !== null ? `${batteryDisplay}${charging ? ' (Charging)' : ''}<br>` : ''}
                        ${accuracy ? `📏 Accuracy: ±${Math.round(accuracy)}m<br>` : ''}
                        ${speed && speed > 0 ? `🚗 Speed: ${(speed * 3.6).toFixed(1)} km/h<br>` : ''}
                        ${connection ? `📶 ${connection.toUpperCase()}<br>` : ''}
                        ⏰ ${timeAgo}
                    </div>
                </div>
            `);
        } else {
            const marker = L.marker([latitude, longitude]).addTo(map);
            const deviceInfo = devices.get(id);
            const name = deviceInfo ? deviceInfo.name : `Device ${id.substring(0, 5)}`;
            const timeAgo = new Date(timestamp).toLocaleTimeString();
            const batteryDisplay = battery !== null ? 
                `<span style="color: ${getBatteryColor(battery)}">${getBatteryIcon(battery, charging)} ${battery}%</span>` : 
                'N/A';
            
            marker.bindPopup(`
                <div class="device-popup">
                    <b>${name}</b> 🔐<br>
                    <div class="popup-info">
                        <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" style="color: #1a73e8; text-decoration: none;">📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</a><br>
                        ${battery !== null ? `${batteryDisplay}${charging ? ' (Charging)' : ''}<br>` : ''}
                        ${accuracy ? `📏 Accuracy: ±${Math.round(accuracy)}m<br>` : ''}
                        ${speed && speed > 0 ? `🚗 Speed: ${(speed * 3.6).toFixed(1)} km/h<br>` : ''}
                        ${connection ? `📶 ${connection.toUpperCase()}<br>` : ''}
                        ⏰ ${timeAgo}
                    </div>
                </div>
            `);
            markers[id] = marker;
            
            // Auto zoom to own location
            if (id === socket.id) {
                map.setView([latitude, longitude], 16);
            }
        }
    } catch (error) {
        console.error('Failed to decrypt location:', error);
    }
});

// Handle location updates from API (background tracking)
socket.on('location-updated', (data) => {
    console.log('📍 Location updated from API:', data);
    const { deviceId, deviceName, latitude, longitude, accuracy, timestamp } = data;
    
    // Update device in map
    let device = devices.get(deviceId);
    if (!device) {
        // Create device entry if it doesn't exist
        device = {
            id: deviceId,
            name: deviceName,
            isRegistered: true,
            userId: currentUser.id,
            deviceIcon: '📱',
            latitude,
            longitude,
            lastSeen: timestamp,
            battery: null,
            charging: false
        };
        devices.set(deviceId, device);
    } else {
        // Update existing device
        device.latitude = latitude;
        device.longitude = longitude;
        device.lastSeen = timestamp;
    }
    
    // Add or update marker
    addOrUpdateMarker(deviceId, {
        latitude,
        longitude,
        accuracy,
        battery: device.battery,
        charging: device.charging,
        timestamp
    });
    
    // Update device list
    updateDeviceList();
});

// Handle devices update
socket.on("devices-update", (devicesList) => {
    console.log('Devices update received:', devicesList);
    devicesList.forEach(device => {
        // Check if there's an offline version of this device and remove it
        const offlineKey = `offline_${device.fingerprint}`;
        if (devices.has(offlineKey)) {
            const offlineDevice = devices.get(offlineKey);
            // Preserve location from offline device
            if (offlineDevice.latitude && offlineDevice.longitude) {
                device.latitude = offlineDevice.latitude;
                device.longitude = offlineDevice.longitude;
            }
            // Remove offline marker
            if (markers[offlineKey]) {
                map.removeLayer(markers[offlineKey]);
                delete markers[offlineKey];
            }
            devices.delete(offlineKey);
        }
        
        // Preserve location data if device already exists online
        const existingDevice = devices.get(device.id);
        if (existingDevice && existingDevice.latitude && existingDevice.longitude) {
            device.latitude = existingDevice.latitude;
            device.longitude = existingDevice.longitude;
        }
        // Add lastSeen timestamp and mark as online
        device.lastSeen = Date.now();
        device.isOffline = false; // Mark as online since it's actively connected
        devices.set(device.id, device);
    });
    
    // Mark devices not in the update list as offline (but don't remove them)
    const onlineDeviceIds = new Set(devicesList.map(d => d.id));
    devices.forEach((device, id) => {
        if (!onlineDeviceIds.has(id) && device.isOffline !== true && !id.startsWith('offline_')) {
            // Device was online but now disconnected - mark as offline
            device.isOffline = true;
            devices.set(id, device);
        }
    });
    
    updateDeviceList();
    
    // Auto-select first device if none selected
    if (!selectedDeviceId && devices.size > 0) {
        const firstDeviceId = devices.keys().next().value;
        selectDevice(firstDeviceId);
    }
});

// Handle user disconnection
socket.on("user-disconnected", (id) => {
    const device = devices.get(id);
    
    if (device && device.fingerprint) {
        // Convert online device to offline with new key
        const offlineKey = `offline_${device.fingerprint}`;
        device.isOffline = true;
        device.lastSeen = Date.now();
        
        // Move to offline key
        devices.set(offlineKey, device);
        devices.delete(id);
        
        // Update marker to show offline status
        if (markers[id]) {
            // Remove old marker
            map.removeLayer(markers[id]);
            delete markers[id];
            
            // Add new offline marker if device has location
            if (device.latitude && device.longitude) {
                addOrUpdateMarker(offlineKey, {
                    latitude: device.latitude,
                    longitude: device.longitude,
                    accuracy: device.accuracy || 50,
                    battery: device.battery,
                    charging: device.charging,
                    timestamp: device.lastSeen,
                    isOffline: true
                });
            }
        }
        
        console.log(`Device ${id} went offline, moved to ${offlineKey}`);
    } else {
        // No fingerprint, just remove (shouldn't happen for registered devices)
        if (markers[id]) {
            map.removeLayer(markers[id]);
            delete markers[id];
        }
        devices.delete(id);
    }
    
    updateDeviceList();
});

// Handle alert
socket.on("play-alert", () => {
    playAlertSound();
    showAlertNotification();
});

// Update device list UI with Google Find Hub style
let selectedDeviceId = null;

function updateDeviceList() {
    const list = document.getElementById('device-list');
    list.innerHTML = '';
    
    // Only show devices belonging to current user AND are registered
    const userDevices = Array.from(devices.values()).filter(d => {
        const isUserDevice = d.userId === currentUser.id;
        const isRegistered = d.isRegistered === true;
        return isUserDevice && isRegistered;
    });
    
    if (userDevices.length === 0) {
        list.innerHTML = `
            <div style="padding: 20px; text-align: center; color: #5f6368;">
                <i class="material-icons" style="font-size: 48px; color: #dadce0; margin-bottom: 12px;">devices</i>
                <p style="margin-bottom: 16px;">No registered devices online</p>
                <a href="/register-device" style="display: inline-block; padding: 10px 20px; background: #1a73e8; color: white; text-decoration: none; border-radius: 8px; font-size: 14px;">
                    Register Another Device
                </a>
            </div>
        `;
        return;
    }
    
    userDevices.forEach((device, index) => {
        const item = document.createElement('div');
        item.className = 'device-item';
        if (device.id === selectedDeviceId) {
            item.classList.add('selected');
        }
        
        // Device icon
        const deviceIcon = device.deviceIcon || '📱';
        
        // Time ago
        const timeAgo = device.lastSeen ? getTimeAgo(device.lastSeen) : 'just now';
        
        // Battery info
        const batteryPercent = device.battery !== null ? `${device.battery}%` : '';
        
        // Mark current device
        const isCurrentDevice = device.id === socket.id;
        const isOffline = device.isOffline === true;
        const statusColor = isOffline ? '#888' : '#1e8e3e';
        const statusText = isOffline ? 'Offline' : 'Online';
        
        item.innerHTML = `
            <div class="device-icon">${deviceIcon}</div>
            <div class="device-item-info">
                <div class="device-item-name">
                    ${device.name}${isCurrentDevice ? ' (This device)' : ''}
                    <span style="color: ${statusColor}; font-size: 0.85em; margin-left: 8px;">● ${statusText}</span>
                </div>
                <div class="device-item-status">Last seen ${timeAgo}</div>
                ${device.battery !== null ? `<div class="device-item-battery">${batteryPercent}</div>` : ''}
            </div>
        `;
        
        item.onclick = () => selectDevice(device.id);
        list.appendChild(item);
    });
    
    // Auto-select first device if none selected
    if (!selectedDeviceId && userDevices.length > 0) {
        selectDevice(userDevices[0].id);
    }
}

// Load registered devices from database and show their last known locations
async function loadRegisteredDevicesLocations() {
    console.log('📍 Loading last known device locations from database...');
    
    try {
        const response = await fetch('/api/last-known-locations');
        const data = await response.json();
        
        console.log('API Response:', data); // Debug log
        
        if (!data.devices || data.devices.length === 0) {
            console.log('No devices with saved locations found');
            return;
        }
        
        console.log(`Found ${data.devices.length} devices with last known locations`);
        console.log('Devices from API:', data.devices); // Debug log
        
        data.devices.forEach(device => {
            console.log('Processing offline device:', device); // Debug log
            
            // Use fingerprint-based key for offline devices to enable matching when they come online
            const deviceKey = `offline_${device.fingerprint}`;
            
            // Check if this device is already online by fingerprint
            let isAlreadyOnline = false;
            devices.forEach((dev, key) => {
                if (dev.fingerprint === device.fingerprint && !key.startsWith('offline_')) {
                    isAlreadyOnline = true;
                    console.log(`Device ${device.name} is already online, skipping offline version`);
                }
            });
            
            // Only add if not already online
            if (!isAlreadyOnline) {
                const deviceData = {
                    id: device.id,
                    fingerprint: device.fingerprint,
                    name: device.name,
                    deviceIcon: device.icon || '📱',
                    deviceType: device.type || device.name,
                    isRegistered: true,
                    userId: currentUser.id,
                    latitude: device.latitude,
                    longitude: device.longitude,
                    lastSeen: device.lastSeen,
                    battery: device.battery,
                    charging: device.charging,
                    isOffline: true // Mark as offline
                };
                devices.set(deviceKey, deviceData);
                console.log(`Added offline device: ${deviceKey}`, deviceData);
                
                // Add marker to map with offline indicator
                addOrUpdateMarker(deviceKey, {
                    latitude: device.latitude,
                    longitude: device.longitude,
                    accuracy: device.accuracy || 50,
                    battery: device.battery,
                    charging: device.charging,
                    timestamp: device.lastSeen,
                    isOffline: true
                });
                console.log(`Added marker for offline device: ${device.name}`);
            }
        });
        
        // Update device list to show both online and offline devices
        updateDeviceList();
    } catch (error) {
        console.error('Error loading last known locations:', error);
    }
}

// Helper function to add or update marker on map
function addOrUpdateMarker(deviceId, locationData) {
    const { latitude, longitude, accuracy, battery, charging, timestamp, isOffline } = locationData;
    
    if (!latitude || !longitude) {
        console.warn('Cannot add marker: missing coordinates');
        return;
    }
    
    console.log(`Adding/updating marker for device ${deviceId} at ${latitude}, ${longitude}`);
    
    const device = devices.get(deviceId);
    const name = device ? device.name : `Device ${deviceId.substring(0, 5)}`;
    const timeAgo = timestamp ? (isOffline ? `Last seen: ${getTimeAgo(new Date(timestamp))}` : new Date(timestamp).toLocaleTimeString()) : 'Unknown';
    const batteryDisplay = battery !== null ? 
        `<span style="color: ${getBatteryColor(battery)}">${getBatteryIcon(battery, charging)} ${battery}%</span>` : 
        'N/A';
    
    const popupContent = `
        <div class="device-popup">
            <b>${name}</b> ${isOffline ? '<span style="color: #888; font-size: 0.9em;">(Offline)</span>' : '<span style="color: #4CAF50; font-size: 0.9em;">(Online)</span>'}<br>
            <div class="popup-info">
                <a href="https://www.google.com/maps?q=${latitude},${longitude}" target="_blank" style="color: #1a73e8; text-decoration: none;">📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}</a><br>
                ${battery !== null ? `${batteryDisplay}${charging ? ' (Charging)' : ''}<br>` : ''}
                ${accuracy ? `📏 Accuracy: ±${Math.round(accuracy)}m<br>` : ''}
                ⏰ ${timeAgo}
            </div>
        </div>
    `;
    
    if (markers[deviceId]) {
        // Update existing marker
        markers[deviceId].setLatLng([latitude, longitude]);
        markers[deviceId].setPopupContent(popupContent);
        
        // Change marker icon for offline devices (gray)
        if (isOffline && markers[deviceId].setOpacity) {
            markers[deviceId].setOpacity(0.6);
        }
    } else {
        // Create new marker
        const marker = L.marker([latitude, longitude], {
            opacity: isOffline ? 0.6 : 1.0
        }).addTo(map);
        
        marker.bindPopup(popupContent);
        markers[deviceId] = marker;
        
        // Auto zoom to first marker
        if (Object.keys(markers).length === 1) {
            map.setView([latitude, longitude], 16);
        }
    }
}

function selectDevice(deviceId) {
    selectedDeviceId = deviceId;
    updateDeviceList();
    showDeviceDetails(deviceId);
    locateDevice(deviceId);
}

function showDeviceDetails(deviceId) {
    const device = devices.get(deviceId);
    if (!device) return;
    
    const detailsContainer = document.getElementById('device-details');
    const deviceIcon = device.deviceIcon || '📱';
    const timeAgo = device.lastSeen ? getTimeAgo(device.lastSeen) : 'just now';
    const batteryIcon = device.charging ? 'battery_charging_full' : 'battery_std';
    const networkInfo = device.deviceInfo?.connection || 'WiFi';
    const isOffline = device.isOffline === true;
    const statusText = isOffline ? 'Offline - Last Known Location' : 'Online';
    const statusColor = isOffline ? '#888' : '#1e8e3e';
    
    detailsContainer.innerHTML = `
        <div class="device-header">
            <div style="font-size: 64px;">${deviceIcon}</div>
            <div class="device-info-header">
                <h2 class="device-name">${device.name}</h2>
                <div class="device-status">
                    <span style="color: ${statusColor};">● ${statusText}</span> • <span>Last seen ${timeAgo}</span>
                </div>
                <div class="device-meta">
                    ${device.battery !== null ? `
                        <div class="battery-info">
                            <i class="material-icons">${batteryIcon}</i>
                            <span>${device.battery}%</span>
                        </div>
                    ` : ''}
                    <div>${networkInfo}</div>
                </div>
            </div>
        </div>
        <div class="device-actions-panel">
            <button class="action-btn" onclick="copyLocation('${deviceId}')" style="background: #1a73e8; color: white; width: 100%; margin-bottom: 12px;">
                <i class="material-icons">content_copy</i>
                <span class="action-btn-text">Copy Location</span>
            </button>
            <button class="action-btn" onclick="unregisterDevice('${deviceId}')" style="background: #ea4335; color: white; width: 100%;">
                <i class="material-icons">delete</i>
                <span class="action-btn-text">Unregister Device</span>
            </button>
            <p style="font-size: 12px; color: #5f6368; margin-top: 12px; text-align: center; padding: 0 16px;">
                💡 Paste the copied coordinates in Google Maps to get the exact location of your device
            </p>
        </div>
    `;
}

function getTimeAgo(timestamp) {
    if (!timestamp) return 'just now';
    
    // Handle both Date objects and timestamp numbers and ISO strings
    let timestampMs;
    if (typeof timestamp === 'string') {
        timestampMs = new Date(timestamp).getTime();
    } else if (typeof timestamp === 'number') {
        timestampMs = timestamp;
    } else if (timestamp instanceof Date) {
        timestampMs = timestamp.getTime();
    } else {
        return 'just now';
    }
    
    if (isNaN(timestampMs)) return 'just now';
    
    const seconds = Math.floor((Date.now() - timestampMs) / 1000);
    if (seconds < 0 || seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}

function copyLocation(deviceId) {
    const device = devices.get(deviceId);
    let latitude = device?.latitude;
    let longitude = device?.longitude;
    
    // If not in devices map, check currentUser.registeredDevices
    if ((latitude == null || longitude == null) && currentUser && currentUser.registeredDevices) {
        const registeredDevice = currentUser.registeredDevices.find(d => d.id === deviceId);
        if (registeredDevice) {
            latitude = registeredDevice.latitude;
            longitude = registeredDevice.longitude;
        }
    }
    
    // If still not found, try to get from marker
    if ((latitude == null || longitude == null) && markers[deviceId]) {
        const markerLatLng = markers[deviceId].getLatLng();
        latitude = markerLatLng.lat;
        longitude = markerLatLng.lng;
    }
    
    if (latitude == null || longitude == null) {
        const deviceName = device?.name || 'This device';
        if (device?.isOffline) {
            showToast(`⚠️ ${deviceName} hasn't sent location yet. Open the app on that device to track its location.`);
        } else {
            showToast('❌ Location not available for this device');
        }
        return;
    }
    
    const locationText = `${latitude}, ${longitude}`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(locationText).then(() => {
        showToast('✅ Location copied! Paste in Google Maps to view');
    }).catch(err => {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = locationText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('✅ Location copied! Paste in Google Maps to view');
        } catch (err) {
            showToast('❌ Failed to copy location');
        }
        document.body.removeChild(textArea);
    });
}

async function unregisterDevice(deviceId) {
    const device = devices.get(deviceId);
    let deviceName = device?.name;
    
    // If not in devices map, check currentUser.registeredDevices
    if (!deviceName && currentUser && currentUser.registeredDevices) {
        const registeredDevice = currentUser.registeredDevices.find(d => d.id === deviceId);
        if (registeredDevice) {
            deviceName = registeredDevice.name;
        }
    }
    
    if (!deviceName) {
        showToast('❌ Device not found');
        return;
    }
    
    // Confirmation dialog
    const confirmed = confirm(`Are you sure you want to unregister "${deviceName}"?\n\nThis will:\n• Remove the device from your account\n• Stop location tracking\n• Remove device from the map\n\nThis action cannot be undone.`);
    
    if (!confirmed) {
        return;
    }
    
    try {
        const response = await fetch('/api/unregister-device', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ deviceId })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showToast('✅ Device unregistered successfully');
            
            // Remove from local devices map
            devices.delete(deviceId);
            
            // Remove marker from map
            if (markers[deviceId]) {
                map.removeLayer(markers[deviceId]);
                delete markers[deviceId];
            }
            
            // Update currentUser.registeredDevices
            if (currentUser && currentUser.registeredDevices) {
                currentUser.registeredDevices = currentUser.registeredDevices.filter(d => d.id !== deviceId);
            }
            
            // Clear selection if this was the selected device
            if (selectedDeviceId === deviceId) {
                selectedDeviceId = null;
                document.getElementById('device-details').innerHTML = `
                    <div class="no-device-selected">
                        <i class="material-icons">devices</i>
                        <p>Select a device to view details</p>
                    </div>
                `;
            }
            
            // Update device list
            updateDeviceList();
            
            // Reload page after 1 second to refresh everything
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } else {
            showToast('❌ Failed to unregister device: ' + result.message);
        }
    } catch (error) {
        showToast('❌ Error unregistering device: ' + error.message);
    }
}

function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function showDevicesTab() {
    document.querySelector('.devices-tab').classList.add('active');
    document.querySelector('.people-tab').classList.remove('active');
}

function showPeopleTab() {
    document.querySelector('.people-tab').classList.add('active');
    document.querySelector('.devices-tab').classList.remove('active');
    showToast('People sharing feature coming soon');
}

function refreshDevices() {
    location.reload();
}

// Map type toggle
document.addEventListener('DOMContentLoaded', () => {
    const mapTypeBtns = document.querySelectorAll('.map-type-btn');
    mapTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            mapTypeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            if (btn.dataset.type === 'satellite') {
                // Switch to satellite view
                map.eachLayer(layer => {
                    if (layer instanceof L.TileLayer) {
                        map.removeLayer(layer);
                    }
                });
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    attribution: 'Esri, DigitalGlobe, GeoEye, Earthstar Geographics'
                }).addTo(map);
            } else {
                // Switch to map view
                map.eachLayer(layer => {
                    if (layer instanceof L.TileLayer) {
                        map.removeLayer(layer);
                    }
                });
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: 'OpenStreetMap'
                }).addTo(map);
            }
        });
    });
    
    // Mobile device panel dragging
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        const panel = document.getElementById('device-sidebar');
        const panelHeader = panel.querySelector('.panel-header');
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        
        panelHeader.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            isDragging = true;
        });
        
        panelHeader.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;
            
            if (deltaY > 50) {
                panel.classList.add('minimized');
            } else if (deltaY < -50) {
                panel.classList.remove('minimized');
            }
        });
        
        panelHeader.addEventListener('touchend', () => {
            isDragging = false;
        });
    }
    
    // Auto-detect device type and adjust UI
    detectDeviceAndAdjustUI();
});

function detectDeviceAndAdjustUI() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(navigator.userAgent);
    
    if (isMobile && !isTablet) {
        document.body.classList.add('mobile-device');
        // Add minimize button behavior for mobile
        const panel = document.getElementById('device-sidebar');
        if (panel) {
            panel.classList.add('minimized');
        }
    } else if (isTablet) {
        document.body.classList.add('tablet-device');
    } else {
        document.body.classList.add('desktop-device');
    }
}

// Locate device on map
function locateDevice(deviceId) {
    const device = devices.get(deviceId);
    console.log('Locating device:', deviceId, device);
    
    if (device && device.latitude && device.longitude) {
        console.log(`Zooming to: ${device.latitude}, ${device.longitude}`);
        map.setView([device.latitude, device.longitude], 18);
        if (markers[deviceId]) {
            markers[deviceId].openPopup();
        }
    } else if (markers[deviceId]) {
        // If device object doesn't have location but marker exists, use marker position
        console.log('Using marker position for location');
        const markerLatLng = markers[deviceId].getLatLng();
        map.setView([markerLatLng.lat, markerLatLng.lng], 18);
        markers[deviceId].openPopup();
    } else if (device && device.isOffline) {
        // Device is offline and no location available
        alert(`${device.name} is offline and no last known location is available.`);
    } else {
        console.warn('Device location not available, requesting fresh location');
        // Request fresh location from the device (only for online devices)
        socket.emit("request-location", deviceId);
        
        // Show waiting message
        const notification = document.createElement('div');
        notification.className = 'alert-notification';
        notification.innerHTML = '📍 Requesting location from device...';
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
        
        // Try again after 3 seconds
        setTimeout(() => {
            const updatedDevice = devices.get(deviceId);
            if (updatedDevice && updatedDevice.latitude && updatedDevice.longitude) {
                map.setView([updatedDevice.latitude, updatedDevice.longitude], 18);
                if (markers[deviceId]) {
                    markers[deviceId].openPopup();
                }
            } else if (markers[deviceId]) {
                // Check marker position again
                const markerLatLng = markers[deviceId].getLatLng();
                map.setView([markerLatLng.lat, markerLatLng.lng], 18);
                markers[deviceId].openPopup();
            } else {
                alert("Unable to get location from device. Make sure the device has location enabled and granted permissions.");
            }
        }, 3000);
    }
}

// Alert a device
function alertDevice(deviceId) {
    socket.emit("alert-device", deviceId);
    alert("Alert sent to device!");
}

// Play alert sound
function playAlertSound() {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIGWm98OScTgwOUKnl8LNnHwU0kNXzzn0vBSh+zPDek0MKElyw6OyrWBUIQ5zd8sFuJAUsgs/y2Ik4CBhqvvHinE0MDU+n5O+2aB4ENI7U8s1+MAUngMz05JpPCw5bse/uq1kUCUKa3PO/byQGK4DP8tp/OQgXar/z4JhPDA5OpOPxsmseBDSO1vLMfS8GJn/N8+SaTQsOW7Lv7q1aFAdAmdvy');
    audio.play().catch(e => console.log('Audio play failed:', e));
}

// Show alert notification
function showAlertNotification() {
    const notification = document.createElement('div');
    notification.className = 'alert-notification';
    notification.innerHTML = '🔔 Someone is trying to locate you!';
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.5s';
        setTimeout(() => notification.remove(), 500);
    }, 3000);
}

// Toggle device list
function toggleDeviceList() {
    const sidebar = document.getElementById('device-sidebar');
    sidebar.classList.toggle('collapsed');
}

// Change device name
function changeDeviceName() {
    const newName = prompt("Enter new device name:", deviceName);
    if (newName && newName.trim()) {
        deviceName = newName.trim();
        localStorage.setItem('deviceName', deviceName);
        socket.emit("register-device", { name: deviceName });
    }
}

// Toggle location sharing
function toggleShare() {
    const device = devices.get(socket.id);
    const isCurrentlySharing = device?.isSharing || false;
    
    if (isCurrentlySharing) {
        // Stop sharing
        socket.emit('stop-sharing');
        alert('Location sharing stopped');
    } else {
        // Start sharing
        socket.emit('start-sharing');
    }
}

// Handle share link received
socket.on('share-link', (data) => {
    const shareUrl = `${window.location.origin}/share/${data.token}`;
    
    // Create share modal
    const modal = document.createElement('div');
    modal.className = 'share-modal';
    modal.innerHTML = `
        <div class="share-modal-content">
            <h3>🔗 Share Your Location</h3>
            <p>Anyone with this link can see your real-time location:</p>
            <div class="share-link-container">
                <input type="text" value="${shareUrl}" readonly id="shareLink" class="share-link-input">
                <button onclick="copyShareLink()" class="copy-btn">📋 Copy</button>
            </div>
            <p class="share-warning">⚠️ Only share this link with people you trust. It expires in 24 hours.</p>
            <div class="share-actions">
                <button onclick="closeShareModal()" class="btn-secondary">Close</button>
                <button onclick="toggleShare()" class="btn-danger">Stop Sharing</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
});

// Copy share link to clipboard
function copyShareLink() {
    const input = document.getElementById('shareLink');
    input.select();
    document.execCommand('copy');
    alert('Link copied to clipboard!');
}

// Close share modal
function closeShareModal() {
    const modal = document.querySelector('.share-modal');
    if (modal) modal.remove();
}

// Handle share status updates
socket.on('share-status', (status) => {
    const device = devices.get(socket.id);
    if (device) {
        device.isSharing = status.isSharing;
        updateDeviceList();
    }
    if (!status.isSharing) {
        closeShareModal();
    }
});
