const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');


const collection = require('./User');
// Aggiungi cookie-parser come middleware per gestire i cookie



const app = express();

app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({extended: false}));

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.get('/', (req, res) =>{
    res.render('login');
});

//Register user
app.post("/signup", async (req, res) =>{
    const data = {
        userName: req.body.username,
        password: req.body.password
    }
    //check if the user already exist
    const existingUser = await collection.findOne({userName: data.userName});
    if(existingUser){
        res.send('<h1>Esiste già un account con questo nome</h1>');
    }else{
        //encrypting password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(data.password, saltRounds);

        data.password = hashedPassword;

        const userData = await collection.insertMany(data);
        console.log('nuovo utente registrato: ', data.userName);
        res.redirect('/');
    }
});


// Middleware per controllare l'autenticazione
const isAuthenticated = (req, res, next) => {
    const usernameCookie = req.cookies.username;
    const usernameURL = req.params.username;

    if (usernameCookie && usernameCookie === usernameURL.replace(":", "")) {
        // User authenticated
        return next();
    } else {
        // User not authenticated
        res.redirect('/');
    }
};

app.post('/login', async (req, res) => {
    try {
        const check = await collection.findOne({ userName: req.body.username });
        if (!check) {
            res.send('This username does not exist');
        }

        // Check the password
        const sixMonths = 180 * 24 * 60 * 60 * 1000;
        const isPasswordMatch = await bcrypt.compare(req.body.password, check.password);
        if (isPasswordMatch) {
            // Imposta il cookie di autenticazione
            res.cookie('username', req.body.username, { maxAge: sixMonths, httpOnly: true });
            console.log('Nuovo utente loggato: ', req.body.username);
            res.redirect(`/profile/:${req.body.username}`);
        } else {
            res.send('Password errata');
        }
    } catch {
        res.send('Credenziali sbagliate');
    }
});

app.get('/profile/:username', isAuthenticated, async (req, res) => {
    const istruttori = ['mario', 'marco', 'giuseppe'];
    const orari = ['12:30', '13:30', '14:30'];

    const nome = req.params.username.replace(':', '');
    res.render('guideBooking', { nome, istruttori, orari });
    // res.send(`Benvenuto ${nome}`);
});

const port = 5000;
app.listen(port, () =>{
    console.log('Server running on Port: ' + port);
})