import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import admin from "firebase-admin";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  console.log("Starting SVJ Brands Wholesale Portal Server...");

  app.use(express.json());

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
    const firebaseConfig = JSON.parse(await fs.promises.readFile(path.join(process.cwd(), "firebase-applet-config.json"), "utf8"));
    admin.initializeApp({
      projectId: firebaseConfig.projectId,
    });
    console.log(`Firebase Admin initialized successfully for project: ${firebaseConfig.projectId}`);
  } catch (err) {
    console.error("Firebase Admin initialization error:", err);
    // Fallback if file not found or invalid
    admin.initializeApp({
      projectId: "gen-lang-client-0125145098",
    });
  }

  // Cache for HubSpot owners
  let hubspotOwnersCache: any[] = [];
  let lastOwnersFetch = 0;
  let lastOwnersFetchAttempt = 0;
  const CACHE_TTL = 1000 * 60 * 60; // 1 hour

  async function getHubSpotOwners() {
    // If we have data and it's fresh, return it
    if (hubspotOwnersCache.length > 0 && Date.now() - lastOwnersFetch < CACHE_TTL) {
      return hubspotOwnersCache;
    }

    // If we recently failed (especially with a 403), don't spam the API
    if (lastOwnersFetch === -1 && Date.now() - lastOwnersFetchAttempt < CACHE_TTL) {
      return [];
    }

    const token = await getHubSpotToken();
    if (!token) return [];

    try {
      console.log("[HubSpot] Fetching owners...");
      lastOwnersFetchAttempt = Date.now();
      const response = await axios.get("https://api.hubapi.com/crm/v3/owners?limit=100", {
        headers: { Authorization: `Bearer ${token}` }
      });
      hubspotOwnersCache = response.data.results || [];
      lastOwnersFetch = Date.now();
      console.log(`[HubSpot] Fetched ${hubspotOwnersCache.length} owners`);
      return hubspotOwnersCache;
    } catch (err: any) {
      const status = err.response?.status;
      if (status === 403) {
        console.error("[HubSpot] 403 Forbidden: Your HubSpot Access Token lacks the 'crm.objects.owners.read' scope. Owner mapping will use default ID.");
        lastOwnersFetch = -1; // Mark as failed due to permissions
      } else {
        console.error("[HubSpot] Error fetching owners:", err.response?.data?.message || err.message);
      }
      return hubspotOwnersCache; // Return stale cache or empty array
    }
  }

  // Middleware to verify Firebase token
  const authenticateUser = async (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: No token provided" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    try {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      
      // Enforce @svjbrands.com domain
      if (!decodedToken.email?.endsWith("@svjbrands.com")) {
        console.warn(`[Auth] Access denied for non-svjbrands email: ${decodedToken.email}`);
        return res.status(403).json({ error: "Forbidden: Access restricted to @svjbrands.com accounts" });
      }

      req.user = decodedToken;
      next();
    } catch (error) {
      console.error("Firebase token verification error:", error);
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
    console.log(`[API] GET /api/companies - Auth: ${!!token}`);
    
    if (!token) {
      console.error("HubSpot Token is missing from both Environment and Firebase");
      return res.status(500).json({ error: "HubSpot Token not configured" });
    }

    try {
      const properties = ["name", "address", "city", "state", "zip", "phone", "ein_number", "billing_address", "shipping_address"];
      let allResults: any[] = [];
      let after = undefined;
      let hasMore = true;

      while (hasMore) {
        const url = `https://api.hubapi.com/crm/v3/objects/companies?limit=100&properties=${properties.join(",")}${after ? `&after=${after}` : ""}`;
        
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        const data = response.data;
        if (data.results) {
          allResults = [...allResults, ...data.results];
        }

        if (data.paging?.next?.after) {
          after = data.paging.next.after;
        } else {
          hasMore = false;
        }
      }

      console.log(`[HubSpot] Fetched total ${allResults.length} companies`);
      
      // Filter out companies with blank names and sort by name
      const filteredCompanies = allResults
        .filter((c: any) => c.properties?.name && c.properties.name.trim() !== "")
        .sort((a: any, b: any) => 
          (a.properties?.name || "").localeCompare(b.properties?.name || "")
        );
      
      console.log(`[API] Returning ${filteredCompanies.length} companies (filtered from ${allResults.length})`);
      res.json({ results: filteredCompanies });
    } catch (error: any) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;
      console.error(`[HubSpot] Error fetching companies (${status}):`, message);
      res.status(status).json({ error: `HubSpot API error: ${message}` });
    }
  });

  app.get("/api/products", async (req, res) => {
    const token = await getHubSpotToken();
    console.log(`[API] GET /api/products - Auth: ${!!token}`);

    if (!token) {
      return res.status(500).json({ error: "HubSpot Token not configured" });
    }

    try {
      const properties = ["name", "price", "hs_sku", "description"];
      let allResults: any[] = [];
      let after = undefined;
      let hasMore = true;

      while (hasMore) {
        const url = `https://api.hubapi.com/crm/v3/objects/products?limit=100&properties=${properties.join(",")}${after ? `&after=${after}` : ""}`;
        
        const response = await axios.get(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });

        const data = response.data;
        if (data.results) {
          allResults = [...allResults, ...data.results];
        }

        if (data.paging?.next?.after) {
          after = data.paging.next.after;
        } else {
          hasMore = false;
        }
      }

      console.log(`[HubSpot] Fetched total ${allResults.length} products`);
      
      // Sort by SKU first, then by Name
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
        const nameA = (a.properties.name?.value || "").trim();
        const nameB = (b.properties.name?.value || "").trim();

        if (skuA && !skuB) return -1;
        if (!skuA && skuB) return 1;

        if (skuA !== skuB) return skuA.localeCompare(skuB);
        return nameA.localeCompare(nameB);
      });

      res.json({ objects: sortedProducts });
    } catch (error: any) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;
      console.error(`[HubSpot] Error fetching products (${status}):`, message);
      res.status(status).json({ error: `HubSpot API error: ${message}` });
    }
  });

  app.post("/api/submit-order", authenticateUser, async (req: any, res: any) => {
    const token = await getHubSpotToken();
    console.log(`[API] POST /api/submit-order - Auth: ${!!token}`);

    if (!token) {
      return res.status(500).json({ error: "HubSpot Token not configured" });
    }

    const { formData, lineItems } = req.body;
    const userEmail = req.user.email;

    try {
      // 0. Map User to HubSpot Owner
      const owners = await getHubSpotOwners();
      const owner = owners.find((o: any) => o.email?.toLowerCase() === userEmail?.toLowerCase());
      const hubspotOwnerId = owner ? owner.id : "161583536"; // Fallback to default if not found
      
      console.log(`[HubSpot] Mapping user ${userEmail} to owner ID: ${hubspotOwnerId}`);

      // 1. Search for Company
      console.log(`[HubSpot] Searching for company: ${formData.companyName}`);
      const companySearchResponse = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/companies/search",
        {
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "name",
                  operator: "EQ",
                  value: formData.companyName,
                },
              ],
            },
          ],
          properties: ["name"],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const companyData = companySearchResponse.data;
      if (!companyData.results || companyData.results.length === 0) {
        return res.status(404).json({ error: `Company "${formData.companyName}" not found in HubSpot.` });
      }
      const companyId = companyData.results[0].id;

      // 2. Calculate Total Amount
      let totalAmount = 0;
      lineItems.forEach((item: any) => {
        totalAmount += (item.price || 0) * (item.quantity || 0);
      });

      // 3. Create Deal
      console.log(`[HubSpot] Creating deal for company: ${companyId}`);
      const dealResponse = await axios.post(
        "https://api.hubapi.com/crm/v3/objects/deals",
        {
          properties: {
            dealname: `${formData.companyName} Reorder`,
            amount: totalAmount.toFixed(2),
            closedate: new Date().toISOString(),
            pipeline: "1231313610",
            dealstage: "1986766585",
            hubspot_owner_id: hubspotOwnerId,
            dealtype: "existingbusiness",
          },
          associations: [
            {
              to: { id: companyId },
              types: [
                {
                  associationCategory: "HUBSPOT_DEFINED",
                  associationTypeId: 5, // Company to Deal
                },
              ],
            },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      const dealData = dealResponse.data;
      const dealId = dealData.id;

      // 4. Create Line Items
      console.log(`[HubSpot] Creating ${lineItems.length} line items for deal: ${dealId}`);
      for (const item of lineItems) {
        await axios.post(
          "https://api.hubapi.com/crm/v3/objects/line_items",
          {
            properties: {
              quantity: item.quantity.toString(),
              hs_product_id: item.productId,
            },
            associations: [
              {
                to: { id: dealId },
                types: [
                  {
                    associationCategory: "HUBSPOT_DEFINED",
                    associationTypeId: 20, // Line Item to Deal
                  },
                ],
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );
      }

      console.log(`[API] Order submitted successfully: ${dealId}`);
      res.json({ success: true, dealId });
    } catch (error: any) {
      const status = error.response?.status || 500;
      const message = error.response?.data?.message || error.message;
      console.error(`[HubSpot] Error submitting order (${status}):`, message);
      res.status(status).json({ error: `HubSpot API error: ${message}` });
    }
  });

  // API 404 handler - prevents HTML fallback for API routes
  app.use("/api/*", (req, res) => {
    console.warn(`[API] 404 - Not Found: ${req.originalUrl}`);
    res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
