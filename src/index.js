const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');

//DB schemas
const credentials = require('./Db/User');
const guide = require('./Db/Guide');
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
    const existingUser = await credentials.findOne({userName: data.userName});
    if(existingUser){
        res.send('<h1>Esiste già un account con questo nome</h1>');
    }else{
        //encrypting password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(data.password, saltRounds);

        data.password = hashedPassword;

        const userData = await credentials.insertMany(data);
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
        const check = await credentials.findOne({ userName: req.body.username });
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
    const lezioni = await guide.find();
    const nome = req.params.username.replace(':', '');
    res.render('guideBooking', { nome, lezioni});
});
app.post('/book', async (req, res) => {
    try {
        const { instructor, time, student } = req.body;

        // Aggiorna il documento della guida
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": time.split(' - ')[0], "book.schedule.hour": time.split(' - ')[1] },
            { $set: { "book.$.schedule.$[elem].student": student } },
            { arrayFilters: [{ "elem.hour": time.split(' - ')[1] }] }
        );

        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la prenotazione:', error);
        res.status(500).send('Errore durante la prenotazione');
    }
});

app.post('/removebooking', async (req, res) => {
    try {
        const { instructor, time } = req.body;

        // Aggiorna il documento della guida
        const updatedGuide = await guide.findOneAndUpdate(
            { "instructor": instructor, "book.day": time.split(' - ')[0], "book.schedule.hour": time.split(' - ')[1] },
            { $unset: { "book.$.schedule.$[elem].student": "" } },
            { arrayFilters: [{ "elem.hour": time.split(' - ')[1] }] }
        );

        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la rimozione della prenotazione:', error);
        res.status(500).send('Errore durante la rimozione della prenotazione');
    }
});

const port = 5000;
app.listen(port, () =>{
    console.log('Server running on Port: ' + port);
})