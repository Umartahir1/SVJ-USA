import express from "express";
import axios from "axios";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";

const app = express();
app.use(express.json({ limit: '10mb' })); // Increase limit for image uploads

const HUBSPOT_ACCESS_TOKEN_ENV = process.env.HUBSPOT_ACCESS_TOKEN;
let cachedDbToken: string | null = null;

async function getHubSpotToken() {
  // Vercel/Environment Variable is the absolute priority
  const envToken = process.env.HUBSPOT_ACCESS_TOKEN;
  
  if (envToken && envToken.trim() !== "" && envToken !== "YOUR_HUBSPOT_ACCESS_TOKEN") {
    console.log(`[HubSpot] Using token from environment variable (starts with: ${envToken.substring(0, 7)})`);
    return envToken.trim();
  }

  if (cachedDbToken) return cachedDbToken;

  console.log("[HubSpot] Token missing from environment, checking Firestore...");
  try {
    // Even without a service account, we can try to initialize if we have the project ID
    const db = admin.firestore();
    const doc = await db.collection("config").doc("hubspot").get();
    if (doc.exists) {
      cachedDbToken = doc.data()?.token;
      console.log("[Firebase] Successfully fetched HubSpot token from Firestore");
      return cachedDbToken;
    } else {
      console.warn("[Firebase] HubSpot token document not found in Firestore at config/hubspot");
    }
  } catch (err: any) {
    console.warn("[Firebase] Could not fetch HubSpot token from Firestore:", err.message);
  }
  return null;
}

// Initialize Firebase Admin
try {
  if (!admin.apps.length) {
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    let databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;

    // Try to load from config file if env vars are missing
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
        projectId = projectId || fileConfig.projectId;
        databaseId = databaseId || fileConfig.firestoreDatabaseId;
      }
    } catch (configErr) {
      console.warn("[Firebase Admin] Could not read config file:", configErr);
    }

    // Hardcoded fallbacks as last resort
    projectId = projectId || "gen-lang-client-0125145098";
    databaseId = databaseId || "ai-studio-f4d77b55-6f5e-42f7-a496-84f9e8a52ad4";

    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

    if (serviceAccountKey) {
      console.log("[Firebase Admin] Initializing with Service Account Key");
      const serviceAccount = JSON.parse(serviceAccountKey);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
      });
    } else {
      console.log("[Firebase Admin] Initializing with Project ID (No Service Account Key found):", projectId);
      admin.initializeApp({
        projectId: projectId,
      });
    }
    
    if (databaseId) {
      console.log("[Firebase Admin] Using Firestore Database ID:", databaseId);
      try {
        admin.firestore().settings({ databaseId: databaseId });
      } catch (e) {
        console.warn("[Firebase Admin] Could not set databaseId (this is normal if already initialized):", e.message);
      }
    }
  }
} catch (err) {
  console.error("Firebase Admin initialization error:", err);
}

// Cache for HubSpot owners
let hubspotOwnersCache: any[] = [];
let lastOwnersFetch = 0;
let lastOwnersFetchAttempt = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

async function getHubSpotOwners() {
  if (hubspotOwnersCache.length > 0 && Date.now() - lastOwnersFetch < CACHE_TTL) {
    return hubspotOwnersCache;
  }
  if (lastOwnersFetch === -1 && Date.now() - lastOwnersFetchAttempt < CACHE_TTL) {
    return [];
  }
  const token = await getHubSpotToken();
  if (!token) return [];
  try {
    lastOwnersFetchAttempt = Date.now();
    const response = await axios.get("https://api.hubapi.com/crm/v3/owners?limit=100", {
      headers: { Authorization: `Bearer ${token}` }
    });
    hubspotOwnersCache = response.data.results || [];
    lastOwnersFetch = Date.now();
    return hubspotOwnersCache;
  } catch (err: any) {
    if (err.response?.status === 403) {
      lastOwnersFetch = -1;
    }
    return hubspotOwnersCache;
  }
}

