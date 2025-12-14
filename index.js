require("dotenv").config();
const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const admin = require("firebase-admin");
const { default: Stripe } = require("stripe");
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
  // If running without Firebase, comment out the try/catch block above and the JWT middleware below
}
// ------------------------------------

const app = express();

app.use(cors());
app.use(express.json());
// ---------------------------------------------

// --- 3. JWT Middleware ---
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];

  if (!token)
    return res
      .status(401)
      .send({ message: "Unauthorized Access! Token missing." });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    // console.log("Decoded JWT:", decoded); // Log decoded payload
    next();
  } catch (err) {
    // console.log("JWT Verification Error:", err);
    return res
      .status(401)
      .send({ message: "Unauthorized Access! Invalid token.", err });
  }
};
// ----------------------------

app.get("/", (req, res) => {
  res.send("Hello Ritu World!");
});

// --- 4. MongoDB Setup ---
const client = new MongoClient(
  `mongodb+srv://Ritu27:0P4Zey56E8itZ0zV@cluster0.5ylkwje.mongodb.net/?appName=Cluster0`,
  {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  }
);

async function run() {
  try {
    await client.connect();

    const db = client.db("university-db");
    const universityCollection = db.collection("universities");
    const userCollection = db.collection("users");
    app.post("/user", verifyJWT, async (req, res) => {
      const userData = req.body;
      const userEmail = req.tokenEmail;

      const filter = { email: userEmail };

      const updateDoc = {
        $set: {
          name: userData.name,
          photoURL: userData.photoURL,
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

    app.get("/scholarship", async (req, res) => {
      const result = await universityCollection.find().toArray();
      res.send(result);
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

    app.post("/create-scholarship", async (req, res) => {
      const versityData = req.body;
      console.log(versityData);
      const result = await universityCollection.insertOne(versityData);
      res.send(result);
    });

    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: "payment",
        metadata: {
          plantId: paymentInfo?.plantId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/plant/${paymentInfo?.plantId}`,
      });
      res.send({ url: session.url });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.error("Failed to connect to MongoDB or set up routes:", err);
    process.exit(1);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Express app listening on port ${port}`);
});
