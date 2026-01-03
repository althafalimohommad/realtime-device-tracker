const { MongoClient } = require('mongodb');

class Database {
    constructor() {
        this.client = null;
        this.db = null;
        this.usersCollection = null;
    }

    async connect() {
        try {
            const mongoUri = process.env.MONGODB_URI;
            
            if (!mongoUri) {
                console.log('⚠️  No MONGODB_URI found, using local file storage');
                return false;
            }

            this.client = new MongoClient(mongoUri);
            await this.client.connect();
            this.db = this.client.db('devicetracker');
            this.usersCollection = this.db.collection('users');
            
            // Create index on user id for faster lookups
            await this.usersCollection.createIndex({ id: 1 }, { unique: true });
            
            console.log('✅ Connected to MongoDB Atlas');
            return true;
        } catch (error) {
            console.error('❌ MongoDB connection error:', error.message);
            console.log('⚠️  Falling back to local file storage');
            return false;
        }
    }

    async getUser(userId) {
        if (!this.usersCollection) return null;
        try {
            return await this.usersCollection.findOne({ id: userId });
        } catch (error) {
            console.error('Error fetching user:', error);
            return null;
        }
    }

    async saveUser(user) {
        if (!this.usersCollection) return false;
        try {
            await this.usersCollection.updateOne(
                { id: user.id },
                { $set: user },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.error('Error saving user:', error);
            return false;
        }
    }

    async getAllUsers() {
        if (!this.usersCollection) return {};
        try {
            const users = await this.usersCollection.find({}).toArray();
            const usersObj = {};
            users.forEach(user => {
                usersObj[user.id] = user;
            });
            return usersObj;
        } catch (error) {
            console.error('Error fetching all users:', error);
            return {};
        }
    }

    async getAllUsersArray() {
        if (!this.usersCollection) return [];
        try {
            return await this.usersCollection.find({}).toArray();
        } catch (error) {
            console.error('Error fetching all users array:', error);
            return [];
        }
    }

    async updateUserDevices(userId, devices) {
        if (!this.usersCollection) return false;
        try {
            await this.usersCollection.updateOne(
                { id: userId },
                { $set: { devices: devices } }
            );
            return true;
        } catch (error) {
            console.error('Error updating user devices:', error);
            return false;
        }
    }

    async updateUserRegisteredDevices(userId, registeredDevices) {
        if (!this.usersCollection) return false;
        try {
            await this.usersCollection.updateOne(
                { id: userId },
                { $set: { registeredDevices: registeredDevices } }
            );
            return true;
        } catch (error) {
            console.error('Error updating registered devices:', error);
            return false;
        }
    }

    async deleteUser(userId) {
        if (!this.usersCollection) return false;
        try {
            await this.usersCollection.deleteOne({ id: userId });
            console.log(`✅ Deleted user: ${userId}`);
            return true;
        } catch (error) {
            console.error('Error deleting user:', error);
            return false;
        }
    }

    async clearUserLocationHistory(userId) {
        if (!this.usersCollection) return false;
        try {
            const user = await this.getUser(userId);
            if (!user) return false;

            // Clear location data from all registered devices
            const clearedDevices = user.registeredDevices.map(device => ({
                ...device,
                latitude: null,
                longitude: null,
                accuracy: null,
                lastLocationUpdate: null
            }));

            await this.usersCollection.updateOne(
                { id: userId },
                { $set: { registeredDevices: clearedDevices } }
            );
            console.log(`✅ Cleared location history for user: ${userId}`);
            return true;
        } catch (error) {
            console.error('Error clearing location history:', error);
            return false;
        }
    }

    async deleteOldLocationData(daysOld = 30) {
        if (!this.usersCollection) return 0;
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const users = await this.usersCollection.find({}).toArray();
            let cleanedCount = 0;

            for (const user of users) {
                if (!user.registeredDevices) continue;

                const updatedDevices = user.registeredDevices.map(device => {
                    if (device.lastLocationUpdate) {
                        const updateDate = new Date(device.lastLocationUpdate);
                        if (updateDate < cutoffDate) {
                            cleanedCount++;
                            return {
                                ...device,
                                latitude: null,
                                longitude: null,
                                accuracy: null,
                                lastLocationUpdate: null
                            };
                        }
                    }
                    return device;
                });

                await this.usersCollection.updateOne(
                    { id: user.id },
                    { $set: { registeredDevices: updatedDevices } }
                );
            }

            console.log(`✅ Auto-deleted ${cleanedCount} location records older than ${daysOld} days`);
            return cleanedCount;
        } catch (error) {
            console.error('Error deleting old location data:', error);
            return 0;
        }
    }

    async logAdminAccess(action, details = {}) {
        if (!this.db) return false;
        try {
            const auditCollection = this.db.collection('admin_audit_log');
            await auditCollection.insertOne({
                action,
                details,
                timestamp: new Date(),
                ip: details.ip || 'unknown'
            });
            return true;
        } catch (error) {
            console.error('Error logging admin access:', error);
            return false;
        }
    }

    async getAdminAuditLog(limit = 100) {
        if (!this.db) return [];
        try {
            const auditCollection = this.db.collection('admin_audit_log');
            return await auditCollection
                .find({})
                .sort({ timestamp: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            console.error('Error fetching audit log:', error);
            return [];
        }
    }

    async close() {
        if (this.client) {
            await this.client.close();
            console.log('MongoDB connection closed');
        }
    }
}

module.exports = new Database();
