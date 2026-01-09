# Email/Password Authentication Guide for Android App

## Overview
This guide explains how to implement email/password authentication in the Android app, allowing users to login from any device using their credentials.

## API Endpoints

### 1. Register New User
**Endpoint:** `POST /api/app/register`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123",
  "name": "User Name"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Registration successful",
  "userId": "abc123...",
  "name": "User Name",
  "email": "user@example.com",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenExpiry": 1704758400000
}
```

**Error Responses:**
- `400`: Email already registered, invalid email format, or password too short
- `500`: Server error

### 2. Login with Email/Password
**Endpoint:** `POST /api/app/login`

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "userId": "abc123...",
  "name": "User Name",
  "email": "user@example.com",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "tokenExpiry": 1704758400000
}
```

**Error Responses:**
- `400`: Account uses Google Sign-In (use OAuth instead)
- `401`: Invalid email or password
- `500`: Server error

### 3. Using the Token
After successful login/registration, use the `token` in all subsequent API requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

The token is valid for **7 days**.

## Android Implementation Example

### 1. Add HTTP Client (Retrofit or similar)

Add to `build.gradle`:
```gradle
dependencies {
    implementation 'com.squareup.retrofit2:retrofit:2.9.0'
    implementation 'com.squareup.retrofit2:converter-gson:2.9.0'
}
```

### 2. Create API Interface

```java
public interface DeviceTrackerAPI {
    @POST("/api/app/register")
    Call<AuthResponse> register(@Body RegisterRequest request);
    
    @POST("/api/app/login")
    Call<AuthResponse> login(@Body LoginRequest request);
}

// Request models
class RegisterRequest {
    String email;
    String password;
    String name;
    
    public RegisterRequest(String email, String password, String name) {
        this.email = email;
        this.password = password;
        this.name = name;
    }
}

class LoginRequest {
    String email;
    String password;
    
    public LoginRequest(String email, String password) {
        this.email = email;
        this.password = password;
    }
}

// Response model
class AuthResponse {
    boolean success;
    String message;
    String userId;
    String name;
    String email;
    String token;
    long tokenExpiry;
}
```

### 3. Login Activity Example

```java
public class LoginActivity extends AppCompatActivity {
    private EditText emailInput, passwordInput;
    private Button loginButton, registerButton, googleButton;
    private DeviceTrackerAPI api;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);
        
        // Initialize Retrofit
        Retrofit retrofit = new Retrofit.Builder()
            .baseUrl("https://your-server-url.com")
            .addConverterFactory(GsonConverterFactory.create())
            .build();
        api = retrofit.create(DeviceTrackerAPI.class);
        
        emailInput = findViewById(R.id.emailInput);
        passwordInput = findViewById(R.id.passwordInput);
        loginButton = findViewById(R.id.loginButton);
        registerButton = findViewById(R.id.registerButton);
        googleButton = findViewById(R.id.googleButton);
        
        loginButton.setOnClickListener(v -> handleLogin());
        registerButton.setOnClickListener(v -> {
            Intent intent = new Intent(this, RegisterActivity.class);
            startActivity(intent);
        });
        googleButton.setOnClickListener(v -> handleGoogleLogin());
    }
    
    private void handleLogin() {
        String email = emailInput.getText().toString().trim();
        String password = passwordInput.getText().toString();
        
        // Validate inputs
        if (email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Please fill all fields", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Show loading
        loginButton.setEnabled(false);
        loginButton.setText("Logging in...");
        
        // Make API call
        LoginRequest request = new LoginRequest(email, password);
        api.login(request).enqueue(new Callback<AuthResponse>() {
            @Override
            public void onResponse(Call<AuthResponse> call, Response<AuthResponse> response) {
                loginButton.setEnabled(true);
                loginButton.setText("Login");
                
                if (response.isSuccessful() && response.body() != null) {
                    AuthResponse auth = response.body();
                    if (auth.success) {
                        // Save token and user data
                        saveUserData(auth.userId, auth.email, auth.name, auth.token, auth.tokenExpiry);
                        
                        // Navigate to main activity
                        Intent intent = new Intent(LoginActivity.this, MainActivity.class);
                        startActivity(intent);
                        finish();
                    } else {
                        Toast.makeText(LoginActivity.this, auth.message, Toast.LENGTH_LONG).show();
                    }
                } else {
                    try {
                        String errorBody = response.errorBody().string();
                        JSONObject error = new JSONObject(errorBody);
                        Toast.makeText(LoginActivity.this, 
                            error.optString("message", "Login failed"), 
                            Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(LoginActivity.this, "Login failed", Toast.LENGTH_SHORT).show();
                    }
                }
            }
            
            @Override
            public void onFailure(Call<AuthResponse> call, Throwable t) {
                loginButton.setEnabled(true);
                loginButton.setText("Login");
                Toast.makeText(LoginActivity.this, 
                    "Network error: " + t.getMessage(), 
                    Toast.LENGTH_LONG).show();
            }
        });
    }
    
    private void saveUserData(String userId, String email, String name, String token, long tokenExpiry) {
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        prefs.edit()
            .putString("userId", userId)
            .putString("email", email)
            .putString("name", name)
            .putString("authToken", token)
            .putLong("tokenExpiry", tokenExpiry)
            .putString("authType", "email") // Track auth type
            .apply();
    }
    
    private void handleGoogleLogin() {
        // Your existing Google Sign-In implementation
        // Keep this for users who prefer OAuth
    }
}
```

