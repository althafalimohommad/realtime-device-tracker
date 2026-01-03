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

    async close() {
        if (this.client) {
            await this.client.close();
            console.log('MongoDB connection closed');
        }
    }
}

module.exports = new Database();
