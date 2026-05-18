const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();

//  Firebase setup from base64 service key
const decoded = Buffer.from(
  process.env.FIREBASE_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//  Middleware
app.use(express.json());
app.use(cors());

//  Firebase Token Verify Middleware
const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader)
      return res
        .status(401)
        .json({ success: false, message: "Authorization header missing" });

    const token = authHeader.split(" ")[1];
    if (!token)
      return res.status(401).json({ success: false, message: "Token missing" });

    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res
      .status(401)
      .json({ success: false, message: "Invalid or expired token" });
  }
};
