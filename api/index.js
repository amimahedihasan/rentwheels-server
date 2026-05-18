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

// Get single car by ID
app.get("/cars/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid car ID" });
    const car = await carsCollection.findOne({ _id: new ObjectId(id) });
    res.status(200).send(car);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to get car" });
  }
});

// Update a car
app.put("/cars/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ success: false, message: "Invalid ID" });

    const updatedCar = req.body;
    const result = await carsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedCar }
    );

    res.send({
      success: true,
      message: "Car updated successfully",
      updatedCar,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: "Update failed" });
  }
});

// Delete a car
app.delete("/cars/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ success: false, message: "Invalid ID" });

    // 1️⃣ Find car before deleting to get the owner email
    const car = await carsCollection.findOne({ _id: new ObjectId(id) });
    if (!car) {
      return res.status(404).send({ success: false, message: "Car not found" });
    }

    const result = await carsCollection.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 1) {
      // 2️⃣ Update user's totalCreatedCar
      if (car.providerEmail) {
        // providerEmail er field user email hisebe dhorechi
        const totalCars = await carsCollection.countDocuments({
          providerEmail: car.providerEmail,
        });

        await usersCollection.updateOne(
          { email: car.providerEmail },
          { $set: { totalCreatedCar: totalCars } }
        );
      }

      res
        .status(200)
        .send({ success: true, message: "Car deleted & user count updated" });
    } else {
      res.status(404).send({ success: false, message: "Car not found" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: "Failed to delete car" });
  }
});

//  BOOKING ROUTES

// Create booking
app.post("/booking", verifyToken, async (req, res) => {
  try {
    const data = req.body;
    delete data._id; // 🚫 Prevent frontend from overriding _id

    data.userEmail = req.user.email;
    data.createdAt = new Date();

    // Insert booking
    const result = await bookingCollection.insertOne(data);

    // Update car status to Unavailable
    if (data.carId) {
      await carsCollection.updateOne(
        { _id: new ObjectId(data.carId) },
        { $set: { status: "Unavailable" } }
      );
    }

    // Count total bookings for this user
    if (req.user && req.user.email) {
      const totalBookings = await bookingCollection.countDocuments({
        userEmail: req.user.email,
      });

      // Update user totalBookingCar
      await usersCollection.updateOne(
        { email: req.user.email },
        { $set: { totalBookingCar: totalBookings } }
      );
    }

    const createdBooking = await bookingCollection.findOne({
      _id: result.insertedId,
    });

    res.status(201).send({
      success: true,
      message: "Booking created & user totalBookingCar updated",
      booking: createdBooking,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: "Failed to add booking" });
  }
});

// Get bookings for logged-in user
app.get("/booking", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;
    const bookings = await bookingCollection
      .find({ userEmail: email })
      .toArray();
    res.send(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

// Update a booking
app.put("/booking/:id", verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id))
      return res.status(400).send({ message: "Invalid ID" });

    const updateData = req.body;
    const result = await bookingCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );
    res.status(200).send({ success: true, message: "Booking updated", result });
  } catch (err) {
    console.error(err);
    res.status(500).send({ success: false, message: "Update failed" });
  }
});

// Delete a booking
app.delete("/booking/:id", verifyToken, async (req, res) => {
  const id = req.params.id;

  try {
    if (!ObjectId.isValid(id)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid booking ID" });
    }

    const booking = await bookingCollection.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res
        .status(404)
        .send({ success: false, message: "Booking not found" });
    }

    // Only allow the booking owner to delete
    if (booking.userEmail !== req.user.email) {
      return res.status(403).send({ success: false, message: "Unauthorized" });
    }

    // Delete booking
    const deleteResult = await bookingCollection.deleteOne({
      _id: new ObjectId(id),
    });

    // Update car status to available
    if (booking.carId) {
      await carsCollection.updateOne(
        { _id: new ObjectId(booking.carId) },
        { $set: { status: "available" } }
      );
    }

    // ✅ Update user's totalBookingCar
    await usersCollection.updateOne(
      { email: booking.userEmail },
      { $inc: { totalBookingCar: -1 } } // 1 kombe
    );

    res.send({
      success: true,
      message: "Booking deleted, car status updated & user count updated",
      deleteResult ,
    });
  } catch (err)  {
    console.error(err);
    res
      .status(500)
      .send({ success: false, message: "Failed to delete booking" });
  }
});

module.exports = app;
