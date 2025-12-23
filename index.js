require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
// const { default: Stripe } = require("stripe");
const port = process.env.PORT || 3000;
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);

try {
  const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
    "utf-8"
  );
  const serviceAccount = JSON.parse(decoded);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} catch (error) {
  console.error(
    "FIREBASE INITIALIZATION ERROR: Check FB_SERVICE_KEY environment variable."
  );
}

const app = express();

const allowedOrigins = [
  // "http://localhost:5173",
  "https://assignment011-dkra.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("Blocked by CORS:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());

const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];

  if (!token)
    return res
      .status(401)
      .send({ message: "Unauthorized Access! Token missing." });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    return res
      .status(401)
      .send({ message: "Unauthorized Access! Invalid token.", err });
  }
};

app.get("/", (req, res) => {
  res.send("Hello Ritu World!");
});

// --- MongoDB Setup ---
const uri = process.env.MONGODB_URL;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let universityCollection,
  userCollection,
  applicationCollection,
  reviewCollection;

async function run() {
  try {
    // Connect the client once
    await client.connect();
    const db = client.db("university-db");

    // Initialize collection variables
    universityCollection = db.collection("universities");
    userCollection = db.collection("users");
    applicationCollection = db.collection("applications");
    reviewCollection = db.collection("reviews");

    console.log("Connected to MongoDB!");
  } catch (err) {
    console.error("MongoDB Connection Error:", err);
  }
}
run().catch(console.dir);

app.post("/user", verifyJWT, async (req, res) => {
  const userData = req.body;

  const userEmail = req.tokenEmail;

  const filter = { email: userEmail };

  const updateDoc = {
    $set: {
      name: userData.name,
      photoURL: userData.image,
      lastLogin: new Date(),
    },
    $setOnInsert: {
      email: userEmail,
      role: "Student",
      createdAt: new Date(),
    },
  };

  try {
    const result = await userCollection.updateOne(filter, updateDoc, {
      upsert: true,
    });

    res.send({
      success: true,
      message:
        result.upsertedCount > 0
          ? "New user registered"
          : "User data updated/logged in",
      result,
    });
  } catch (error) {
    console.error("User POST/UPSERT failed:", error);
    res.status(500).send({ message: "Failed to process user data." });
  }
});

app.get("/users", verifyJWT, async (req, res) => {
  const role = req.query.role;
  let query = {};
  if (role && role !== "All") {
    query = { role: role };
  }
  const result = await userCollection.find(query).toArray();
  res.send(result);
});

app.patch("/users/role/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const { role } = req.body;
  const filter = { _id: new ObjectId(id) };
  const updateDoc = {
    $set: { role: role },
  };
  const result = await userCollection.updateOne(filter, updateDoc);
  res.send(result);
});

app.delete("/users/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await userCollection.deleteOne(query);
  res.send(result);
});

app.get("/admin-stats", verifyJWT, async (req, res) => {
  try {
    const users = await userCollection.estimatedDocumentCount();
    const scholarships = await scholarshipCollection.estimatedDocumentCount();
    const payments = await paymentCollection.find().toArray();
    const totalFees = payments.reduce(
      (sum, payment) => sum + (payment.price || 0),
      0
    );
    const chartData = await scholarshipCollection
      .aggregate([
        {
          $group: {
            _id: "$scholarshipCategory", // আপনার ডাটাবেসে ফিল্ডের নাম চেক করুন
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();

    res.send({ users, scholarships, totalFees, chartData });
  } catch (error) {
    console.error("Analytics Error:", error);
    res
      .status(500)
      .send({ message: "Internal Server Error", error: error.message });
  }
});

app.get("/scholarship", async (req, res) => {
  try {
    const result = await universityCollection.find().toArray();
    console.log("Documents found in DB:", result.length);
    res.send(result);
  } catch (error) {
    console.error("Error fetching scholarship:", error);
    res.status(500).send({ message: "Internal Server Error" });
  }
});

app.get("/scholarship/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await universityCollection.findOne({
      _id: new ObjectId(id),
    });
    if (!result)
      return res.status(404).send({ message: "Data item not found." });
    res.send(result);
  } catch (e) {
    res.status(400).send({ message: "Invalid ID format." });
  }
});

app.delete("/scholarship/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await universityCollection.deleteOne(query);
  res.send(result);
});
app.post("/create-scholarship", async (req, res) => {
  const versityData = req.body;
  console.log(versityData);
  const result = await universityCollection.insertOne(versityData);
  res.send(result);
});

