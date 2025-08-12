if(process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}


const express = require("express");
const app = express();
const mongoose = require("mongoose");
const Listing = require("./models/listing.js");
const path = require("path");
const methodOverride = require("method-override");
const ejsMate = require("ejs-mate");
const wrapAsync = require("./utils/wrapAsync.js");
const ExpressError = require("./utils/ExpressError.js");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const flash = require("connect-flash");
const passport = require("passport");
const LocalStrategy = require("passport-local");
const User = require("./models/user.js");
const { isLoggedIn, isOwner,isReviewAuthor} = require("./middleware.js");
const { saveRedirectUrl } = require("./middleware.js");
const multer = require("multer");
const { storage } = require("./cloudConfig.js");
const upload = multer({storage}); // Set the destination for uploaded files


const { listingSchema , reviewSchema } = require("./schema.js");
const Review = require("./models/review.js");

// const MONGO_URL = "mongodb://127.0.0.1:27017/wanderlust";
const dbUrl = process.env.ATLASDB_URL;
main().then(()=>{
    console.log("connected to DB");
}).catch((err)=>{
    console.log(err);
});

async function main() 
{
  await mongoose.connect(dbUrl); 
}

app.set("view engine","ejs");
app.set("views",path.join(__dirname,"views"));
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride("_method"));
app.engine("ejs",ejsMate);
app.use(express.static(path.join(__dirname,"/public")));

const store = MongoStore.create({
    mongoUrl: dbUrl,
    crypto: {
        secret: process.env.SECRET_KEY,
    },
    touchAfter: 24 * 3600, // 24 hours
});

store.on("error", () => {
    console.log("ERROR IN MONGO SESSION STORE",err);
});
const sessionOptions = {
    store,
    secret: process.env.SECRET_KEY,
    resave: false,
    saveUninitialized: true,
    cookie: {
        expires: Date.now() + 7 * 24 * 60 * 60 * 1000, 
        maxAge: 7 *  24 * 60 * 60 * 1000, 
        httpOnly: true,
    },
};


app.use(session(sessionOptions));
app.use(flash());

app.use(passport.initialize());
app.use(passport.session()); 

passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());
 

app.use((req, res, next) => {
    res.locals.success = req.flash("success");
    res.locals.error = req.flash("error");
    res.locals.currentUser = req.user;
    res.locals.isLoggedIn = req.isAuthenticated();
    next();
});



const validateListing = (req, res, next) => {
  const { error } = listingSchema.validate(req.body);
  if (error) {
    const errMsg = error.details.map(el => el.message).join(", ");
    throw new ExpressError(400, errMsg);
  }
  next();
};

//index route
app.get("/listings",wrapAsync(async (req,res)=>{
    const allListings = await Listing.find({});
    res.render("./listings/index.ejs",{ allListings });
    
}));

//New Route
app.get("/listings/new", isLoggedIn,(req, res) => {
  res.render("listings/new.ejs");
});

//show route
app.get("/listings/:id", wrapAsync(async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id)
  .populate({
    path: "reviews",
    populate:{ 
      path: "author",
    },
  })
  .populate("owner");
  if(!listing) {
    req.flash("error", "Listing not found!");
    return res.redirect("/listings");
  }
  console.log(listing);
  res.render("./listings/show.ejs", { listing });
}));

//Create Route
app.post(
  "/listings",
  isLoggedIn,
  upload.single("listing[image]"),
  validateListing,
  wrapAsync(async (req, res, next) => {
    console.log("Form Data:", req.body);
    let url = req.file.path; // Get the uploaded file path
    let filename = req.file.filename; // Get the uploaded file name
   // Create new listing from form data
    const newListing = new Listing(req.body.listing);
    newListing.owner = req.user._id;
    newListing.image = {url,filename}; // Save image data if file uploaded
    // Save image data if file uploaded
    await newListing.save();

    req.flash("success", "New listing created successfully!");
    res.redirect("/listings");
  })
);
 