### 4. Register Activity Example

```java
public class RegisterActivity extends AppCompatActivity {
    private EditText nameInput, emailInput, passwordInput, confirmPasswordInput;
    private Button registerButton;
    private DeviceTrackerAPI api;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_register);
        
        // Initialize Retrofit
        Retrofit retrofit = new Retrofit.Builder()
            .baseUrl("https://your-server-url.com")
            .addConverterFactory(GsonConverterFactory.create())
            .build();
        api = retrofit.create(DeviceTrackerAPI.class);
        
        nameInput = findViewById(R.id.nameInput);
        emailInput = findViewById(R.id.emailInput);
        passwordInput = findViewById(R.id.passwordInput);
        confirmPasswordInput = findViewById(R.id.confirmPasswordInput);
        registerButton = findViewById(R.id.registerButton);
        
        registerButton.setOnClickListener(v -> handleRegister());
    }
    
    private void handleRegister() {
        String name = nameInput.getText().toString().trim();
        String email = emailInput.getText().toString().trim();
        String password = passwordInput.getText().toString();
        String confirmPassword = confirmPasswordInput.getText().toString();
        
        // Validate inputs
        if (name.isEmpty() || email.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Please fill all fields", Toast.LENGTH_SHORT).show();
            return;
        }
        
        if (!password.equals(confirmPassword)) {
            Toast.makeText(this, "Passwords do not match", Toast.LENGTH_SHORT).show();
            return;
        }
        
        if (password.length() < 6) {
            Toast.makeText(this, "Password must be at least 6 characters", Toast.LENGTH_SHORT).show();
            return;
        }
        
        // Show loading
        registerButton.setEnabled(false);
        registerButton.setText("Creating account...");
        
        // Make API call
        RegisterRequest request = new RegisterRequest(email, password, name);
        api.register(request).enqueue(new Callback<AuthResponse>() {
            @Override
            public void onResponse(Call<AuthResponse> call, Response<AuthResponse> response) {
                registerButton.setEnabled(true);
                registerButton.setText("Register");
                
                if (response.isSuccessful() && response.body() != null) {
                    AuthResponse auth = response.body();
                    if (auth.success) {
                        // Save token and user data
                        saveUserData(auth.userId, auth.email, auth.name, auth.token, auth.tokenExpiry);
                        
                        Toast.makeText(RegisterActivity.this, 
                            "Account created successfully!", 
                            Toast.LENGTH_SHORT).show();
                        
                        // Navigate to main activity
                        Intent intent = new Intent(RegisterActivity.this, MainActivity.class);
                        startActivity(intent);
                        finish();
                    } else {
                        Toast.makeText(RegisterActivity.this, auth.message, Toast.LENGTH_LONG).show();
                    }
                } else {
                    try {
                        String errorBody = response.errorBody().string();
                        JSONObject error = new JSONObject(errorBody);
                        Toast.makeText(RegisterActivity.this, 
                            error.optString("message", "Registration failed"), 
                            Toast.LENGTH_LONG).show();
                    } catch (Exception e) {
                        Toast.makeText(RegisterActivity.this, "Registration failed", Toast.LENGTH_SHORT).show();
                    }
                }
            }
            
            @Override
            public void onFailure(Call<AuthResponse> call, Throwable t) {
                registerButton.setEnabled(true);
                registerButton.setText("Register");
                Toast.makeText(RegisterActivity.this, 
                    "Network error: " + t.getMessage(), 
                    Toast.LENGTH_LONG).show();
            }
        });
    }
    
    private void saveUserData(String userId, String email, String name, String token, long tokenExpiry) {
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        prefs.edit()
            .putString("userId", userId)
            .putString("email", email)
            .putString("name", name)
            .putString("authToken", token)
            .putLong("tokenExpiry", tokenExpiry)
            .putString("authType", "email")
            .apply();
    }
}
```

