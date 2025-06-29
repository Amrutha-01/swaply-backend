const express = require("express");
const router = express.Router();
const path = require("path");
const { db } = require("../firebase");
const fs = require("fs");
const multer = require("multer");
const mime = require("mime-types");
const { extractCouponsFromDocument } = require("../processDocument");

const PLATFORM_WEIGHT = 0.8;
const CATEGORY_WEIGHT = 0.15;

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}_${file.originalname}`);
  },
});
const upload = multer({ storage });

/**
 * @route POST /api/extract-coupons
 * @desc Upload a document and extract coupon offers
 * @access Public
 */
router.post(
  "/extract-coupons",
  // Accept any single file field (to avoid Unexpected field errors)
  (req, res, next) => {
    upload.any()(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      } else if (err) {
        return res
          .status(500)
          .json({ error: `Unknown upload error: ${err.message}` });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.files || !req.files.length) {
        return res.status(400).json({ error: "No file uploaded." });
      }

      // Use the first uploaded file
      const file = req.files[0];
      const { path: filePath, originalname: originalName, mimetype } = file;
      const mimeType = mime.lookup(originalName) || mimetype;

      const result = await extractCouponsFromDocument(
        filePath,
        mimeType,
        originalName
      );
      // Optionally remove file: fs.unlinkSync(filePath);

      if (result.error) {
        return res.status(500).json({ error: result.error });
      }
      return res.json(result);
    } catch (err) {
      console.error("❌ Error in /extract-coupons:", err);
      return res.status(500).json({ error: "Internal server error." });
    }
  }
);

// Other coupon-related routes below (unchanged)

router.post("/upload-coupon", async (req, res) => {
  const {
    platform,
    value,
    expiry_date,
    category,
    description,
    image,
    uid,
    coupon_code,
  } = req.body;

  if (!uid) return res.status(400).json({ error: "UID is required" });
  if (
    !platform ||
    !value ||
    !expiry_date ||
    !category   ) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists)
      return res.status(404).json({ error: "User not found" });

    const wallet = userDoc.data().wallet || [];
    const newCoupon = {
      owner_uid: uid,
      platform,
      category,
      description,
      image: image || "",
      value,
      coupon_code: coupon_code || null,
      expiry_date: new Date(expiry_date).toISOString(),
      createdAt: new Date().toISOString(),
    };

    const docRef = await db.collection("coupons").add(newCoupon);
    if (docRef.id && !wallet.includes(docRef.id)) {
      wallet.push(docRef.id);
      await userRef.update({ wallet });
    }

    return res.status(201).json({ message: "Coupon uploaded", id: docRef.id });
  } catch (err) {
    console.error("❌ Error in /upload-coupon:", err);
    return res.status(500).json({ error: "Failed to upload coupon" });
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
    if (!doc.exists) return res.status(404).json({ error: "Coupon not found" });

    await couponRef.update(updates);
    return res.json({
      message: "Coupon updated successfully",
      updatedFields: updates,
    });
  } catch (err) {
    console.error("❌ Error editing coupon:", err);
    return res.status(500).json({ error: "Failed to update coupon" });
  }
});

router.get("/", async (req, res) => {
  try {
    const snapshot = await db
      .collection("coupons")
      .orderBy("createdAt", "desc")
      .get();
    const coupons = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return res.json(coupons);
  } catch (err) {
    console.error("❌ Error fetching coupons:", err);
    return res.status(500).json({ error: "Failed to fetch coupons" });
  }
});

router.get("/matches/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;
    const userSnap = await db.collection("users").doc(uid).get();
    if (!userSnap.exists)
      return res.status(404).json({ error: "User not found" });

    const { prefered_platforms = [], prefered_categories = [] } =
      userSnap.data();
    if (!prefered_platforms.length && !prefered_categories.length)
      return res.json([]);

    const allCouponsSnap = await db.collection("coupons").get();
    const allCoupons = allCouponsSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((coupon) => coupon.owner_uid !== uid);

    const matches = allCoupons.reduce((acc, coupon) => {
      const platformMatch = prefered_platforms.includes(coupon.platform);
      const categoryMatch = prefered_categories.includes(coupon.category);
      if (!platformMatch && !categoryMatch) return acc;
      const score = Math.round(
        ((platformMatch ? PLATFORM_WEIGHT : 0) +
          (categoryMatch ? CATEGORY_WEIGHT : 0)) *
          100
      );
      acc.push({ ...coupon, score });
      return acc;
    }, []);

    matches.sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date));
    return res.json(matches);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to generate matches" });
  }
});

router.get("/search", async (req, res) => {
  try {
    const { q, sort } = req.query;
    if (!q) return res.status(400).json({ error: "Missing query string (q)" });

    const keywords = q.toLowerCase().split(/\s+/);
    const snapshot = await db.collection("coupons").get();
    const results = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        let expiryDate = null;
        if (typeof data.expiry_date === "string")
          expiryDate = new Date(data.expiry_date);
        else if (data.expiry_date?._seconds)
          expiryDate = new Date(data.expiry_date._seconds * 1000);

        return { id: doc.id, ...data, __expiryDate: expiryDate };
      })
      .filter((coupon) => {
        const fields = [
          (coupon.platform || "").toLowerCase(),
          (coupon.category || "").toLowerCase(),
          (coupon.value?.type || "").toLowerCase(),
          String(coupon.value?.amount || ""),
          coupon.__expiryDate
            ? coupon.__expiryDate.toISOString().toLowerCase()
            : "",
        ];
        return keywords.some((kw) => fields.some((f) => f.includes(kw)));
      });

    if (sort === "asc" || sort === "desc") {
      results.sort((a, b) =>
        sort === "asc"
          ? a.__expiryDate - b.__expiryDate
          : b.__expiryDate - a.__expiryDate
      );
    }

    const clean = results.map(({ __expiryDate, ...rest }) => rest);
    return res.json(clean);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Search failed" });
  }
});

module.exports = router;