//Edit Route
app.get("/listings/:id/edit", isLoggedIn,isOwner, wrapAsync(async (req, res) => {
  let { id } = req.params;
  const listing = await Listing.findById(id);
  let originalImageUrl = listing.image.url; // Get the original image URL
  originalImageUrl = originalImageUrl.replace("/upload","/upload/w_250"); // Ensure it's not undefined
  res.render("listings/edit.ejs", { listing,originalImageUrl });
}));

//Update Route
app.put("/listings/:id",isLoggedIn,isOwner,upload.single("listing[image]"), wrapAsync(async (req, res) => {
  let { id } = req.params;
  let listing = await Listing.findByIdAndUpdate(id, { ...req.body.listing });
  
  if(typeof req.file !== "undefined") {
    let url = req.file.path; // Get the uploaded file path
    let filename = req.file.filename;
    listing.image = {url,filename}; // Save image data if file uploaded
    await listing.save();
  }
  req.flash("success", "Listing Updated successfully!");
  res.redirect(`/listings/${id}`);
  
}));

//Delete Route
app.delete("/listings/:id", isLoggedIn,isOwner, wrapAsync(async (req, res) => {
  let { id } = req.params;
  let deletedListing = await Listing.findByIdAndDelete(id);
  console.log(deletedListing);
  req.flash("success", "listing deleted successfully!");
  res.redirect("/listings");
}));

const validateReview = (req, res, next) => {
  const { error } = reviewSchema.validate(req.body);
  if (error) {
    const errMsg = error.details.map(el => el.message).join(", ");
    throw new ExpressError(400, errMsg);
  }
  next();
};

// reviews post route 
app.post("/listings/:id/reviews", isLoggedIn, validateReview, wrapAsync(async (req, res) => {
    let listing = await Listing.findById(req.params.id);
    let newReview = new Review(req.body.review);
    newReview.author = req.user._id; // Set the author to the current user
    listing.reviews.push(newReview);
    await listing.save();
    await newReview.save();
    req.flash("success", "New Review created successfully!");
    res.redirect(`/listings/${listing._id}`);
}));   

// delete reviews route 
app.delete("/listings/:id/reviews/:reviewId",isLoggedIn,isReviewAuthor, wrapAsync(async (req, res) => {
  let { id, reviewId } = req.params;


  await Listing.findByIdAndUpdate(id, { $pull: { reviews: reviewId } });
  // Remove the review from the Review collection
  await Review.findByIdAndDelete(reviewId);
  req.flash("success", "Review deleted successfully!");
  res.redirect(`/listings/${id}`);
}));

// signup route
app.get("/signup", (req, res) => {
    res.render("users/signup.ejs");
});
app.post("/signup", wrapAsync(async (req, res) => {
  try {
    let { username, email, password } = req.body;
    const newUser = new User({ username, email });
    const registeredUser = await User.register(newUser, password);
    console.log(registeredUser);
    req.login(registeredUser, (err) => {
      if (err) {
        return next(err);
      }
      req.flash("success", "Welcome to Wanderlust!");
      res.redirect("/listings");
    }); 
  } catch (error) {
    req.flash("error", error.message);
    res.redirect("/signup");
  }
}));
  
// login route
app.get("/login", (req, res) => {
    res.render("users/login.ejs");
});

app.post("/login",
    saveRedirectUrl,
    passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
}), async (req, res) => { 
    req.flash("success", "Welcome back!");
    res.redirect(res.locals.redirectUrl || "/listings"); // Redirect to the original URL or listings page
    
});

app.get("/logout", (req, res , next) => {
    req.logout((err) => {
        if (err) {
            return next(err);
        }
        req.flash("success", "Logged out successfully!");
        res.redirect("/listings");
    });
});


app.all("*", (req, res, next) => {
  next(new ExpressError(404,"Page Not Found!"));
});

app.use((err, req, res, next) => {
    const { status = 500, message = "Something went wrong!" } = err;
    res.status(status).send(message);
});


app.listen(8080, () => {
    console.log("Server running on port 8080");
});

