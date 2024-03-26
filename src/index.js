const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const paypal = require('paypal-rest-sdk');

//DB schemas
const credentials = require('./Db/User');
const guide = require('./Db/Guide');

//routes
const adminRoutes = require('./adminRoute/adminRoutes');
// Aggiungi cookie-parser come middleware per gestire i cookie

paypal.configure({
    mode: "sandbox",
    client_id: "AQ_o9Yz9c5nvarfJulXNOBctDZHOPZd4_KsotSdq7K4lcwlDi1gRBi_kJaNICV93KP5n2cmAdxBKngpi",
    client_secret: "ELznTnRYt4XSn1bNM00e56zPWFbZm_kROe-J5YOAKpO9mQCC-iz0RoblN6fktd6Ojjw5tFgY5XpLzlga"
});

const app = express();



app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({extended: false}));

app.set('view engine', 'ejs');

app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: false}));

app.use(adminRoutes);

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





app.post('/create-payment', (req, res) =>{
   
    const instructor = req.body.instructor;
    const time = req.body.time;
    const price = req.body.price;
    const student = req.body.student;

    console.log('sta per pagare ', req.body);
    const returnUrl = `http://localhost:5000/success?instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(time)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}`;

    const create_payment_json = {
        intent: "sale",
        payer: {
            payment_method: "paypal"
        },
        redirect_urls: {
            return_url: returnUrl,
            cancel_url: "http://localhost:5000/cancel",
        },
        transactions: [
            {
                item_list: {
                    items: [
                        {
                            name: "Lezione di Guida",
                            sku: "Item SKU",
                            price: price,
                            currency: "EUR",
                            quantity: 1
                        }
                    ]
                },
                amount: {
                    currency: "EUR",
                    total: price
                },
                description: "Pagamento per la lezione di guida in AutoScuolaCentrale"
            }
        ]
        
    };

    paypal.payment.create(create_payment_json, (error, payment)=>{
        if(error){
            throw error;
        } else{
            for(i = 0; i < payment.links.length; i++){
                if(payment.links[i].rel === "approval_url"){
                    res.redirect(payment.links[i].href);
                }
            }
        }
    });
});



app.get('/success', async (req, res) =>{
    const payerId = req.query.PayerID;
    const paymentId = req.query.paymentId;
    const price = req.query.price;
    const execute_payment_json = {
        payer_id: payerId,
        transactions: [
            {
                amount: {
                    currency: "EUR",
                    total: price
                }
            }
        ]
    };

    paypal.payment.execute(paymentId, execute_payment_json, async (error, payment) =>{
        if(error){
            console.error(error.response);
            throw error
        } else{
            const instructor = req.query.instructor;
            const time = req.query.time;
            const student = req.query.student;

            fetch('http://localhost:5000/book', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ instructor, time, student })
            })
            .then(response => {
                if (response.ok) {
                    console.log('Prenotazione effettuata con successo dopo il pagamento', req.query);
                    // Reindirizza l'utente alla pagina del profilo
                    res.redirect(`/profile/${req.cookies.username}`);
                } else {
                    console.error('Errore durante la prenotazione dopo il pagamento');
                    // Gestisci l'errore in modo appropriato
                    res.redirect(`/profile/${req.cookies.username}`);
                }
            })
            .catch(error => {
                console.error('Errore durante la prenotazione dopo il pagamento:', error);
                // Gestisci l'errore in modo appropriato
                res.redirect(`/profile/${req.cookies.username}`);
            });
        }
    });
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});







app.post('/payPP', async (req, res) => {
    res.json({ message: 'Form data received successfully'})
});










const port = 5000;
app.listen(port, () =>{
    console.log('Server running on Port: ' + port);
})