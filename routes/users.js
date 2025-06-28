const express = require("express");
const router = express.Router();
const { db } = require("../firebase.js");
// const verifyToken = require("../middleware/auth");

router.post("/signup", async (req, res) => {
  const { uid, name, email, tokens , swaps} = req.body;

  try {
    await db.collection("users").doc(uid).set({
      name,
      email,
      swaps,
      tokens,
      wallet: [],
      coupons: [],
    });

    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to create user" });
  }
});

router.put('/user-preferences', async (req, res) => {
  const { uid, prefered_platforms, prefered_categories } = req.body;

  if (!uid || !prefered_platforms || !prefered_categories) {
    return res.status(400).json({ error: "UID, platforms, and categories are required" });
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({
      prefered_platforms,
      prefered_categories,
    });

    res.json({ message: "User preferences updated successfully" });
  }
  catch (err) {
    res.status(500).json({ error: "Failed to update user preferences" });
  }
});

// 2. Get user by UID
router.get("/:uid", async (req, res) => {
  const uid = req.params.uid;

  try {
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(userDoc.data());
  } catch (err) {
    res.status(500).json({ error: "Failed to get user" });
  }
});

// 3. Update user wallet or coupons
router.put("/wallet", async (req, res) => {
  const { uid, wallet } = req.body;

  if (!uid) {
    return res.status(400).json({ error: "UID is required" });
  }

  try {
    const userRef = db.collection("users").doc(uid);
    await userRef.update({
      ...(wallet && { wallet }),
    });

    res.json({ message: "Wallet updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to update user" });
  }
});

router.put("/update-tokens", async (req, res) => {
  const { uid, tokens } = req.body;

  if (!uid || typeof tokens !== "number") {
    return res
      .status(400)
      .json({ error: "Valid UID and numeric tokens are required" });
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    await userRef.update({ tokens });
    res.json({ message: "Tokens updated successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update tokens" });
  }
});

module.exports = router;