app.post("/create-checkout-session", async (req, res) => {
  try {
    const scholarshipInfo = req.body;

    // Ensure essential data is present
    if (!scholarshipInfo?.price || !scholarshipInfo?.versityId) {
      return res
        .status(400)
        .json({ error: "Missing required details (price or versityId)." });
    }
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: scholarshipInfo.name,
              description: scholarshipInfo.description,
              images: [scholarshipInfo.image],
            },
            unit_amount: scholarshipInfo.price * 100,
          },
          quantity: scholarshipInfo.quantity || 1,
        },
      ],
      customer_email: scholarshipInfo?.student?.email,
      mode: "payment",
      metadata: {
        versityId: scholarshipInfo.versityId,
        studentEmail: scholarshipInfo?.student.email,
      },
      success_url: `https://assignment011-dkra.vercel.app/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://assignment011-dkra.vercel.app/scholarshipdetails/${scholarshipInfo.versityId}`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe Session Creation Error:", error);
    res
      .status(500)
      .json({ error: "Failed to create Stripe checkout session." });
  }
});

app.post("/payment-success", async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).send({ message: "Missing Stripe Session ID." });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const versityId = session.metadata.versityId;
    const studentEmail = session.metadata.studentEmail;
    const scholarship = await universityCollection.findOne({
      _id: new ObjectId(versityId),
    });
    const application = await applicationCollection.findOne({
      transactionId: session.payment_intent,
    });
    if (session.status === "complete" && scholarship && !application) {
      const applicationInfo = {
        versityId: versityId,
        transactionId: session.payment_intent,
        studentEmail: studentEmail,
        status: "paid",
        universityName: scholarship.universityName,
        scholarshipName: scholarship.scholarshipName,
        universityImage: scholarship.universityImage,
        universityCity: scholarship.universityCity,
        universityCountry: scholarship.universityCountry,

        category: scholarship.subjectCategory,
        amountPaid: session.amount_total / 100,
        paymentDate: new Date(),
      };
      const result = await applicationCollection.insertOne(applicationInfo);
      await universityCollection.updateOne(
        { _id: new ObjectId(versityId) },
        { $inc: { availableSlots: -1 } }
      );

      return res.json({
        message: "Payment and application recorded successfully.",
        transactionId: session.payment_intent,
        applicationId: result.insertedId,
        scholarshipName: scholarship.scholarshipName,
        universityName: scholarship.universityName,
        amountPaid: applicationInfo.amountPaid,
      });
    } else if (application) {
      return res.json({
        message: "Application already recorded.",
        transactionId: session.payment_intent,
        applicationId: application._id,
        scholarshipName: scholarship?.scholarshipName || "N/A",
        universityName: scholarship?.universityName || "N/A",
        amountPaid: application.amountPaid || session.amount_total / 100,
      });
    } else {
      return res.status(400).json({
        message: "Payment session not complete or scholarship data is missing.",
        status: session.status,
      });
    }
  } catch (error) {
    console.error("Payment Success Error:", error);
    return res.status(500).json({
      message: "Internal server error during payment fulfillment.",
    });
  }
});

app.get("/my-applications/:email", verifyJWT, async (req, res) => {
  const email = req.params.email;
  const query = { studentEmail: email };

  try {
    const result = await applicationCollection.find(query).toArray();
    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Error fetching applications", error });
  }
});

app.get("/all-applications", verifyJWT, async (req, res) => {
  const result = await applicationCollection.find().toArray();
  res.send(result);
});

app.patch("/applications/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const { status, feedback } = req.body;
  const filter = { _id: new ObjectId(id) };

  const updateDoc = {
    $set: {},
  };
  if (status) updateDoc.$set.status = status;
  if (feedback) updateDoc.$set.feedback = feedback;

  const result = await applicationCollection.updateOne(filter, updateDoc);
  res.send(result);
});

app.get("/user/role/:email", async (req, res) => {
  const email = req.params.email;
  const result = await userCollection.findOne({ email });
  res.send({ role: result?.role });
});

app.post("/reviews", verifyJWT, async (req, res) => {
  const review = req.body;
  if (review.scholarshipId)
    review.scholarshipId = new ObjectId(review.scholarshipId);
  const result = await reviewCollection.insertOne(review);
  res.send(result);
});

app.get("/my-reviews/:email", verifyJWT, async (req, res) => {
  const query = { userEmail: req.params.email };
  const result = await reviewCollection.find(query).toArray();
  res.send(result);
});

app.get("/all-reviews", verifyJWT, async (req, res) => {
  const result = await reviewCollection.find().toArray();
  res.send(result);
});

app.patch("/reviews/:id", verifyJWT, async (req, res) => {
  const { reviewComment, ratingPoint } = req.body;
  const result = await reviewCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    {
      $set: {
        reviewComment,
        ratingPoint: parseInt(ratingPoint),
        reviewDate: new Date().toISOString(),
      },
    }
  );
  res.send(result);
});

app.delete("/reviews/:id", verifyJWT, async (req, res) => {
  const result = await reviewCollection.deleteOne({
    _id: new ObjectId(req.params.id),
  });
  res.send(result);
});

module.exports = app;

app.listen(port, () => {
  console.log(`Express app listening on port ${port}`);
});
