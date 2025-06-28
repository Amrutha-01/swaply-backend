const express = require("express");
const router = express.Router();
const { db } = require("../firebase");
const formidable = require("formidable");
const fs = require("fs");
import { extractCouponsFromDocument } from "../processDocument";

const PLATFORM_WEIGHT = 0.8;
const CATEGORY_WEIGHT = 0.15;

// POST /api/coupons
router.post("/upload-coupon-img", (req, res) => {
  const form = formidable({ uploadDir: "./uploads", keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: "Form parsing failed" });

    const uid = fields.uid;
    const image = files.image;

    if (!uid || !image) {
      return res.status(400).json({ error: "Image and UID are required" });
    }

    try {
      const filePath = image[0]?.filepath || image.filepath;

      const result = await extractCouponsFromDocument(filePath);

      if (result) {
        await db.collection("coupons").add({
          owner_uid: uid,
          platform: result.platform,
          result: result.category,
          description:result.summary,
          image: filePath,
          result:result.value,
          coupon_code:result.coupon_code,
          expiry_date: new Date(expiry_date).toISOString(),
          createdAt: new Date().toISOString(),
        });
      }

      fs.unlinkSync(filePath); // delete file after processing (optional)
      res.json({ result });
    } catch (err) {
      console.error("Error:", err);
      res.status(500).json({ error: "Failed to process image" });
    }
  });
});

router.post("/upload-coupon", async (req, res) => {
  const { platform, value, expiry_date,category, description, image, uid, coupon_code } = req.body;

  if (!uid) {
    return res.status(400).json({ error: "UID is required" });
  }
  if (!platform || !value || !expiry_date || !category || !description || !image) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    return res.status(404).json({ error: "User not found" });
  }
  const userData = userDoc.data();
  const wallet = userData.wallet || [];


  try {
    const newCoupon = {
      owner_uid: uid,
      platform,
      category,
      description,
      image,
      value,
      coupon_code,
      expiry_date: new Date(expiry_date).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection("coupons").add(newCoupon);

    if(docRef.id && !wallet.includes(docRef.id)) {
      wallet.push(docRef.id); 
      await userRef.update({ wallet });
    }

    res.status(201).json({ message: "Coupon uploaded", id: docRef.id });
  } catch (err) {
    res.status(500).json({ error: "Failed to upload coupon" });
  }
});

router.put("/edit-coupon", async (req, res) => {
  const { couponId, updates } = req.body;

  if (!couponId || !updates || typeof updates !== "object") {
    return res
      .status(400)
      .json({ error: "couponId and updates object are required" });
  }

  try {
    const couponRef = db.collection("coupons").doc(couponId);
    const doc = await couponRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: "Coupon not found" });
    }

    await couponRef.update(updates);

    res.json({
      message: "Coupon updated successfully",
      updatedFields: updates,
    });
  } catch (err) {
    console.error("Error editing coupon:", err);
    res.status(500).json({ error: "Failed to update coupon" });
  }
});

// GET /api/coupons
router.get("/", async (req, res) => {
  try {
    const snapshot = await db
      .collection("coupons")
      .orderBy("createdAt", "desc")
      .get();

    const coupons = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json(coupons);
  } catch (err) {
    console.error("Error fetching coupons:", err);
    res.status(500).json({ error: "Failed to fetch coupons" });
  }
});

router.get("/matches/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    // 1. Fetch user
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists)
      return res.status(404).json({ error: "User not found" });

    const { prefered_platforms = [], prefered_categories = [] } = userSnap.data();
    if (!prefered_platforms.length && !prefered_categories.length)
      return res.json([]);

    // 2. Fetch all coupons (could be optimized later)
    const allCouponsSnap = await db.collection("coupons").get();
    const allCoupons = allCouponsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((coupon) => coupon.owner_uid !== uid); // Exclude own coupons

    // 3. Score each match
    const matches = [];

    for (const coupon of allCoupons) {
      const platformMatch = prefered_platforms.includes(coupon.platform);
      const categoryMatch = prefered_categories.includes(coupon.category);

      if (!platformMatch && !categoryMatch) continue; // No match at all

      const score = Math.round(
        ((platformMatch ? PLATFORM_WEIGHT : 0) +
          (categoryMatch ? CATEGORY_WEIGHT : 0)) *
          100
      );

      matches.push({
        ...coupon,
        score,
      });
    }

    // 4. Sort by soonest expiry
    matches.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate matches" });
  }
});

// GET /api/coupons/search?q=...&sort=asc|desc
router.get('/search', async (req, res) => {
  try {
    const { q, sort } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing query string (q)' });

    const keywords = q.toLowerCase().split(/\s+/);
    const snapshot = await db.collection('coupons').get();

    const results = snapshot.docs
      .map(doc => {
        const data = doc.data();
        const expiry = typeof data.expiry_date === 'string'
          ? new Date(data.expiry_date)
          : data.expiry_date?._seconds
            ? new Date(data.expiry_date._seconds * 1000)
            : null;

        return {
          id: doc.id,
          ...data,
          __expiryDate: expiry // temp field for sorting
        };
      })
      .filter(coupon => {
        const {
          platform = '',
          category = '',
          value = {},
          __expiryDate
        } = coupon;

        const expiryStr = __expiryDate ? __expiryDate.toISOString().toLowerCase() : '';

        const fields = [
          platform.toLowerCase(),
          category.toLowerCase(),
          value.type?.toLowerCase() || '',
          String(value.amount || ''),
          expiryStr
        ];

        return keywords.some(keyword =>
          fields.some(field => field.includes(keyword))
        );
      });

    // ✅ Sort by expiry if requested
    if (sort === 'asc' || sort === 'desc') {
      results.sort((a, b) => {
        const dateA = a.__expiryDate ? new Date(a.__expiryDate) : new Date(0);
        const dateB = b.__expiryDate ? new Date(b.__expiryDate) : new Date(0);
        return sort === 'asc'
          ? dateA - dateB
          : dateB - dateA;
      });
    }

    // Clean up temp field
    const cleanResults = results.map(({ __expiryDate, ...rest }) => rest);

    res.json(cleanResults);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
