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

// Get all cars  by provider
app.get("/cars", async (req, res) => {
  try {
    const query = {};
    const providerEmail = req.query.ProviderEmail;
    if (providerEmail) query.providerEmail = providerEmail;

    const cars = await carsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();
    res.send(cars);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to get cars" });
  }
});

app.get("/search", async (req, res) => {
  try {
    const text = req.query.search;
    if (!text) return res.send([]);

    const result = await carsCollection
      .find({ carName: { $regex: text, $options: "i" } })
      .toArray();

    res.send(result);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Search failed" });
  }
});

// Get latest 6 cars
app.get("/latest-cars", async (req, res) => {
  try {
    const cars = await carsCollection
      .find()
      .limit(6)
      .sort({ createdAt: -1 })
      .toArray();
    res.send(cars);
  } catch (err) {
    console.error(err);
    res.status(500).send({ error: "Failed to fetch cars" });
  }
});

// Add a car
app.post("/cars", verifyToken, async (req, res) => {
  try {
    const data = req.body;
    data.createdAt = new Date();

    // Insert car
    const result = await carsCollection.insertOne(data);

    // Count total cars created by this user
    if (req.user && req.user.email) {
      const totalCars = await carsCollection.countDocuments({
        providerEmail: req.user.email, // jei email diye car create korche
      });

      // Update user document
      await usersCollection.updateOne(
        { email: req.user.email },
        { $set: { totalCreatedCar: totalCars } }
      );
    }

    res.status(201).send({
      success: true,
      message: "Car added & user totalCreatedCar synced",
      car: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to add car" });
  }
});
