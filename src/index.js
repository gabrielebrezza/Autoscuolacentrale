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
const bacheca = require('./Db/Bacheca');

//routes
const adminRoutes = require('./adminRoute/adminRoutes');
// Aggiungi cookie-parser come middleware per gestire i cookie

paypal.configure({
    //da cambiare in produzione
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
        password: req.body.password,
        exams: [{ paid: false }]
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

        const newUser = new credentials(data);
        await newUser.save();
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
    const esami = await credentials.findOne({ userName: nome }, { exams: 1 });
    const bachecaContent = await bacheca.findOne();
    res.render('guideBooking', { nome, lezioni, esami, bachecaContent});
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

app.post('/bookExam', async (req, res) => {
    try {
        const userName = req.body.student;
        let numEsame = req.body.numEsame;
        numEsame = parseInt(numEsame);
        console.log(numEsame);
        await credentials.findOneAndUpdate(
            { "userName": userName },
            { $set: { ["exams." + numEsame + ".paid"]: true } }
        );
         
        await credentials.findOneAndUpdate(
            { "userName": userName },
            { $push: { "exams": { "paid": false } } }
        );

        console.log('Esame ', numEsame+1, ' prenotato con successo');
        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        res.status(500).send('Errore durante la prenotazione dell\'Esame ');
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





app.post('/create-payment', async (req, res) =>{
    try {
        const student = req.body.student;
        const cause = req.body.cause;
        console.log(cause);
        let price, description, returnUrl;
        if(cause == 'lesson'){
        const instructor = req.body.instructor;
        const timeParts = req.body.time.split(' - '); 
        const day = timeParts[0];
        const hour = timeParts[1];
        const guides = await guide.findOne({ instructor: instructor });
        if (!guides) {
            return res.status(404).json({ error: "Instructor not found" });
        }

        const schedule = guides.book.find(item => item.day === day);
        if (!schedule) {
            return res.status(404).json({ error: "Schedule not found" });
        }
        const lesson = schedule.schedule.find(item => item.hour === hour);
        if (!lesson) {
            return res.status(404).json({ error: "Lesson not found" });
        }
        price = lesson.price;
        description = "Pagamento per la lezione di guida in AutoScuolaCentrale";
        console.log('sta per pagare ', req.body);
        //da cambiare in produzione
        returnUrl = `http://localhost:5000/success?cause=${encodeURIComponent(cause)}&instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(day + ' - ' + hour)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}`;
        }else if(cause == 'exam'){
            price = 5;
            const numEsame = req.body.numEsame;
            description = "Pagamento per l'esame di guida in AutoScuolaCentrale";
            //da cambiare in produzione
            returnUrl = `http://localhost:5000/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&numEsame=${encodeURIComponent(numEsame)}&price=${encodeURIComponent(price)}`;

        }
        const create_payment_json = {
            intent: "sale",
            payer: {
                payment_method: "paypal"
            },
            redirect_urls: {
                return_url: returnUrl,
                //da cambiare in produzione
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
                    description: description 
                }
            ]
        };

        paypal.payment.create(create_payment_json, (error, payment) => {
            if (error) {
                throw error;
            } else {
                for (let i = 0; i < payment.links.length; i++) {
                    if (payment.links[i].rel === "approval_url") {
                        res.redirect(payment.links[i].href);
                    }
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
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
            const cause = req.query.cause;
            const student = req.query.student;
            if(cause == 'lesson'){
                const instructor = req.query.instructor;
                const time = req.query.time;
                //da cambiare in produzione
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
            }else if(cause == 'exam'){
                const numEsame = req.query.numEsame;
                //da cambiare in produzione
                fetch('http://localhost:5000/bookExam', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ student, numEsame })
                })
                .then(response => {
                    if (response.ok) {
                        console.log('Prenotazione dell\'esame effettuata con successo dopo il pagamento', req.query);
                        // Reindirizza l'utente alla pagina del profilo
                        res.redirect(`/profile/${req.cookies.username}`);
                    } else {
                        console.error('Errore durante la prenotazione dell\'esame dopo il pagamento');
                        // Gestisci l'errore in modo appropriato
                        res.redirect(`/profile/${req.cookies.username}`);
                    }
                })
                .catch(error => {
                    console.error('Errore durante la prenotazione dell\'esame dopo il pagamento:', error);
                    // Gestisci l'errore in modo appropriato
                    res.redirect(`/profile/${req.cookies.username}`);
                });
            }


            
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