const authenticateUser = async (req: any, res: any, next: any) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }
  const idToken = authHeader.split("Bearer ")[1];
  
  let apiKey = (process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY || "").trim();
  let source = "env";
  
  // Fallback to config file if env var is missing
  if (!apiKey) {
    try {
      // Try multiple possible paths for the config file
      const paths = [
        path.join(process.cwd(), "firebase-applet-config.json"),
        path.join(process.cwd(), "api", "firebase-applet-config.json"),
        path.join(__dirname, "..", "firebase-applet-config.json"),
        path.join(__dirname, "firebase-applet-config.json")
      ];
      
      for (const configPath of paths) {
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
          if (fileConfig.apiKey) {
            apiKey = (fileConfig.apiKey || "").trim();
            source = `file (${path.basename(configPath)})`;
            break;
          }
        }
      }
    } catch (err) {
      console.warn("[Auth] Could not read Firebase config file for API key:", err);
    }
  }

  // Remove accidental quotes if present
  if (apiKey.startsWith('"') && apiKey.endsWith('"')) {
    apiKey = apiKey.substring(1, apiKey.length - 1);
  }
  if (apiKey.startsWith("'") && apiKey.endsWith("'")) {
    apiKey = apiKey.substring(1, apiKey.length - 1);
  }

  if (!apiKey) {
    console.error("[Auth] Firebase API key is missing. Token verification will fail.");
    return res.status(500).json({ error: "Internal Server Error: Auth configuration missing" });
  }

  console.log(`[Auth] Verifying token (snippet: ${idToken.substring(0, 10)}...) using API key (snippet: ${apiKey.substring(0, 7)}...) from ${source} (Length: ${apiKey.length})`);

  try {
    // 1. Try Admin SDK first if service account is available
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          email_verified: decodedToken.email_verified,
          name: decodedToken.name,
        };
        
        if (!req.user.email?.endsWith("@svjbrands.com")) {
          return res.status(403).json({ error: "Forbidden: Access restricted to @svjbrands.com accounts" });
        }
        
        return next();
      } catch (adminErr: any) {
        console.warn("[Auth] Admin SDK verification failed, falling back to REST API:", adminErr.message);
      }
    }

    // 2. Fallback to REST API with Referer header to bypass "Browser Key" restrictions
    let projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
    if (!projectId) {
      try {
        const configPath = path.join(process.cwd(), "firebase-applet-config.json");
        if (fs.existsSync(configPath)) {
          const fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
          projectId = fileConfig.projectId;
        }
      } catch (e) {}
    }
    projectId = projectId || "gen-lang-client-0125145098";

    // Use the incoming referer or origin to satisfy API key restrictions
    const incomingReferer = req.headers.referer || req.headers.origin || `https://${projectId}.firebaseapp.com`;
    console.log(`[Auth] Forwarding referer to Google API: ${incomingReferer}`);

    const response = await axios.post(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      { idToken },
      {
        headers: {
          'Referer': incomingReferer,
          'Origin': incomingReferer,
          'Content-Type': 'application/json'
        }
      }
    );

    const userData = response.data.users?.[0];
    if (!userData) {
      throw new Error("Invalid token: No user found");
    }

    if (!userData.email?.endsWith("@svjbrands.com")) {
      return res.status(403).json({ error: "Forbidden: Access restricted to @svjbrands.com accounts" });
    }

    // Map REST response to a format similar to decodedToken
    req.user = {
      uid: userData.localId,
      email: userData.email,
      email_verified: userData.emailVerified,
      name: userData.displayName,
    };
    next();
  } catch (error: any) {
    const apiError = error.response?.data;
    console.error("[Auth] Token verification failed:", apiError ? JSON.stringify(apiError, null, 2) : error.message);
    
    // Provide more specific error if it's an API error
    if (apiError && apiError.error) {
      const details = apiError.error.message || JSON.stringify(apiError.error);
      return res.status(401).json({ 
        error: "Unauthorized: Invalid or expired token",
        details: details,
        code: apiError.error.code
      });
    }
    
    res.status(401).json({ 
      error: "Unauthorized: Invalid or expired token",
      details: error.message
    });
  }
};

