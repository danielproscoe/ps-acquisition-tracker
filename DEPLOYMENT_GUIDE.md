# 🚀 PS Acquisition Tracker — Full Deployment Guide
### Vercel + Firebase · No coding experience required

---

## OVERVIEW

You're deploying a React web app that all 3 users (Dan R, Daniel Wollent, Matthew Toussaint)
can open in any browser and see **live, shared data** — changes sync instantly.

**What you'll set up:**
1. Firebase (the database that stores everything)
2. GitHub (stores your code)
3. Vercel (hosts the website)

**Time:** ~30–45 minutes total

---

## STEP 1: SET UP FIREBASE

Firebase is Google's free database service. This is where all your site data lives.

### 1A — Create a Firebase project

1. Go to: https://console.firebase.google.com
2. Sign in with a Google account (any Gmail works — create one if needed)
3. Click **"Add project"** (big blue button)
4. Name it: `ps-acquisition-tracker` → click Continue
5. **Turn OFF** Google Analytics (toggle it off) → click **Create project**
6. Wait ~30 seconds, then click **Continue**

---

### 1B — Set up the Realtime Database

1. In the left sidebar, click **"Build"** → **"Realtime Database"**
2. Click **"Create Database"** (blue button)
3. Location: choose **"United States (us-central1)"** → click **Next**
4. Select **"Start in test mode"** → click **Enable**
5. The database is created. You'll see a URL like:
   `https://ps-acquisition-tracker-XXXXX-default-rtdb.firebaseio.com`
   **Copy and save this URL** — you'll need it in Step 3.

**Set database rules (open access — no login required):**
1. Click the **"Rules"** tab
2. Replace everything with this:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
3. Click **"Publish"**

---

### 1C — Set up Firebase Storage (for document uploads)

1. In the left sidebar, click **"Build"** → **"Storage"**
2. Click **"Get started"**
3. Select **"Start in test mode"** → click **Next**
4. Choose **"nam5 (us-central)"** → click **Done**

**Set storage rules:**
1. Click the **"Rules"** tab
2. Replace everything with:
   ```
   rules_version = '2';
   service firebase.storage {
     match /b/{bucket}/o {
       match /{allPaths=**} {
         allow read, write: if true;
       }
     }
   }
   ```
3. Click **"Publish"**

---

### 1D — Get your Firebase config keys

1. In the left sidebar, click the **gear icon ⚙️** next to "Project Overview"
2. Click **"Project settings"**
3. Scroll down to **"Your apps"** section
4. Click the **"</>" (Web)** icon to register a web app
5. Name it: `ps-tracker-web` → click **"Register app"**
6. You'll see a code block like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "ps-acquisition-tracker.firebaseapp.com",
  databaseURL: "https://ps-acquisition-tracker-XXXXX-default-rtdb.firebaseio.com",
  projectId: "ps-acquisition-tracker",
  storageBucket: "ps-acquisition-tracker.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

7. **Copy the entire firebaseConfig block** — save it in a text file on your desktop.
8. Click **Continue to console**

---

## STEP 2: PREPARE YOUR CODE FILES

You have a folder called `ps-tracker` with these files:
```
ps-tracker/
  public/
    index.html
  src/
    App.js
    firebase.js
    index.js
  package.json
```

### 2A — Add your Firebase keys to firebase.js

1. Open `src/firebase.js` in any text editor (Notepad on Windows, TextEdit on Mac)
2. Replace the placeholder values with your actual keys from Step 1D:

**BEFORE:**
```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

**AFTER (your actual values):**
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXX",        ← paste your apiKey
  authDomain: "ps-acquisition-tracker.firebaseapp.com",
  databaseURL: "https://ps-acquisition-tracker-XXXXX-default-rtdb.firebaseio.com",
  projectId: "ps-acquisition-tracker",
  storageBucket: "ps-acquisition-tracker.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

3. Save the file.

---

## STEP 3: UPLOAD CODE TO GITHUB

GitHub stores your code so Vercel can deploy it.

### 3A — Create a GitHub account (if you don't have one)

1. Go to: https://github.com
2. Click **"Sign up"** — use your email, create a username and password
3. Verify your email

### 3B — Create a new repository

1. After signing in, click the **"+"** icon in the top right → **"New repository"**
2. Name it: `ps-acquisition-tracker`
3. Make sure it's set to **"Private"**
4. Click **"Create repository"**

### 3C — Upload your files

GitHub will show an empty repo page with upload options.

1. Click **"uploading an existing file"** (it's a link in the text on the page)
2. Open the `ps-tracker` folder on your computer
3. You need to upload files maintaining the folder structure. The easiest way:

   **Option A — Drag and drop (simple):**
   - Drag ALL files from the `ps-tracker` folder into the GitHub upload box
   - GitHub will ask you to create paths — maintain the structure
   
   **Option B — Use GitHub Desktop (easier for folders):**
   1. Download GitHub Desktop: https://desktop.github.com
   2. Sign in with your GitHub account
   3. Click **"Add an Existing Repository from your Hard Drive"**
   4. Select your `ps-tracker` folder
   5. Click **"Publish repository"**
   6. Make it **Private** → click **Publish**

4. After uploading, click **"Commit changes"** with message: `Initial upload`

---

## STEP 4: DEPLOY ON VERCEL

Vercel hosts the website for free and auto-deploys when you update code.

### 4A — Create a Vercel account

1. Go to: https://vercel.com
2. Click **"Sign Up"**
3. Choose **"Continue with GitHub"** — sign in with the GitHub account you just created
4. Authorize Vercel to access your GitHub

### 4B — Import your project

1. On the Vercel dashboard, click **"Add New..."** → **"Project"**
2. Find `ps-acquisition-tracker` in your GitHub repos → click **"Import"**

### 4C — Configure the build

Vercel should auto-detect React. Confirm these settings:
- **Framework Preset:** Create React App
- **Root Directory:** `./` (leave as is)
- **Build Command:** `npm run build`
- **Output Directory:** `build`

Click **"Deploy"** — Vercel builds and deploys. Takes 2–3 minutes.

### 4D — Get your URL

When done, Vercel shows: **"Your project is deployed! 🎉"**

You'll see a URL like: `ps-acquisition-tracker-xyz.vercel.app`

**That's your app URL.** Share it with Daniel Wollent and Matthew Toussaint.

---

## STEP 5: VERIFY IT WORKS

1. Open your Vercel URL in a browser
2. You should see the PS Acquisition Tracker loading screen (spinning orange circle)
3. Wait 5–10 seconds for data to load
4. First load triggers seed: all 25 Daniel Wollent + 12 Matthew Toussaint sites populate automatically
5. Open the URL on a second device or browser — changes made on one appear instantly on the other

**If you see a blank screen or error:**
- Open browser DevTools (F12) → Console tab
- Look for red error messages
- Most common fix: check that firebase.js has your exact keys (no typos, no extra spaces)

---

## STEP 6: CUSTOM DOMAIN (Optional)

If you want a cleaner URL like `ps-tracker.yourdomain.com`:

1. In Vercel dashboard → your project → **"Settings"** → **"Domains"**
2. Click **"Add"** → type your domain
3. Follow Vercel's DNS instructions for your domain registrar

---

## HOW TO UPDATE THE APP LATER

If you need to change the code (add features, fix something):

1. Edit the file on your computer
2. Go to GitHub → your repo → find the file → click the pencil ✏️ edit icon
3. Paste your updated code → click **"Commit changes"**
4. Vercel auto-detects the change and re-deploys in ~2 minutes
5. Refresh your browser — done

---

## APP FEATURES QUICK REFERENCE

| Feature | How to use |
|---|---|
| **Add a site directly** | Submit Site tab → "Direct to Tracker" → fill form → Add Now |
| **Submit for review** | Submit Site tab → "Send to Review" → fill form → Submit → copy link |
| **Review pending sites** | Review tab → select reviewer → Approve or Decline |
| **Edit site details** | Daniel Wollent or Matthew Toussaint tab → click site row to expand |
| **Upload documents** | Expand a site card → Documents section → select type → Upload |
| **Send a message** | Expand a site card → Thread section → select your name → type → Send |
| **Bulk import** | Bulk Import tab → upload CSV or Excel → Import All |
| **Export to Excel** | Click "↓ Export Excel" button in top right of header |
| **Deep link to review** | Submit Site (review mode) → copy the generated link → send via email |

---

## FREE TIER LIMITS (You won't hit these)

**Firebase Realtime Database (Spark free plan):**
- 1 GB stored data — your tracker will use ~5 MB
- 10 GB/month downloads — easily sufficient for 3 users
- 100 simultaneous connections — far more than needed

**Firebase Storage (Spark free plan):**
- 5 GB stored files
- 1 GB/day downloads

**Vercel (Hobby free plan):**
- Unlimited deployments
- 100 GB bandwidth/month

---

## TROUBLESHOOTING

**"Permission denied" error in console:**
→ Re-check your Firebase database rules are set to `true` for both read and write.
→ Also check Storage rules are set to allow all.

**Sites don't appear / blank tracker:**
→ Check the databaseURL in firebase.js exactly matches what's in your Firebase console.
→ Make sure it ends with `.firebaseio.com` (not `.com/`)

**Document upload fails:**
→ Make sure Firebase Storage rules are published (Step 1C)
→ File size under 20MB

**App loads but data doesn't sync in real time:**
→ Firebase Realtime Database (not Firestore) must be selected.
→ The databaseURL must be present in firebaseConfig.

**Changes on one device don't appear on another:**
→ Both devices should have the exact same URL open
→ Try hard refresh (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac)

---

## SECURITY NOTE

This app uses open Firebase rules (no login required) for simplicity. This means
anyone with the URL can read and write data. Since this is an internal tool shared
only by the 3 of you via a non-obvious Vercel URL, this is fine for your use case.

If you ever want to add login authentication, that's a future upgrade — just reach out.

---

*Tracker built for Public Storage · 2026 Acquisition Pipeline*
*Daniel Wollent (Southwest) · Matthew Toussaint (East) · Dan R (Admin)*
