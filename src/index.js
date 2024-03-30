const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const paypal = require('paypal-rest-sdk');
const nodemailer = require('nodemailer');
const crypto = require('crypto');

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

function generateOTP(length) {
    const digits = '0123456789';
    let OTP = '';
    for (let i = 0; i < length; i++) {
      OTP += digits[Math.floor(Math.random() * 10)];
    }
    return OTP;
  }

//DA TOGLIERE IN PRODUZIONE
const tls = require('tls');
app.post('/verification', async (req, res) =>{
    const otpCode = generateOTP(6);
    const userEmail = req.body.email;
    const userCell = req.body.phone;
    const userName = req.body.username;
    const password = req.body.password;
    const intent = req.body.intent;
    let subject, text;
    if(intent == 'login'){
        subject = 'Codice di accesso per il tuo account di scuola guida';
        text = 'È appena stato effettuato l\'accesso al tuo account, questo è il codice di verifica: '+ otpCode;
    }else{
        subject = 'Iscrizione effettuata a scuola guida';
        text = 'Il tuo account è stato creato con successo, questo è il codice di verifica per accedere: '+ otpCode;
    }
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
        //da cambiare in produzione
          user: 'brezzagabriele0@gmail.com',
          pass: 'cack nyhf wlmc iuox'
        },
        //DA TOGLIERE IN PRODUZIONE
        tls: {
          // Ignora la verifica del certificato SSL
          rejectUnauthorized: false
        }
      });
      
      const mailOptions = {
        from: 'brezzagabriele0@gmail.com',
        to: userEmail,
        subject: subject,
        text: text
      };
      
      transporter.sendMail(mailOptions, async function(error, info) {
        if (error) {
          console.error('Errore nell\'invio dell\'email:', error);
          res.send(500);
        } else {
            console.log('Email inviata con successo a:', userName);
            let saltRounds, hashedOTP;
            if(intent == 'login'){
                const check = await credentials.findOne({ 
                    "userName": userName,
                    "email": userEmail,
                    "cell": userCell
            });
                if(check){
                    const isPasswordMatch = await bcrypt.compare(password, check.password);
                    saltRounds = await bcrypt.genSalt(10);
                    hashedOTP = await bcrypt.hash(otpCode, saltRounds);
                    if(isPasswordMatch){
                        const implementingOtp = await credentials.findOneAndUpdate(
                            {
                            "cell": userCell,
                            "email" : userEmail,
                            "userName": userName
                        }, 
                        {
                            "OTP": hashedOTP
                        }
                        );
                        res.redirect(`/verificationCode/:${userName}`);
                    }else{
                        res.send('<h1>Password errata</h1>');
                    }
                }else{
                    res.send('<h1>Credenziali errate</h1>');
                }
            }else if(intent == 'signup'){
                saltRounds = await bcrypt.genSalt(10);
                hashedOTP = await bcrypt.hash(otpCode, saltRounds);
                const data = {
                    email: userEmail,
                    cell: userCell,
                    userName: userName,
                    password: password,
                    exams: [{ paid: false }],
                    OTP: hashedOTP
                }
                console.log(data.cell);
                const existingUser = await credentials.findOne({userName: data.userName});
                const existingEmail = await credentials.findOne({email: data.email});
                const existingPhoneNumber = await credentials.findOne({cell: data.cell});
                if(existingUser){
                    res.send('<h1>Esiste già un account con questo username</h1>');
                }else if(existingEmail){
                    res.send('<h1>Esiste già un account con questa email</h1>');
                }else if(existingPhoneNumber){
                    res.send('<h1>Esiste già un account con questo numero di cellulare</h1>');
                }else{
                    //encrypting password
                    const hashedPassword = await bcrypt.hash(data.password, saltRounds);

                    data.password = hashedPassword;

                    const newUser = new credentials(data);
                    await newUser.save();
                    console.log('nuovo utente registrato: ', data.userName);
                    res.redirect(`/verificationCode/:${userName}`);
                }
            }
        }   
      });
      
});

app.get('/verificationCode/:userName', async (req, res) => {
    res.render('codiceDiVerifica', {userName: req.params.userName.replace(':', '')});
});
app.post('/verifica_otp', async (req, res) =>{
    const userName = req.body.userName;
    const insertedOTP = Object.values(req.body).slice(-6);
    let otpString = '';
    for (const key in insertedOTP) {
        otpString += insertedOTP[key];
    }
    const check = await credentials.findOne({ "userName": userName });
    const isOTPMatched = await bcrypt.compare(otpString, check.OTP);
    if(isOTPMatched){
        const sixMonths = 180 * 24 * 60 * 60 * 1000;
        res.cookie('userName', userName, { maxAge: sixMonths,httpOnly: true });//da controllare se mettere httpsOnly
        res.redirect(`/profile/:${req.body.userName}`);
    }else{
        res.json('Il codice OTP inserito è errato');
    }
});

// Middleware per controllare l'autenticazione
const isAuthenticated = (req, res, next) => {
    const usernameCookie = req.cookies.userName;
    const usernameURL = req.params.userName;

    if (usernameCookie && usernameCookie === usernameURL.replace(":", "")) {
        // User authenticated
        return next();
    } else {
        // User not authenticated
        res.redirect('/');
    }
};

app.get('/profile/:userName', isAuthenticated, async (req, res) => {
    const lezioni = await guide.find();
    const nome = req.params.userName.replace(':', '');
    const esami = await credentials.findOne({ userName: nome }, { exams: 1 });
    const bachecaContent = await bacheca.findOne();
    const exclude = await credentials.findOne({ userName: nome }, { exclude: 1 });
    const excludeInstructor = exclude.exclude;
    res.render('guideBooking', { nome, lezioni, esami, bachecaContent, excludeInstructor});
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