app.get("/api/health", async (req, res) => {
  console.log("[API] Health check requested. Env keys:", Object.keys(process.env).filter(k => !k.includes("KEY") && !k.includes("SECRET") && !k.includes("TOKEN")));
  console.log("[API] Secret keys present:", Object.keys(process.env).filter(k => k.includes("KEY") || k.includes("SECRET") || k.includes("TOKEN")));
  try {
    const token = await getHubSpotToken();
    const key1 = process.env.GEMINI_API_KEY;
    const key2 = process.env.GEMINI_API_KEY1;
    const geminiKey = key1 || key2;
    const firebaseKey = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
    
    console.log(`[Health] Gemini Key Source: ${key1 ? "GEMINI_API_KEY" : (key2 ? "GEMINI_API_KEY1" : "NONE")}`);
    
    res.json({ 
      status: "ok", 
      time: new Date().toISOString(),
      tokenConfigured: !!token,
      tokenPrefix: token ? token.substring(0, 7) : null,
      diagnostics: {
        hubspot: {
          configured: !!token,
          prefix: token ? token.substring(0, 7) : null,
          source: process.env.HUBSPOT_ACCESS_TOKEN ? "env" : (cachedDbToken ? "firestore" : "none")
        },
        gemini: {
          key1: key1 ? `Present (starts with ${key1.substring(0, 7)}..., ends with ...${key1.substring(key1.length - 4)}, length: ${key1.length})` : "Missing",
          key2: key2 ? `Present (starts with ${key2.substring(0, 7)}..., ends with ...${key2.substring(key2.length - 4)}, length: ${key2.length})` : "Missing",
          activeKey: geminiKey ? `Using ${key1 ? "GEMINI_API_KEY" : "GEMINI_API_KEY1"} (starts with ${geminiKey.substring(0, 7)}..., ends with ...${geminiKey.substring(geminiKey.length - 4)}, length: ${geminiKey.length})` : "None"
        },
        firebase: {
          key: firebaseKey ? `Present (starts with ${firebaseKey.substring(0, 7)}..., ends with ...${firebaseKey.substring(firebaseKey.length - 4)}, length: ${firebaseKey.length})` : "Missing"
        }
      }
    });
  } catch (err: any) {
    console.error("[API] Health check failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/test", (req, res) => {
  console.log("[API] Test endpoint requested");
  res.json({ 
    message: "API is reachable", 
    env: {
      hasHubspotToken: !!process.env.HUBSPOT_ACCESS_TOKEN,
      hasGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY1),
      hasFirebaseKey: !!process.env.VITE_FIREBASE_API_KEY,
      nodeEnv: process.env.NODE_ENV
    }
  });
});

app.get("/api/test-ai", async (req, res) => {
  try {
    const key1 = process.env.GEMINI_API_KEY;
    const key2 = process.env.GEMINI_API_KEY1;
    let apiKey = (key1 || key2 || "").trim();
    
    if (apiKey.startsWith('"') && apiKey.endsWith('"')) apiKey = apiKey.substring(1, apiKey.length - 1);
    if (apiKey.startsWith("'") && apiKey.endsWith("'")) apiKey = apiKey.substring(1, apiKey.length - 1);

    if (!apiKey) {
      return res.status(500).json({ 
        error: "Gemini API key not configured", 
        env_keys: Object.keys(process.env).filter(k => k.includes("GEMINI"))
      });
    }
    
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: "Say 'AI is working' in one sentence.",
    });
    res.json({ 
      success: true, 
      text: response.text, 
      source: key1 ? "GEMINI_API_KEY" : "GEMINI_API_KEY1",
      keyLength: apiKey.length
    });
  } catch (error: any) {
    console.error("[AI Test] Error:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get("/api/companies", async (req, res) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  try {
    const properties = [
      "name", "address", "city", "state", "zip", "phone", "ein_number", 
      "billing_address", "shipping_address", "domain", "sales_tax_id",
      "store_category", "number_of_stores", "lifecyclestage", "type"
    ];
    let allResults: any[] = [];
    let after = undefined;
    let hasMore = true;
    while (hasMore) {
      const url = `https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=${properties.join(",")}${after ? `&after=${after}` : ""}`;
      const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = response.data;
      if (data.results) allResults = [...allResults, ...data.results];
      if (data.paging?.next?.after) after = data.paging.next.after;
      else hasMore = false;
    }
    const filteredCompanies = allResults
      .filter((c: any) => c.properties?.name && c.properties.name.trim() !== "")
      .sort((a: any, b: any) => (a.properties?.name || "").localeCompare(b.properties?.name || ""));
    res.json({ results: filteredCompanies });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.get("/api/contacts/:companyId", async (req, res) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  const { companyId } = req.params;
  try {
    // 1. Get associated contact IDs
    const assocUrl = `https://api.hubapi.com/crm/v4/objects/companies/${companyId}/associations/contacts`;
    const assocRes = await axios.get(assocUrl, { headers: { Authorization: `Bearer ${token}` } });
    const contactIds = assocRes.data.results.map((r: any) => r.toObjectId);

    if (contactIds.length === 0) return res.json({ results: [] });

    // 2. Fetch contact details
    const contactsUrl = `https://api.hubapi.com/crm/v3/objects/contacts/batch/read`;
    const contactsRes = await axios.post(contactsUrl, {
      inputs: contactIds.map((id: string) => ({ id })),
      properties: ["firstname", "lastname", "email", "phone", "jobtitle", "address", "city", "state", "zip"]
    }, { headers: { Authorization: `Bearer ${token}` } });

    res.json({ results: contactsRes.data.results });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.get("/api/hubspot-properties/:objectType", async (req, res) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  const { objectType } = req.params;
  try {
    const url = `https://api.hubapi.com/crm/v3/properties/${objectType}`;
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    res.json({ results: response.data.results });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/create-company", authenticateUser, async (req: any, res: any) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  const { properties } = req.body;
  const userEmail = req.user.email;

  try {
    const owners = await getHubSpotOwners();
    const owner = owners.find((o: any) => o.email?.toLowerCase() === userEmail?.toLowerCase());
    const hubspotOwnerId = owner ? owner.id : "162266949";

    const response = await axios.post("https://api.hubapi.com/crm/v3/objects/companies", {
      properties: {
        ...properties,
        hubspot_owner_id: hubspotOwnerId
      }
    }, { headers: { Authorization: `Bearer ${token}` } });

    res.json(response.data);
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/create-contact", authenticateUser, async (req: any, res: any) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  const { properties, companyId } = req.body;
  const userEmail = req.user.email;

  try {
    const owners = await getHubSpotOwners();
    const owner = owners.find((o: any) => o.email?.toLowerCase() === userEmail?.toLowerCase());
    const hubspotOwnerId = owner ? owner.id : "162266949";

    let contactId: string;
    let contactData: any;

    try {
      // 1. Try to create contact
      const contactRes = await axios.post("https://api.hubapi.com/crm/v3/objects/contacts", {
        properties: {
          ...properties,
          hubspot_owner_id: hubspotOwnerId
        }
      }, { headers: { Authorization: `Bearer ${token}` } });
      
      contactId = contactRes.data.id;
      contactData = contactRes.data;
    } catch (createError: any) {
      // Handle "Contact already exists" error
      if (createError.response?.status === 409 || (createError.response?.data?.message?.includes("already exists"))) {
        const message = createError.response?.data?.message || "";
        const match = message.match(/ID: (\d+)/);
        if (match && match[1]) {
          contactId = match[1];
          // Fetch existing contact data to return it
          const existingRes = await axios.get(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          contactData = existingRes.data;
        } else {
          throw createError;
        }
      } else {
        throw createError;
      }
    }

    // 2. Associate with company
    if (companyId && contactId) {
      try {
        // Use associationTypeId 279 for Contact to Company (Primary)
        // Fallback to 1 (Standard) if needed, but 279 is standard for primary
        await axios.put(`https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`, [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 279 }
        ], { headers: { Authorization: `Bearer ${token}` } });
      } catch (assocError: any) {
        console.error("Association error (Primary 279), trying standard (1):", assocError.response?.data || assocError.message);
        // Fallback to standard association if primary fails
        await axios.put(`https://api.hubapi.com/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`, [
          { associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }
        ], { headers: { Authorization: `Bearer ${token}` } });
      }
    }

    res.json(contactData);
  } catch (error: any) {
    console.error("Create contact error details:", error.response?.data || error.message);
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.get("/api/products", async (req, res) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  try {
    const properties = ["name", "price", "hs_sku", "description"];
    let allResults: any[] = [];
    let after = undefined;
    let hasMore = true;
    while (hasMore) {
      const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=${properties.join(",")}${after ? `&after=${after}` : ""}`;
      const response = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = response.data;
      if (data.results) allResults = [...allResults, ...data.results];
      if (data.paging?.next?.after) after = data.paging.next.after;
      else hasMore = false;
    }
    const sortedProducts = allResults.map((p: any) => ({
      objectId: p.id,
      properties: {
        name: { value: p.properties?.name },
        price: { value: p.properties?.price },
        hs_sku: { value: p.properties?.hs_sku },
        description: { value: p.properties?.description }
      }
    })).sort((a: any, b: any) => {
      const skuA = (a.properties.hs_sku?.value || "").trim();
      const skuB = (b.properties.hs_sku?.value || "").trim();
      if (skuA && !skuB) return -1;
      if (!skuA && skuB) return 1;
      if (skuA !== skuB) return skuA.localeCompare(skuB);
      return (a.properties.name?.value || "").localeCompare(b.properties.name?.value || "");
    });
    res.json({ objects: sortedProducts });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

app.post("/api/submit-order", authenticateUser, async (req: any, res: any) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  const { formData, lineItems } = req.body;
  const userEmail = req.user.email;
  try {
    const owners = await getHubSpotOwners();
    const owner = owners.find((o: any) => o.email?.toLowerCase() === userEmail?.toLowerCase());
    const hubspotOwnerId = owner ? owner.id : "162266949";
    const companySearchResponse = await axios.post("https://api.hubapi.com/crm/v3/objects/companies/search", {
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: formData.companyName }] }],
      properties: ["name"],
    }, { headers: { Authorization: `Bearer ${token}` } });
    const companyData = companySearchResponse.data;
    if (!companyData.results || companyData.results.length === 0) {
      return res.status(404).json({ error: `Company "${formData.companyName}" not found.` });
    }
    const companyId = companyData.results[0].id;
    const contactId = formData.contactId;

    let totalAmount = 0;
    lineItems.forEach((item: any) => { totalAmount += (item.price || 0) * (item.quantity || 0); });
    const dealResponse = await axios.post("https://api.hubapi.com/crm/v3/objects/deals", {
      properties: {
        dealname: `${formData.companyName}`,
        amount: totalAmount.toFixed(2),
        closedate: new Date().toISOString(),
        pipeline: "1231313610",
        dealstage: "1986766585",
        hubspot_owner_id: hubspotOwnerId,
        dealtype: "existingbusiness",
      },
      associations: [
        { to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 }] },
        ...(contactId ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }] : [])
      ],
    }, { headers: { Authorization: `Bearer ${token}` } });
    const dealId = dealResponse.data.id;
    
    // 2. Create Line Items in parallel for better performance
    await Promise.all(lineItems.map((item: any) => 
      axios.post("https://api.hubapi.com/crm/v3/objects/line_items", {
        properties: { quantity: item.quantity.toString(), hs_product_id: item.productId },
        associations: [{ to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 20 }] }],
      }, { headers: { Authorization: `Bearer ${token}` } })
    ));

    // 3. Sync to n8n Webhook (Awaited for reliability in serverless environments like Vercel)
    try {
      await axios.post("https://svjbrands.app.n8n.cloud/webhook/d121d919-f388-4b89-877c-3ba543e94e52", {
        dealId,
        totalAmount: totalAmount.toFixed(2),
        orderDate: new Date().toISOString(),
        customer: {
          companyName: formData.companyName,
          companyId: companyId,
          contactId: formData.contactId,
          firstName: formData.firstName,
          lastName: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          shippingAddress: formData.shippingAddress,
          billingAddress: formData.billingAddress,
          poNumber: formData.poNumber,
          orderNotes: formData.orderNotes
        },
        items: lineItems.map((item: any) => ({
          productId: item.productId,
          name: item.name,
          sku: item.sku,
          price: item.price,
          quantity: item.quantity,
          total: (item.price * item.quantity).toFixed(2)
        })),
        submittedBy: userEmail
      });
    } catch (webhookError: any) {
      console.error("n8n Webhook sync failed:", webhookError.message);
    }

    res.json({ success: true, dealId });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

// Test Gemini Connection
app.get("/api/test-gemini", authenticateUser, async (req: any, res: any) => {
  // PRIORITIZE GEMINI_API_KEY1 as requested by the user
  const key1 = process.env.GEMINI_API_KEY1;
  const key2 = process.env.GEMINI_API_KEY;
  const key3 = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  let apiKey = (key1 || key2 || key3 || "").trim();
  
  // Check for placeholder values
  const placeholders = ["YOUR_GEMINI_API_KEY", "YOUR_API_KEY", "PASTE_YOUR_KEY_HERE"];
  if (placeholders.includes(apiKey.toUpperCase())) {
    apiKey = "";
  }
  
  if (apiKey.startsWith('"') && apiKey.endsWith('"')) apiKey = apiKey.substring(1, apiKey.length - 1);
  if (apiKey.startsWith("'") && apiKey.endsWith("'")) apiKey = apiKey.substring(1, apiKey.length - 1);

  const source = key1 ? "GEMINI_API_KEY1" : (key2 ? "GEMINI_API_KEY" : (key3 ? "FIREBASE_API_KEY" : "NONE"));

  try {
    if (!apiKey) throw new Error("No API key configured");
    
    const host = req.headers['x-forwarded-host'] || req.headers.host || "ais-dev-w7bpy4kc5bzmt7lupixekf-733054587685.asia-southeast1.run.app";
    const protocol = req.headers['x-forwarded-proto'] || "https";
    const currentOrigin = `${protocol}://${host}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
    
    let geminiRes;
    let usedFallback = false;
    
    try {
      geminiRes = await axios.post(url, {
        contents: [{ parts: [{ text: "Say 'Connection Successful'" }] }]
      }, {
        headers: {
          "Referer": currentOrigin,
          "Content-Type": "application/json"
        },
        timeout: 30000
      });
    } catch (primaryError: any) {
      const isHighDemand = primaryError.response?.status === 503 || 
                          (primaryError.response?.data?.error?.message?.includes("high demand"));
      
      if (isHighDemand) {
        console.warn("[AI Test] Primary model busy, trying fallback...");
        usedFallback = true;
        geminiRes = await axios.post(fallbackUrl, {
          contents: [{ parts: [{ text: "Say 'Connection Successful (Fallback)'" }] }]
        }, {
          headers: {
            "Referer": currentOrigin,
            "Content-Type": "application/json"
          },
          timeout: 30000
        });
      } else {
        throw primaryError;
      }
    }

    res.json({ 
      success: true, 
      message: geminiRes.data.candidates?.[0]?.content?.parts?.[0]?.text || "No text returned",
      diagnostics: {
        source,
        prefix: apiKey.substring(0, 7),
        suffix: apiKey.substring(apiKey.length - 4),
        length: apiKey.length,
        usedFallback
      }
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      diagnostics: {
        source,
        prefix: apiKey ? apiKey.substring(0, 7) : "none",
        suffix: apiKey ? apiKey.substring(apiKey.length - 4) : "none",
        length: apiKey ? apiKey.length : 0
      }
    });
  }
});

// AI Processing Endpoint (Vercel API Route)
app.post("/api/process-ai", authenticateUser, async (req: any, res: any) => {
  const { text, image } = req.body;
  // PRIORITIZE GEMINI_API_KEY1 as requested by the user
  const key1 = process.env.GEMINI_API_KEY1;
  const key2 = process.env.GEMINI_API_KEY;
  const key3 = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  let apiKey = (key1 || key2 || key3 || "").trim();
  
  // Check for placeholder values
  const placeholders = ["YOUR_GEMINI_API_KEY", "YOUR_API_KEY", "PASTE_YOUR_KEY_HERE"];
  if (placeholders.includes(apiKey.toUpperCase())) {
    apiKey = "";
  }
  
  // Remove accidental quotes if present
  if (apiKey.startsWith('"') && apiKey.endsWith('"')) {
    apiKey = apiKey.substring(1, apiKey.length - 1);
  }
  if (apiKey.startsWith("'") && apiKey.endsWith("'")) {
    apiKey = apiKey.substring(1, apiKey.length - 1);
  }

  const source = key1 ? "GEMINI_API_KEY1" : (key2 ? "GEMINI_API_KEY" : (key3 ? "FIREBASE_API_KEY" : "NONE"));
  
  try {
    if (!apiKey) {
      console.error("[AI] Gemini API key not found in environment variables. Checked: GEMINI_API_KEY, GEMINI_API_KEY1, FIREBASE_API_KEY");
      return res.status(500).json({ error: "Gemini API key not configured on server. Please ensure GEMINI_API_KEY or GEMINI_API_KEY1 is set." });
    }

    if (apiKey.startsWith("AIzaSyB")) {
      console.warn(`[AI] Warning: You appear to be using a Firebase Browser Key for Gemini (Source: ${source}). If this fails with 'API key not valid', ensure the 'Generative Language API' is enabled for this key in Google Cloud Console, or use your 'Default Gemini API Key' instead.`);
    }

    console.log(`[AI] Using Gemini key. Source: ${source}. Length: ${apiKey.length}. Snippet: ${apiKey.substring(0, 7)}...`);

    // Detect origin for Referer header (Crucial for Vercel/AI Studio website restrictions)
    const host = req.headers['x-forwarded-host'] || req.headers.host || "ais-dev-w7bpy4kc5bzmt7lupixekf-733054587685.asia-southeast1.run.app";
    const protocol = req.headers['x-forwarded-proto'] || "https";
    const currentOrigin = `${protocol}://${host}`;
    
    console.log(`[AI] Processing request. Origin: ${currentOrigin}, Key Source: ${source}`);

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    const fallbackUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`;
    
    // Fetch products for SKU matching
    const token = await getHubSpotToken();
    let availableSkus = "";
    if (token) {
      try {
        const productsRes = await axios.get('https://api.hubapi.com/crm/v3/objects/products', {
          params: { properties: 'hs_sku,name', limit: 100 },
          headers: { Authorization: `Bearer ${token}` }
        });
        availableSkus = productsRes.data.results.map((p: any) => p.properties.hs_sku).filter(Boolean).join(", ");
      } catch (e) {
        console.warn("[AI] Could not fetch products for SKU matching:", e);
      }
    }

    const systemInstruction = `You are an order processing assistant for SVJ Brands. 
    Your task is to extract order information from text (SMS, email) or images.
    
    Available SKUs in our system: ${availableSkus}
    
    Extract:
    1. Company Name (if present)
    2. Line Items: A list of products with their SKU and Quantity.
    
    Return ONLY a JSON object in this format:
    {
      "companyName": "string or null",
      "lineItems": [
        { "sku": "string", "quantity": number }
      ]
    }
    
    If you see a product name but no SKU, try to match it to the available SKUs provided.
    If you cannot find a piece of information, leave it as null or an empty array.`;

    let parts: any[] = [];
    if (text) parts.push({ text: `${systemInstruction}\n\nUser Input:\n${text}` });
    else parts.push({ text: systemInstruction });

    if (image && image.data) {
      parts.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      });
    }

    const geminiPayload = {
      contents: [{ parts }]
    };

    let geminiResponse;
    let usedFallback = false;
    
    try {
      // First attempt with primary model
      geminiResponse = await axios.post(geminiUrl, geminiPayload, {
        headers: {
          "Referer": currentOrigin,
          "Content-Type": "application/json"
        },
        timeout: 60000
      });
    } catch (primaryError: any) {
      const isHighDemand = primaryError.response?.status === 503 || 
                          (primaryError.response?.data?.error?.message?.includes("high demand"));
      
      if (isHighDemand) {
        console.warn("[AI] Primary model (gemini-3-flash-preview) is experiencing high demand. Waiting 2s before trying fallback model (gemini-3.1-flash-lite-preview)...");
        await new Promise(resolve => setTimeout(resolve, 2000));
        try {
          usedFallback = true;
          geminiResponse = await axios.post(fallbackUrl, geminiPayload, {
            headers: {
              "Referer": currentOrigin,
              "Content-Type": "application/json"
            },
            timeout: 60000
          });
        } catch (fallbackError: any) {
          console.error("[AI] Fallback model also failed:", fallbackError.message);
          throw primaryError; // Throw the original error if fallback also fails
        }
      } else {
        throw primaryError;
      }
    }

    const aiText = geminiResponse.data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!aiText) {
      throw new Error("Gemini returned an empty response. Check API key and restrictions.");
    }

    // Clean up JSON response
    const jsonMatch = aiText.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json({ ...result, _meta: { usedFallback } });
  } catch (error: any) {
    const apiError = error.response?.data || error.message;
    console.error('[AI] Full Error Object:', JSON.stringify(apiError, null, 2));
    
    // Extract specific error message if it's a Google API error
    let errorMessage = "AI processing failed";
    let details = typeof apiError === 'object' ? JSON.stringify(apiError) : apiError;
    
    if (typeof apiError === 'object' && apiError.error) {
      errorMessage = apiError.error.message || errorMessage;
    } else if (typeof apiError === 'string') {
      errorMessage = apiError;
    }

    res.status(500).json({ 
      error: errorMessage, 
      details: details,
      diagnostics: {
        keySource: source,
        keyPrefix: apiKey ? apiKey.substring(0, 7) : "none",
        keySuffix: apiKey ? apiKey.substring(apiKey.length - 4) : "none",
        keyLength: apiKey ? apiKey.length : 0
      }
    });
  }
});

export default app;
