const express = require("express"),
      app = express(),
      bodyParser = require("body-parser"),
      mongoose = require("mongoose"),
      morgan = require("morgan"),
      CatchAsync = require("./views/assets/js/CatchAsync.js"),
      ExpressError = require("./views/assets/js/ExpressError.js"),
      session = require("express-session"),
      passport = require("passport"),
      LocalStratergy = require("passport-local"),
      flash = require("connect-flash"),
      isLoggedin = require("./views/assets/js/checkLogin.js"),
      {nanoid} = require("nanoid"),
      mongodbstore = require('connect-mongo')(session),
      port = process.env.PORT || 3000

if(process.env.NODE_ENV !== "production"){
    require('dotenv').config()
}

const adminRoute = require('./routes/admin.js'),
      homeRoute = require("./routes/home.js"),
      userRoute = require("./routes/user.js")

const Razorpay = require('razorpay')
const instance = new Razorpay({
    key_id: process.env.razorpay_key_id, //your razorypay key id goes here
    key_secret: process.env.razorpay_key_secret //your razorypay key secret goes here
})

const db_url = process.env.db_url || 'mongodb://localhost:27017/gameblob'
const secret = process.env.session_key || "gameblobisawesome"
mongoose.connect(db_url, {useNewUrlParser: true, useUnifiedTopology: true, useCreateIndex : true});

const mongoStore = new mongodbstore({
    url : db_url,
    secret,
    touchAfter : 24 * 60 * 60 //1 day
})

mongoStore.on('error', (err)=>{
    console.log("Store Session Error: ", err)
})

const sessionConfig = {
    store : mongoStore,
    secret, //your razorpay session secret goes here
    resave : false,
    saveUninitialized : true,
    cookie : {
        httpOnly : true,
        expire : Date.now() +  8.64e+7 * 7,
        maxAge : 8.64e+7 * 7
    }
}

app.use(session(sessionConfig))
app.use(bodyParser.urlencoded({extended:true}))
app.use(morgan('tiny'))
app.use(passport.initialize())
app.use(passport.session())
app.use(flash())

app.use((req, res, next)=>{
    req.session.loggedInUser = req.user
    res.locals.loggedInUser = req.user
    res.locals.success = req.flash("success")
    res.locals.error = req.flash("error")
    if(!req.session.return){
        req.session.return = "/home"
    }
    next()
})

const game = require("./models/games.js"),
      user = require("./models/users.js"),
      comment = require("./models/comments.js"),
      feedback = require("./models/feedback.js"),
      purchase = require("./models/purchased.js")
const isLoggedIn = require("./views/assets/js/checkLogin.js")

passport.use(new LocalStratergy(user.authenticate()))
passport.serializeUser(user.serializeUser())
passport.deserializeUser(user.deserializeUser())

app.use(express.static(__dirname + '/views'));
//app.use(express.static(__dirname + '/views/assets/css'));

app.use("/admin", adminRoute);
app.use("/home", homeRoute);
app.use("/", userRoute)

app.get("/", (req,res) => {
    res.render("index.ejs")
}) 

app.get("/game/:gameid", CatchAsync(async (req,res,next) => {
    //console.log(req.user)
    const games = await game.findOne({_id : req.params.gameid}) 
    const gid = await games.id
    const comments = await comment.find({game : gid}).populate('game', 'name').populate('user','username')
    //console.log(comments)
    const count = await comment.countDocuments({game : {_id : gid}})
    req.session.return = req.originalUrl
    //console.log(req.session.return)
    req.session.gameid = gid
    if(!games){
        return next(new ExpressError("Page not found", 404))
    }
    res.render("game.ejs", {games:games, comments: comments, count : count})
}))

app.post("/addFeedback", async(req,res) => {
    const suggest = req.body.feedback
    const sd = await feedback.create(suggest)
    console.log(sd)
    res.redirect("/")
})

app.post("/comments", isLoggedin, CatchAsync(async (req, res)=>{
    let comment_body = req.body.comment
    comment_body.user = req.user.id
    comment_body.game = req.session.gameid
    console.log(comment_body)
    await comment.create(comment_body)
    res.redirect(req.session.return)
}))

app.get("/user/:user",isLoggedIn, async (req,res)=>{
    req.session.return = req.originalUrl
    const uname = req.user.username
    const purchased = await purchase.find({userid :req.user.id}).populate('gameid')
    //console.log(purchased,req.user.id)
    const comments = await comment.find({user : req.user.id}).populate('game').populate('user','username').sort({$natural:-1}).limit(3)
    //console.log(comments)
    res.render("profile.ejs",{comments:comments, uname:uname, purchased : purchased})
})

app.post("/razorpay", async (req,res)=> {
    
    try{
        const gid = req.session.gameid
        const amount = 499,currency='INR',payment_capture=true; 
        const obj = {
            amount : (amount*100).toString(), 
            currency,
            payment_capture,
            receipt : nanoid(),
            key : process.env.razorpay_key_id
        }
        
        const order = await instance.orders.create(obj)
        //console.log(order)
        res.json({
            amount : order.amount,
            currency : order.currency,
            id : order.id,
            gid : gid
        })
        
    }catch(err){
        console.log(err)
    }
    
})

app.post("/razorpay/success", async (req,res)=>{
    const gid = req.session.gameid
    const obj = {
        gameid : gid,
        userid : req.user.id
    }
    await purchase.create(obj)
    await user.updateOne({username : req.user.username},{$push : {ownedGames : {gid}}})
    res.redirect(req.session.return)
})

app.get("*", (req,res) => {
    res.render("error.ejs", {statusCode: 404, message: "Page Not Found"})
})

app.use((err, req, res, next) => {
    let { statusCode=500 , message} = err
    console.log(err)
    if(err.name==="CastError") statusCode=404,message="Page Not Found"
    if(err.name==="TypeError") statusCode=500,message="Something Went Wrong Internally"
    return res.render("error.ejs", {statusCode: statusCode, message: message})
})

app.listen(port, () => {
    console.log(`GameBlob servers have started on http://localhost:${port} !!`)
})