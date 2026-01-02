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
        
        // Initialize encryption key for this user
        encryptionKey = await encryption.getOrCreateKey(currentUser.id);
        console.log('🔐 End-to-end encryption enabled');
        
        initializeDevice();
    })
    .catch(err => {
        console.error('Not authenticated:', err);
        window.location.href = '/login';
    });

async function initializeDevice() {
    // Auto-detect device if not set
    if (!deviceName) {
        const detectedDevice = detectDevice();
        deviceName = detectedDevice.name;
        localStorage.setItem('deviceName', deviceName);
        console.log(`📱 Auto-detected: ${deviceName}`);
    }

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
        socket.emit("register-device", { 
            name: deviceName, 
            userId: currentUser.id,
            deviceInfo: deviceInfo
        });
    });

    // Setup geolocation with encryption and device info
    if (navigator.geolocation) {
        navigator.geolocation.watchPosition(
            async (position) => {
                const { latitude, longitude, accuracy, altitude, speed, heading } = position.coords;
                
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
                    charging: deviceInfo.charging
                };
                
                // Include plain coordinates if sharing is enabled
                const currentDevice = devices.get(socket.id);
                if (currentDevice?.isSharing) {
                    locationData.latitude = latitude;
                    locationData.longitude = longitude;
                }
                
                socket.emit("send-location", locationData);
            },
            (error) => {
                console.error(error);
                alert("Location access denied. Please enable location services.");
            },
            {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0,
            }
        );
    }
}

// Initialize map
const map = L.map("map").setView([0, 0], 2);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "OpenStreetMap"
}).addTo(map);

const markers = {};

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
                        📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}<br>
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
                        📍 ${latitude.toFixed(5)}, ${longitude.toFixed(5)}<br>
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

// Handle devices update
socket.on("devices-update", (devicesList) => {
    devices.clear();
    devicesList.forEach(device => {
        devices.set(device.id, device);
    });
    updateDeviceList();
});

// Handle user disconnection
socket.on("user-disconnected", (id) => {
    if (markers[id]) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
    devices.delete(id);
    updateDeviceList();
});

// Handle alert
socket.on("play-alert", () => {
    playAlertSound();
    showAlertNotification();
});

// Update device list UI
function updateDeviceList() {
    const list = document.getElementById('device-list');
    list.innerHTML = '';
    
    devices.forEach((device, id) => {
        const item = document.createElement('div');
        item.className = 'device-item';
        
        // Battery display
        const batteryHTML = device.battery !== null ? 
            `<div class="battery-indicator ${device.charging ? 'charging' : ''}" style="color: ${device.battery > 50 ? '#10b981' : device.battery > 20 ? '#f59e0b' : '#ef4444'}">
                ${device.charging ? '🔌' : device.battery > 20 ? '🔋' : '🪫'} ${device.battery}%
            </div>` : '';
        
        // Device icon and type display
        const deviceIcon = device.deviceIcon || '📱';
        const deviceType = device.deviceType || 'Unknown Device';
        
        item.innerHTML = `
            <div class="device-info">
                <strong>${deviceIcon} ${device.name}</strong>
                <small>${id === socket.id ? '(You)' : deviceType}</small>
                ${batteryHTML}
            </div>
            ${id === socket.id ? `
                <div class="device-actions">
                    <button onclick="toggleShare()" class="share-btn" title="Share Location">
                        ${device.isSharing ? '🔗 Stop Sharing' : '🔗 Share'}
                    </button>
                </div>
            ` : `
                <div class="device-actions">
                    <button onclick="locateDevice('${id}')" title="Locate">📍</button>
                    <button onclick="alertDevice('${id}')" title="Alert">🔔</button>
                </div>
            `}
        `;
        list.appendChild(item);
    });
}

// Locate device on map
function locateDevice(deviceId) {
    const device = devices.get(deviceId);
    if (device && device.latitude && device.longitude) {
        map.setView([device.latitude, device.longitude], 18);
        if (markers[deviceId]) {
            markers[deviceId].openPopup();
        }
    } else {
        alert("Location not available for this device");
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
