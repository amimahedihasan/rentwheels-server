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

//  MongoDB Setup
const uri = `mongodb+srv://${process.env.DB_ADMIN}:${process.env.DB_PASSWORD}@cluster0.egeojdc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const DB = client.db("rentWheelsDB");
const carsCollection = DB.collection("cars");
const bookingCollection = DB.collection("booking");
const usersCollection = DB.collection("users");

//  Connect DB
async function connectDB() {
  try {
    await client.connect();
    console.log(" MongoDB Connected");
  } catch (err) {
    console.error(" MongoDB connection failed:", err);
  }
}
connectDB();

//  Routes
app.get("/", (req, res) => {
  res.send(" Rent Wheels API is running successfully!");
});

// users route
app.post("/users", async (req, res) => {
  const user = req.body;

  const exists = await usersCollection.findOne({
    email: user.email,
  });

  if (exists) {
    return res.send({ message: "User already exists" });
  }

  const result = await usersCollection.insertOne(user);
  res.send(result);
});

app.get("/users", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email)
      return res
        .status(400)
        .send({ success: false, message: "Email required" });

    const user = await usersCollection.findOne({ email: email });
    if (!user)
      return res
        .status(404)
        .send({ success: false, message: "User not found" });

    res.send({ success: true, user });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: "Failed to fetch user" });
  }
});

//  CARS ROUTES