### 5. Update MainActivity to Use Token

```java
public class MainActivity extends AppCompatActivity {
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Check if user is logged in
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        String token = prefs.getString("authToken", null);
        long tokenExpiry = prefs.getLong("tokenExpiry", 0);
        
        if (token == null || System.currentTimeMillis() > tokenExpiry) {
            // Token expired or doesn't exist, go to login
            Intent intent = new Intent(this, LoginActivity.class);
            startActivity(intent);
            finish();
            return;
        }
        
        setContentView(R.layout.activity_main);
        
        // Use token for all API requests
        String userId = prefs.getString("userId", "");
        String email = prefs.getString("email", "");
        
        // Continue with your app logic...
    }
    
    // Helper method to get auth header for API requests
    private String getAuthHeader() {
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        String token = prefs.getString("authToken", "");
        return "Bearer " + token;
    }
}
```

### 6. Socket.IO Connection with Token

Update your Socket.IO connection to use the JWT token:

```java
private void connectSocket() {
    try {
        SharedPreferences prefs = getSharedPreferences("DeviceTracker", MODE_PRIVATE);
        String token = prefs.getString("authToken", "");
        String userId = prefs.getString("userId", "");
        String email = prefs.getString("email", "");
        
        IO.Options options = new IO.Options();
        options.forceNew = true;
        options.reconnection = true;
        
        // Add auth token to socket connection
        options.auth = Collections.singletonMap("token", token);
        
        socket = IO.socket("https://your-server-url.com", options);
        
        socket.on(Socket.EVENT_CONNECT, args -> {
            // Register device with user info
            JSONObject deviceData = new JSONObject();
            deviceData.put("userId", userId);
            deviceData.put("name", "My Android Phone");
            deviceData.put("isRegistered", true);
            socket.emit("register-device", deviceData);
        });
        
        socket.connect();
    } catch (Exception e) {
        e.printStackTrace();
    }
}
```

## Layout XML Examples

### login_activity.xml
```xml
<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:padding="24dp"
    android:background="@drawable/gradient_background">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:gravity="center">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="📱"
            android:textSize="64sp"
            android:layout_marginBottom="16dp"/>

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Welcome Back"
            android:textSize="28sp"
            android:textStyle="bold"
            android:layout_marginBottom="8dp"/>

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Track your devices in real-time"
            android:textSize="14sp"
            android:textColor="#666"
            android:layout_marginBottom="32dp"/>

        <com.google.android.material.textfield.TextInputLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginBottom="16dp">
            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/emailInput"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:hint="Email Address"
                android:inputType="textEmailAddress"/>
        </com.google.android.material.textfield.TextInputLayout>

        <com.google.android.material.textfield.TextInputLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginBottom="24dp">
            <com.google.android.material.textfield.TextInputEditText
                android:id="@+id/passwordInput"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:hint="Password"
                android:inputType="textPassword"/>
        </com.google.android.material.textfield.TextInputLayout>

        <Button
            android:id="@+id/loginButton"
            android:layout_width="match_parent"
            android:layout_height="56dp"
            android:text="Sign In"
            android:textSize="16sp"
            android:layout_marginBottom="16dp"/>

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="OR"
            android:textColor="#999"
            android:layout_marginVertical="16dp"/>

        <Button
            android:id="@+id/googleButton"
            android:layout_width="match_parent"
            android:layout_height="56dp"
            android:text="Continue with Google"
            android:drawableLeft="@drawable/ic_google"
            android:layout_marginBottom="16dp"/>

        <TextView
            android:id="@+id/registerLink"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Don't have an account? Sign Up"
            android:textColor="@color/purple_500"
            android:layout_marginTop="16dp"/>

    </LinearLayout>
</ScrollView>
```

## Security Best Practices

1. **Always use HTTPS** in production
2. **Store tokens securely** using EncryptedSharedPreferences
3. **Validate token expiry** before making requests
4. **Implement token refresh** before expiry
5. **Clear sensitive data** on logout
6. **Don't log passwords** or tokens in production

## Benefits of Email/Password Login

✅ **Lost Device Recovery**: Login from any device to track your lost phone  
✅ **No Google Account Required**: Users without Google can still use the app  
✅ **Multi-Device Support**: Same account across multiple devices  
✅ **Offline Registration**: Create account even when Google services are unavailable  
✅ **Privacy**: Users who prefer not to use Google OAuth have an alternative

## Migration Path for Existing Users

Existing Google OAuth users can continue using Google Sign-In. The system supports both methods simultaneously:
- **Google OAuth users**: Continue signing in with Google button
- **Email/Password users**: Use email/password login
- Attempting to login with wrong method shows appropriate error message
