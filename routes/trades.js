const express = require("express");
const router = express.Router();
const { db } = require("../firebase");

// {
//   id: "abc123",    
//   user1: "uid_abc123",        
//   user2: "uid_xyz456",        
//   user1_coupons: ["coup1", "coup2"],   
//   user2_coupons: ["coupX"],           
//   room_id: "room123",          
//   status: "pending",          
//   confirmedBy: [],             
//   confirmedAt: null,           
//   createdAt: Timestamp       
// }

router.get("/:uid", async (req, res) => {
  try {
    const uid = req.params.uid;

    const user1Snap = await db
      .collection("trades")
      .where("user1", "==", uid)
      .get();

    const user2Snap = await db
      .collection("trades")
      .where("user2", "==", uid)
      .get();

    const allTrades = [...user1Snap.docs, ...user2Snap.docs]
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter(
        (trade) => trade.status === "pending" || trade.status === "waiting"
      );

    res.json(allTrades);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch trades" });
  }
});

// 🔁 POST new trade with multiple coupons
router.post("/upload-trade", async (req, res) => {
  try {
    const {
      user1,
      user2,
      user1_coupons, // expect: ["coupA", "coupB"]
      user2_coupons, // expect: ["coupX"]
      room_id,
    } = req.body;

    // Validate input
    if (
      !user1 ||
      !user2 ||
      !Array.isArray(user1_coupons) ||
      !Array.isArray(user2_coupons)
    ) {
      return res.status(400).json({ error: "Missing or invalid trade fields" });
    }

    const tradeDoc = {
      user1,
      user2,
      user1_coupons,
      user2_coupons,
      room_id,
      status: "pending",
      createdAt: new Date(),
      confirmedBy: [],
      confirmedAt: null,
    };

    const ref = await db.collection("trades").add(tradeDoc);
    res.status(201).json({ id: ref.id, ...tradeDoc });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create trade" });
  }
});

module.exports = router;
