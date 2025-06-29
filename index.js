const express = require("express");
const http = require("http");
const cors = require("cors");
require("dotenv").config();
const { Server } = require("socket.io");
const admin = require("firebase-admin");
const usersRouter = require("./routes/users");
import { db } from "./firebase";

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ✅ Socket.IO Logic
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // 🔹 Join Room
  socket.on("join_room", (roomId) => {
    socket.join(roomId);
    console.log(`User ${socket.id} joined room ${roomId}`);
  });

  // 🔹 Chat
  socket.on("send_message", (data) => {
    // data = { roomId, sender, message }
    io.to(data.roomId).emit("receive_message", data);
  });

  // 🔹 Confirm Trade
  socket.on("confirm_trade", async ({ tradeId, uid }) => {
    try {
      const tradeRef = db.collection("trades").doc(tradeId);
      const tradeSnap = await tradeRef.get();
      if (!tradeSnap.exists) {
        return socket.emit("trade_update", { error: "Trade not found" });
      }

      const trade = tradeSnap.data();
      const confirmedBy = new Set(trade.confirmedBy || []);
      confirmedBy.add(uid);

      const bothConfirmed =
        confirmedBy.has(trade.user1) && confirmedBy.has(trade.user2);

      if (bothConfirmed) {
        // Swap coupons between users
        const user1Ref = db.collection("users").doc(trade.user1);
        const user2Ref = db.collection("users").doc(trade.user2);

        const [u1Snap, u2Snap] = await Promise.all([
          user1Ref.get(),
          user2Ref.get(),
        ]);

        const u1Wallet = u1Snap.data().wallet || [];
        const u2Wallet = u2Snap.data().wallet || [];

        const newU1Wallet = u1Wallet.filter((id) => id !== trade.user1_coupon);
        newU1Wallet.push(trade.user2_coupon);

        const newU2Wallet = u2Wallet.filter((id) => id !== trade.user2_coupon);
        newU2Wallet.push(trade.user1_coupon);

        await Promise.all([
          user1Ref.update({ wallet: newU1Wallet }),
          user2Ref.update({ wallet: newU2Wallet }),
          tradeRef.update({
            status: "confirmed",
            confirmedAt: new Date(),
            confirmedBy: Array.from(confirmedBy),
          }),
        ]);

        io.to(trade.room_id).emit("trade_update", {
          tradeId,
          status: "confirmed",
          confirmedBy: Array.from(confirmedBy),
        });
      } else {
        // Partial confirm
        await tradeRef.update({
          confirmedBy: Array.from(confirmedBy),
        });

        io.to(trade.room_id).emit("trade_update", {
          tradeId,
          status: "waiting",
          confirmedBy: Array.from(confirmedBy),
        });
      }
    } catch (err) {
      console.error(err);
      socket.emit("trade_update", { error: "Trade confirmation failed" });
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

// 🔹 Routes
app.use("/api/users", usersRouter);
app.use("/api/coupons", require("./routes/coupons"));
app.use("/api/trades", require("./routes/trades"));

// 🔹 Start server
server.listen(process.env.PORT, () => {
  console.log(`Server listening on port ${process.env.PORT}`);
});
