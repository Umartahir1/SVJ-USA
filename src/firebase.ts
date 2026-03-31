import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';
// Import the Firebase configuration if it exists
const configs = import.meta.glob('../firebase-applet-config.json', { eager: true, import: 'default' });
const fileConfig = configs['../firebase-applet-config.json'] as any;

// Only use fileConfig if it actually contains an apiKey
const useFileConfig = fileConfig && fileConfig.apiKey;

const firebaseConfig = useFileConfig ? fileConfig : {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID
};

// Initialize Firebase SDK
let app: any;
const missingKeys = [];
if (!firebaseConfig.apiKey) missingKeys.push('VITE_FIREBASE_API_KEY');
if (!firebaseConfig.projectId) missingKeys.push('VITE_FIREBASE_PROJECT_ID');
if (!firebaseConfig.authDomain) missingKeys.push('VITE_FIREBASE_AUTH_DOMAIN');
if (!firebaseConfig.appId) missingKeys.push('VITE_FIREBASE_APP_ID');

try {
  if (missingKeys.length > 0) {
    console.warn(`Firebase configuration is incomplete. Missing: ${missingKeys.join(', ')}`);
    console.log("Current Config Keys found:", Object.keys(firebaseConfig).filter(k => !!(firebaseConfig as any)[k]));
    
    app = initializeApp({ 
      apiKey: firebaseConfig.apiKey || "missing", 
      projectId: firebaseConfig.projectId || "missing",
      authDomain: firebaseConfig.authDomain || "missing",
      appId: firebaseConfig.appId || "missing"
    });
  } else {
    console.log("Firebase initialized successfully with " + (useFileConfig ? "file config" : "environment variables"));
    app = initializeApp(firebaseConfig);
  }
} catch (e) {
  console.error("Error initializing Firebase:", e);
  app = initializeApp({ apiKey: "error", projectId: "error" });
}

export const auth = getAuth(app);
export const db = getFirestore(app, (firebaseConfig && firebaseConfig.firestoreDatabaseId) || '(default)');
export const googleProvider = new GoogleAuthProvider();

export { doc, setDoc, getDoc };

// Auth Helpers
export const signInWithGoogle = async () => {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const user = result.user;
    
    // Sync user profile to Firestore
    await setDoc(doc(db, 'users', user.uid), {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      lastLogin: new Date().toISOString()
    }, { merge: true });
    
    return user;
  } catch (error) {
    console.error("Google Sign-In Error:", error);
    throw error;
  }
};

export { onAuthStateChanged };
export type { User };
