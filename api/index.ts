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
  if (HUBSPOT_ACCESS_TOKEN_ENV) return HUBSPOT_ACCESS_TOKEN_ENV;
  if (cachedDbToken) return cachedDbToken;

  try {
    const doc = await admin.firestore().collection("config").doc("hubspot").get();
    if (doc.exists) {
      cachedDbToken = doc.data()?.token;
      return cachedDbToken;
    }
  } catch (err) {
    console.error("[Firebase] Error fetching HubSpot token:", err);
  }
  return null;
}

// Initialize Firebase Admin
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  let projectId = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "gen-lang-client-0125145098";
  let databaseId = process.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID || "ai-studio-f4d77b55-6f5e-42f7-a496-84f9e8a52ad4";

  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    projectId = firebaseConfig.projectId;
    databaseId = firebaseConfig.firestoreDatabaseId || databaseId;
    console.log("[Firebase Admin] Initializing with file config for project:", projectId);
  } else {
    console.log("[Firebase Admin] Initializing with env project ID:", projectId);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: projectId,
    });
    
    // Set the databaseId for Firestore if provided
    if (databaseId) {
      console.log("[Firebase Admin] Using Firestore Database ID:", databaseId);
      admin.firestore().settings({ databaseId: databaseId });
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
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    if (!decodedToken.email?.endsWith("@svjbrands.com")) {
      return res.status(403).json({ error: "Forbidden: Access restricted to @svjbrands.com accounts" });
    }
    req.user = decodedToken;
    next();
  } catch (error) {
    res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

app.get("/api/health", async (req, res) => {
  const token = await getHubSpotToken();
  res.json({ 
    status: "ok", 
    time: new Date().toISOString(),
    tokenConfigured: !!token,
    tokenPrefix: token ? token.substring(0, 7) : null
  });
});

app.get("/api/companies", async (req, res) => {
  const token = await getHubSpotToken();
  if (!token) return res.status(500).json({ error: "HubSpot Token not configured" });
  try {
    const properties = ["name", "address", "city", "state", "zip", "phone", "ein_number", "billing_address", "shipping_address"];
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
    const hubspotOwnerId = owner ? owner.id : "161583536";
    const companySearchResponse = await axios.post("https://api.hubapi.com/crm/v3/objects/companies/search", {
      filterGroups: [{ filters: [{ propertyName: "name", operator: "EQ", value: formData.companyName }] }],
      properties: ["name"],
    }, { headers: { Authorization: `Bearer ${token}` } });
    const companyData = companySearchResponse.data;
    if (!companyData.results || companyData.results.length === 0) {
      return res.status(404).json({ error: `Company "${formData.companyName}" not found.` });
    }
    const companyId = companyData.results[0].id;
    let totalAmount = 0;
    lineItems.forEach((item: any) => { totalAmount += (item.price || 0) * (item.quantity || 0); });
    const dealResponse = await axios.post("https://api.hubapi.com/crm/v3/objects/deals", {
      properties: {
        dealname: `${formData.companyName} Reorder`,
        amount: totalAmount.toFixed(2),
        closedate: new Date().toISOString(),
        pipeline: "1231313610",
        dealstage: "1986766585",
        hubspot_owner_id: hubspotOwnerId,
        dealtype: "existingbusiness",
      },
      associations: [{ to: { id: companyId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 5 }] }],
    }, { headers: { Authorization: `Bearer ${token}` } });
    const dealId = dealResponse.data.id;
    for (const item of lineItems) {
      await axios.post("https://api.hubapi.com/crm/v3/objects/line_items", {
        properties: { quantity: item.quantity.toString(), hs_product_id: item.productId },
        associations: [{ to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 20 }] }],
      }, { headers: { Authorization: `Bearer ${token}` } });
    }
    res.json({ success: true, dealId });
  } catch (error: any) {
    res.status(error.response?.status || 500).json({ error: error.response?.data?.message || error.message });
  }
});

// AI Processing Endpoint
app.post("/api/process-ai", authenticateUser, async (req: any, res: any) => {
  try {
    const { text, image } = req.body;
    const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY1 || process.env.GEMENI_API_KEY1;
    
    if (!apiKey) {
      console.error("[AI] Gemini API key not found in environment variables");
      return res.status(500).json({ error: "Gemini API key not configured on server. Please add GEMINI_API_KEY to Vercel." });
    }

    const ai = new GoogleGenAI({ apiKey });
    const model = "gemini-3-flash-preview";

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

    let contents: any = [];
    if (text) contents.push({ text });
    if (image && image.data) {
      contents.push({
        inlineData: {
          mimeType: image.mimeType,
          data: image.data
        }
      });
    }

    const result = await ai.models.generateContent({
      model,
      contents: { parts: contents },
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            companyName: { type: Type.STRING },
            lineItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sku: { type: Type.STRING },
                  quantity: { type: Type.NUMBER }
                },
                required: ["sku", "quantity"]
              }
            }
          }
        }
      }
    });

    res.json(JSON.parse(result.text || "{}"));
  } catch (error: any) {
    console.error('[AI] Processing Error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default app;
