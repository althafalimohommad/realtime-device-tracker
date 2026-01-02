// End-to-End Encryption Utility
class E2EEncryption {
    constructor() {
        this.keyStorageKey = 'e2e_encryption_key';
        this.algorithm = {
            name: 'AES-GCM',
            length: 256
        };
    }

    // Generate or retrieve encryption key
    async getOrCreateKey(userId) {
        const keyData = localStorage.getItem(`${this.keyStorageKey}_${userId}`);
        
        if (keyData) {
            // Import existing key
            const keyArray = new Uint8Array(JSON.parse(keyData));
            return await crypto.subtle.importKey(
                'raw',
                keyArray,
                this.algorithm,
                true,
                ['encrypt', 'decrypt']
            );
        } else {
            // Generate new key
            const key = await crypto.subtle.generateKey(
                this.algorithm,
                true,
                ['encrypt', 'decrypt']
            );
            
            // Export and store key
            const exportedKey = await crypto.subtle.exportKey('raw', key);
            const keyArray = Array.from(new Uint8Array(exportedKey));
            localStorage.setItem(`${this.keyStorageKey}_${userId}`, JSON.stringify(keyArray));
            
            return key;
        }
    }

    // Encrypt data
    async encrypt(data, key) {
        try {
            const encoder = new TextEncoder();
            const dataBuffer = encoder.encode(JSON.stringify(data));
            
            // Generate random IV (Initialization Vector)
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Encrypt
            const encryptedBuffer = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                key,
                dataBuffer
            );
            
            // Combine IV and encrypted data
            return {
                iv: Array.from(iv),
                data: Array.from(new Uint8Array(encryptedBuffer))
            };
        } catch (error) {
            console.error('Encryption failed:', error);
            throw error;
        }
    }

    // Decrypt data
    async decrypt(encryptedData, key) {
        try {
            const iv = new Uint8Array(encryptedData.iv);
            const data = new Uint8Array(encryptedData.data);
            
            // Decrypt
            const decryptedBuffer = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                key,
                data
            );
            
            const decoder = new TextDecoder();
            const decryptedText = decoder.decode(decryptedBuffer);
            return JSON.parse(decryptedText);
        } catch (error) {
            console.error('Decryption failed:', error);
            throw error;
        }
    }

    // Share key with another device (for multi-device support)
    async exportKey(key) {
        const exportedKey = await crypto.subtle.exportKey('raw', key);
        return Array.from(new Uint8Array(exportedKey));
    }

    async importKey(keyArray) {
        return await crypto.subtle.importKey(
            'raw',
            new Uint8Array(keyArray),
            this.algorithm,
            true,
            ['encrypt', 'decrypt']
        );
    }
}

// Create global instance
const encryption = new E2EEncryption();
