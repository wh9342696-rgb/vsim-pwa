# 🎯 VSIM Complete Application Flow - Visual Guide

## From Splash Screen to Home (Complete User Journey)

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  STEP 1: Open Application (http://localhost:3000)          ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

                    ┌──────────────────────────┐
                    │   SPLASH SCREEN          │
                    │                          │
                    │   🌐 V VSIM 🌐           │
                    │                          │
                    │ Stay Connected Anywhere  │
                    │  Your Global eSIM        │
                    │     Companion            │
                    │                          │
                    │  [Get Started Button ▶]  │
                    │                          │
                    │  🌙 (Theme toggle)       │
                    └──────────────────────────┘
                            │
                            │ Click "Get Started"
                            ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃  STEP 2: handleGetStarted() Function Runs                  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

    function handleGetStarted() {
      const token = window.VSIM_API && window.VSIM_API.getToken();
      
      if (token) {
        // User already logged in
        navigateTo('screen-home');  ✅
      } else {
        // New user or logged out
        navigateTo('screen-login');  ✅
      }
    }

                    ┌─────────────────────────┐
                    │  Check localStorage     │
                    │  for JWT token          │
                    │                         │
                    │  vsim_jwt_token = ?     │
                    │                         │
                    └────────┬────────────────┘
                             │
          ┌──────────────────┴──────────────────┐
          │                                     │
       Has Token?                           No Token?
          │                                     │
          ▼                                     ▼
    ┌──────────────┐                  ┌──────────────────┐
    │ screen-home  │                  │ screen-login     │
    │ (Go Directly)│                  │ (Show form)  ✅  │
    └──────────────┘                  └──────────────────┘
          │                                     │
          │                                     │ Choice:
          │                                     │ - Login Tab
          │                                     │ - Sign Up Tab
          │                                     │
          │                          ┌──────────┴──────────┐
          │                          │                    │
          │                      ┌───▼───┐           ┌───▼──────┐
          │                      │ LOGIN │           │ SIGN UP  │
          │                      └───┬───┘           └───┬──────┘
          │                          │                   │
          └──────────────┬───────────┴───────────────────┘
                         │
                         ▼
         ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
         ┃ STEP 3: User Authentication       ┃
         ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

---

## Detailed: LOGIN FLOW

```
┌──────────────────────────────────────────────┐
│  LOGIN SCREEN                                │
│                                              │
│  ◀ [Back]              [🌙 Theme]            │
│                                              │
│  V | Welcome Back                            │
│  ─────────────────────────────────────────  │
│     ├─ [LOGIN] (selected)                   │
│     └─ [SIGN UP]                            │
│                                              │
│  📱 Phone Number                             │
│     🇺🇬 +256                                 │
│     [________________] (700123456)          │
│                                              │
│  🔒 Password                                 │
│     [________________]  👁                   │
│                                              │
│  [   Login & Continue ▶  ]                  │
│                                              │
│  ──────────── or login with ───────────────  │
│  [Google]  [Apple]  [Email]                 │
│                                              │
│  Don't have account? Sign Up →               │
└──────────────────────────────────────────────┘
         │
         │ User fills form + clicks Login
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ handleLogin(e) - Frontend Validation      ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  ✅ Validate phone entered
  ✅ Validate password entered
  ✅ Disable button (prevent double-submit)
  
  If validation fails:
    ❌ showToast("Please enter phone number")
       → STOP, don't call API
  
  If validation passes:
    ✅ Call API: window.VSIM_API.login(phone, password)
         │
         │ Sends POST to /auth/login
         │ With Authorization header: Bearer [token]
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Backend Processing                        ┃
┃ POST /auth/login → auth.controller.js     ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  1. ✅ Receive phone + password
  2. ✅ Validate against PocketBase
  3. ✅ Check user status (not banned)
  4. ✅ Generate JWT token
  5. ✅ Return { token, user { name, phone, wallet_balance, ... } }
         │
         │ Response sent to frontend
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Frontend Processing Response               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  try {
    const res = await window.VSIM_API.login(phone, password);
    
    if (res && res.user) {
      ✅ Store token: localStorage.setItem('vsim_jwt_token', token)
      ✅ Update appState: appState.profile.name = res.user.name
      ✅ Show success: showToast("Logged in successfully!", 'success')
      ✅ Navigate: navigateTo('screen-home')
    }
  } catch (err) {
    ❌ Show error: showToast(`Login failed: ${err.message}`, 'error')
  } finally {
    ✅ Re-enable button: btn.disabled = false
  }
         │
         ▼
  ┌─────────────────────────────────┐
  │  HOME SCREEN                    │
  │                                 │
  │  Hi, John Doe! 👤             │
  │  ─────────────────────────────  │
  │                                 │
  │  💰 Wallet Balance              │
  │  $ 50,000 UGX                   │
  │  [Deposit ▼]  [Withdraw ▼]      │
  │                                 │
  │  📦 Available eSIM Packages     │
  │  [France]  [Dubai]  [USA]  ...  │
  │                                 │
  │  📱 My eSIMs                    │
  │  (Empty - Buy one!)             │
  │                                 │
  │  🏠 Home | 🌍 eSIM | 💵 Wallet  │
  │  📱 Airtime | 👤 Profile        │
  └─────────────────────────────────┘
```

---

## Detailed: SIGNUP FLOW

```
┌──────────────────────────────────────────────┐
│  SIGNUP SCREEN                               │
│                                              │
│  ◀ [Back]              [🌙 Theme]            │
│                                              │
│  V | Create Account                          │
│  ─────────────────────────────────────────  │
│     ├─ [LOGIN]                              │
│     └─ [SIGN UP] (selected)                 │
│                                              │
│  👤 Full Name                                │
│     [John Doe________________]              │
│                                              │
│  📱 Phone Number                             │
│     🇺🇬 +256 [________________]              │
│                                              │
│  🔒 Create Password                          │
│     [________________]  👁                   │
│                                              │
│  🔒 Confirm Password  ✅ NEW                 │
│     [________________]  👁                   │
│                                              │
│  🎁 Referral Code (+UGX 5,000)              │
│     [VSIM1234________]  (optional)          │
│                                              │
│  ☑ I agree to Terms & Privacy Policy        │
│                                              │
│  [   Create Account ▶  ]                    │
│                                              │
│  ────── or sign up with ──────               │
│  [Google]  [Apple]  [Email]                 │
│                                              │
│  Already have account? Login →               │
└──────────────────────────────────────────────┘
         │
         │ User fills form + clicks Create Account
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ handleSignup(e) - Frontend Validation    ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  Validation Checks (in order):
  
  ✅ 1. Full Name not empty?
       → if (!fullName) showToast("Enter full name"); return;
  
  ✅ 2. Phone not empty?
       → if (!phone) showToast("Enter phone"); return;
  
  ✅ 3. Password not empty?
       → if (!password) showToast("Enter password"); return;
  
  ✅ 4. Passwords match? ← NEW FIX ✅
       → if (password !== confirmPass) 
           showToast("Passwords do not match"); return;
  
  ✅ 5. Password length >= 6?
       → if (password.length < 6)
           showToast("Min 6 characters"); return;
  
  If ALL pass:
    ✅ Disable button
    ✅ Call API: window.VSIM_API.register(
         fullName, phone, password, referralCode
       )
         │
         │ Sends POST to /auth/register ← FIXED ✅
         │ (was /auth/signup before)
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Backend Processing                        ┃
┃ POST /auth/register → auth.controller.js  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  1. ✅ Receive: fullName, phone, password, referralCode, email
  2. ✅ Validate inputs (length, format, etc.)
  3. ✅ Hash password
  4. ✅ Create user in PocketBase
  5. ✅ Create wallet (with balance=0)
  6. ✅ Link referral if code provided
  7. ✅ Generate JWT token
  8. ✅ Return { token, user { ... } }
         │
         │ Response sent to frontend
         ▼

┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃ Frontend Processing Response               ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

  try {
    const res = await window.VSIM_API.register(
      fullName, phone, password, refCode
    );
    
    if (res && res.user) {
      ✅ Store token: localStorage.setItem('vsim_jwt_token', token)
      ✅ Update profile: 
         appState.profile.name = res.user.name
         appState.profile.phone = res.user.phone
         appState.walletBalance = res.user.wallet_balance || 0
      ✅ Show success: showToast("Account created!", 'success')
      ✅ Navigate: navigateTo('screen-home')
    }
  } catch (err) {
    ❌ Show error: showToast(`Signup failed: ${err.message}`, 'error')
  } finally {
    ✅ Re-enable button: btn.disabled = false
  }
         │
         ▼
  ┌─────────────────────────────────┐
  │  HOME SCREEN                    │
  │                                 │
  │  Hi, John Doe! 👤             │
  │  ─────────────────────────────  │
  │                                 │
  │  💰 Wallet Balance              │
  │  $ 0 UGX (Just created!)        │
  │  [Deposit ▼]  [Withdraw ▼]      │
  │                                 │
  │  📦 Available eSIM Packages     │
  │  [France]  [Dubai]  [USA]  ...  │
  │                                 │
  │  Ready to buy your first eSIM!  │
  │                                 │
  │  🏠 Home | 🌍 eSIM | 💵 Wallet  │
  │  📱 Airtime | 👤 Profile        │
  └─────────────────────────────────┘
```

---

## Key Components Interaction

```
┌───────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Browser)                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  index.html - Contains all screens (HTML + CSS)            │ │
│  │  ├─ Splash Screen                                          │ │
│  │  ├─ Login/Signup Screen                                    │ │
│  │  ├─ Home Screen                                            │ │
│  │  └─ (Other screens)                                        │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  api.js - REST API Client                                   │ │
│  │  ├─ VSIM_API.login(phone, password)                         │ │
│  │  ├─ VSIM_API.register(fullName, phone, password)            │ │
│  │  ├─ VSIM_API.getToken()   [reads localStorage]              │ │
│  │  ├─ VSIM_API.setToken()   [writes localStorage]             │ │
│  │  └─ VSIM_API.request()    [HTTP wrapper]                    │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  app.js - Navigation & Event Handlers                       │ │
│  │  ├─ handleGetStarted()  [from splash]                       │ │
│  │  ├─ handleLogin(e)      [from login form]                   │ │
│  │  ├─ handleSignup(e)     [from signup form]                  │ │
│  │  ├─ navigateTo()        [change screens]                    │ │
│  │  └─ showToast()         [show messages]                     │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  localStorage                                                │ │
│  │  ├─ vsim_jwt_token  [stores JWT]                             │ │
│  │  ├─ vsim_theme      [light/dark]                             │ │
│  │  └─ [other data]                                             │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
                 HTTP POST: /auth/login
                 HTTP POST: /auth/register
                            │
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                     BACKEND (Node.js)                             │
│                     (Port 4000)                                   │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  app.js - Express Application                              │ │
│  │  ├─ middleware (auth, logger, errors)                      │ │
│  │  ├─ routes (11 modules)                                    │ │
│  │  └─ WebSocket server                                       │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  modules/auth/                                               │ │
│  │  ├─ auth.routes.js      [endpoints]                          │ │
│  │  │   ├─ POST /register  ✅                                   │ │
│  │  │   ├─ POST /login     ✅                                   │ │
│  │  │   ├─ POST /refresh                                        │ │
│  │  │   └─ POST /logout                                         │ │
│  │  │                                                            │ │
│  │  ├─ auth.controller.js  [request handlers]                   │ │
│  │  │   ├─ register()  [creates user + wallet]                  │ │
│  │  │   ├─ login()     [validates + issues token]               │ │
│  │  │   ├─ refresh()                                            │ │
│  │  │   └─ logout()                                             │ │
│  │  │                                                            │ │
│  │  └─ auth.service.js     [business logic]                     │ │
│  │      ├─ register()  [calls PocketBase + wallet logic]        │ │
│  │      └─ login()     [validates + generates JWT]              │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  config/pocketbase.js - Database Connection                 │ │
│  │  └─ Connects to PocketBase on http://localhost:8090         │ │
│  └────────────────────────┬─────────────────────────────────────┘ │
│                           │                                      │
│  ┌────────────────────────▼─────────────────────────────────────┐ │
│  │  config/redis.js - Cache & Locks                            │ │
│  │  └─ Connects to Redis on localhost:6379                     │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└───────────────────────────┬───────────────────────────────────────┘
                            │
         CRUD: users, wallets, wallet_transactions, etc.
                            │
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│                DATABASE (PocketBase)                              │
│                (Port 8090)                                        │
│                                                                   │
│  Collections:                                                     │
│  ├─ users            [id, email, phone, password_hash, ...]     │
│  ├─ wallets          [user_id, balance, currency, ...]          │
│  ├─ wallet_transactions  [...]                                   │
│  ├─ esim_profiles    [...]                                       │
│  ├─ deposits         [...]                                       │
│  ├─ referral_rewards [...]                                       │
│  └─ (12 more collections)                                        │
│                                                                   │
└───────────────────────────────────────────────────────────────────┘

PLUS: Redis (localhost:6379) for caching, locks, session storage
PLUS: WebSocket (ws://localhost:4001) for real-time updates
```

---

## ✅ What Gets Fixed When App Starts

When you open http://localhost:3000:

1. **HTML loads** → All screens exist in DOM but hidden
2. **CSS loads** → Styling applied (dark mode by default)
3. **api.js loads** → VSIM_API object created and attached to window
4. **app.js loads** → All event handlers attached
5. **Theme loads** → Checks localStorage for saved theme
6. **Splash shows** → First screen visible with "Get Started" button

When user clicks "Get Started":

1. **handleGetStarted() runs** → Checks localStorage for token
2. **No token found** → navigateTo('screen-login')
3. **Login screen shows** → With Login and Sign Up tabs
4. **User sees all fields** → Properly labeled and validated
5. **User can signup** → Form validates before sending to backend
6. **Backend responds** → Creates user, wallet, returns token
7. **Frontend stores token** → Saves to localStorage
8. **Home screen shows** → User now logged in and ready to use app

---

## 🎬 Now You Can:

✅ Start all 4 services  
✅ Open http://localhost:3000  
✅ See splash screen  
✅ Click "Get Started"  
✅ Sign up with new account  
✅ See home screen  
✅ Buy eSIM packages  
✅ Manage wallet  
✅ Everything works end-to-end!

---

**Follow [STARTUP.md](./STARTUP.md) to get running in 5 minutes!**
