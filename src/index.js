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
const admin = require('./Db/Admin');
const guide = require('./Db/Guide');
const bacheca = require('./Db/Bacheca');
const formatoEmail = require('./Db/formatoEmail');

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

app.set('views', 'views');

app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: false}));

app.use(adminRoutes);

app.get('/', (req, res) =>{
    res.render('login');
});

async function generateOTP(length) {
    const digits = '0123456789';
    let OTP = '';
    for (let i = 0; i < length; i++) {
      OTP += digits[Math.floor(Math.random() * 10)];
    }
    return OTP;
}

//DA TOGLIERE IN PRODUZIONE
const tls = require('tls');
// Middleware per l'invio dell'email
const sendEmailMiddleware = async (otpCode, email, username, intent, res , nome, cognome, day, hour, locationlink) => {
    let subject, text;

    if (intent == 'login') {
        subject = 'Codice di accesso per il tuo account di scuola guida';
        text = 'È appena stato effettuato l\'accesso al tuo account, questo è il codice di verifica: ' + otpCode;
    } else if(intent == 'signup'){
        subject = 'Iscrizione effettuata a scuola guida';
        text = 'Il tuo account è stato creato con successo, questo è il codice di verifica per accedere: ' + otpCode;
    }else if(intent == 'bookGuide'){
        subject = 'Prenotazione effettuata per lezione di guida';
        const content = await formatoEmail.find({})
        text = content[0].content
            .replace('(NOME)', nome)
            .replace('(COGNOME)', cognome)
            .replace('(DATA)', day)
            .replace('(DAORA)', hour.split('-')[0]) 
            .replace('(AORA)', hour.split('-')[1]) 
            .replace('(LINKPOSIZIONE)', locationlink)
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
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: 'brezzagabriele0@gmail.com',
        to: email,
        subject: subject,
        text: text
    };

    transporter.sendMail(mailOptions, async function(error, info) {
        if (error) {
            console.error('Errore nell\'invio dell\'email:', error);
            res.sendStatus(500);
        } else {
            console.log('Email inviata con successo a:', username);
            if(intent == 'login' || intent == 'signup'){
                res.redirect(`/verificationCode/:${username}`);
            }else if(intent == 'bookGuide'){
                
            }
        }
    });
};

app.post('/verification', async (req, res) => {
    try {
        const otpCodePromise = generateOTP(6);
        const otpCode = await otpCodePromise;
        const userEmail = req.body.email;
        const userCell = req.body.phone;
        const userName = req.body.username;
        const password = req.body.password;
        const intent = req.body.intent;

        console.log(otpCode);
        let saltRounds, hashedOTP;
        if (intent == 'login') { 
            const check = await credentials.findOne({
                "userName": userName,
                "email": userEmail,
                "cell": userCell
            });
            if (check) {
                const isPasswordMatch = await bcrypt.compare(password, check.password);
                saltRounds = await bcrypt.genSalt(10);
                hashedOTP = await bcrypt.hash(String(otpCode), 10);
                if (isPasswordMatch) {
                    const implementingOtp = await credentials.findOneAndUpdate({
                            "cell": userCell,
                            "email": userEmail,
                            "userName": userName
                        }, {
                            "OTP": hashedOTP
                        }
                    );
                    sendEmailMiddleware(otpCode, userEmail, userName, intent, res, '', '', '', '', '', () => {
                        res.sendStatus(200);
                    }, req);
                } else {
                    res.send('<h1>Password errata</h1>');
                }
            } else {
                res.send('<h1>Credenziali errate</h1>');
            }
        } else if (intent == 'signup') {
            const { nome, cognome, codiceFiscale, via, nCivico, CAP, citta, provincia, stato} = req.body;
            saltRounds = await bcrypt.genSalt(10);
            hashedOTP = await bcrypt.hash(String(otpCode), 10);
            const data = {
                email: userEmail,
                cell: userCell,
                userName: userName,
                password: password,
                OTP: hashedOTP,
                approved: false,
                exams: [
                    {
                        paid: false, 
                        bocciato: false
                    }
                ],
                billingInfo: [
                    {
                        nome: nome,
                        cognome: cognome,
                        codiceFiscale: codiceFiscale,
                        via: via,
                        nCivico: nCivico,
                        CAP: CAP,
                        citta: citta,
                        provincia: provincia,
                        stato: stato
                    }
                ]
            }
            const existingUser = await credentials.findOne({userName: data.userName});
            const existingEmail = await credentials.findOne({email: data.email});
            const existingPhoneNumber = await credentials.findOne({cell: data.cell});
            if (existingUser) {
                res.send('<h1>Esiste già un account con questo username</h1>');
            } else if (existingEmail) {
                res.send('<h1>Esiste già un account con questa email</h1>');
            } else if (existingPhoneNumber) {
                res.send('<h1>Esiste già un account con questo numero di cellulare</h1>');
            } else {
                const hashedPassword = await bcrypt.hash(data.password, saltRounds);
                data.password = hashedPassword;

                const newUser = new credentials(data);
                await newUser.save();
                console.log('nuovo utente registrato in attesa di approvazione: ', data.userName);
                sendEmailMiddleware(otpCode, userEmail, userName, intent, res, () => {
                    res.sendStatus(200);
                }, req);
            }
        }
    } catch (error) {
        console.error('Si è verificato un errore:', error);
        res.status(500).send('<h1>Errore interno del server</h1>');
    }
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
const isAuthenticated = async (req, res, next) => {
    const usernameCookie = req.cookies.userName;
    const usernameURL = (req.params.userName).replace(":", "");
    const isApproved = await credentials.findOne({userName: usernameURL});
    if(isApproved){
        if (usernameCookie && usernameCookie === usernameURL && isApproved.approved) {
            // User authenticated
            return next();
        } else {
            // User not authenticated
            res.redirect('/');
        }
    }
};

app.get('/profile/:userName', isAuthenticated, async (req, res) => {
    const lezioni = await guide.find();
    const nome = req.params.userName.replace(':', '');
    const esami = await credentials.findOne({ "userName": nome }, { exams: 1 });
    const personalData = await credentials.findOne({ "userName": nome }, { billingInfo: 1});
    const bachecaContent = await bacheca.findOne();
    const exclude = await credentials.findOne({ "userName": nome }, { exclude: 1 });
    const excludeInstructor = exclude.exclude;
    res.render('guideBooking', { nome, lezioni, esami, bachecaContent, excludeInstructor, personalData});
});

app.post('/book', async (req, res) => {
    try {
        const { instructor, time, day, duration, student, price, location } = req.body;
        const durationInHour = duration/60;
        const giorno = time.split(' - ')[0];
        const hour = time.split(' - ')[1];
        const updatedGuide = await guide.findOneAndUpdate(
            { 
                "instructor": instructor, 
                "book.day": giorno, 
                "book.schedule.hour": hour,
                "book.schedule.locationLink": location
            },
            { 
                $set: { 
                    "book.$[bookElem].schedule.$[scheduleElem].student": student 
                } 
            },
            { 
                arrayFilters: [
                    { "bookElem.day": giorno },
                    { "scheduleElem.hour": hour }
                ] 
            }
        );
        const user = await credentials.findOne(
            {"userName": student}, 
            {
                "email": 1,
                "billingInfo": 1
            }
        );

        if(updatedGuide){
            sendEmailMiddleware('', user.email, student, 'bookGuide', res, user.billingInfo[0].nome, user.billingInfo[0].cognome, giorno, hour, location, () => {
                res.sendStatus(200);
            }, req);
        }
        const existingOrario = await admin.findOne({"userName": instructor, "ore.data": day});

        if (existingOrario) {
            const updatedOrari = await admin.findOneAndUpdate(
                {"userName": instructor, "ore.data": day},
                {$inc: {"ore.$.totOreGiorno": durationInHour}},
                {new: true}
            );
        } else {
            const updatedOrari = await admin.findOneAndUpdate(
                {"userName": instructor},
                {$addToSet: {"ore": {"data": day, "totOreGiorno": durationInHour}}},
                {new: true}
            );
        }
        const today = new Date();
        const d = String(today.getDate()).padStart(2, '0'); 
        const month = String(today.getMonth() + 1).padStart(2, '0'); 
        const year = today.getFullYear(); 
        const dataFatturazione = `${d}/${month}/${year}`;
        const updateDataFatturazione = await credentials.findOneAndUpdate(
            {"userName": student},
            {
                $addToSet: {
                    "fatturaDaFare": {"tipo": 'lezione di guida', "data": dataFatturazione, "importo": price, "emessa": false},
                    "lessonList": {"istruttore": instructor, "giorno": giorno, "ora": hour, "duration": durationInHour}
                }
            },
            {new: true}
        );
        res.sendStatus(200);
    } catch (error) {
        console.error('Errore durante la prenotazione:', error);
        res.status(500).send('Errore durante la prenotazione');
    }
});

app.post('/bookExam', async (req, res) => {
    try {
        const price = req.body.price;
        const userName = req.body.student;
        let numEsame = req.body.numEsame;
        numEsame = parseInt(numEsame);
        await credentials.findOneAndUpdate(
            { "userName": userName },
            { $set: { ["exams." + numEsame + ".paid"]: true } }
        );
         
        await credentials.findOneAndUpdate(
            { "userName": userName },
            { $push: { "exams": { "paid": false, "bocciato": false } } }
        );
        const today = new Date();
        const d = String(today.getDate()).padStart(2, '0'); 
        const month = String(today.getMonth() + 1).padStart(2, '0'); 
        const year = today.getFullYear(); 
        const dataFatturazione = `${d}/${month}/${year}`;
        const updateDataFatturazione = await credentials.findOneAndUpdate(
            {"userName": userName},
            {$addToSet: {"fatturaDaFare": {"tipo": 'Esame di guida', "data": dataFatturazione, "importo": price, "emessa": false}}},
            {new: true}
        );
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





app.post('/create-payment',  async (req, res) =>{
    try {
        const student = req.body.student;
        const cause = req.body.cause;
        
        let instructor, location;
        let price, description, returnUrl, day, hour, numEsame, name, sku;
        if(cause == 'lesson'){
        instructor = req.body.instructor;
        location = req.body.location;
        const timeParts = req.body.time.split(' - '); 
        day = timeParts[0];
        hour = timeParts[1];
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
        description: "Pagamento per la lezione di guida in AutoScuolaCentrale"; 
        name = "Lezione di Guida";
        sku = 1;
        //da cambiare in produzione
        returnUrl = `http://13.39.106.190:5000/success?cause=${encodeURIComponent(cause)}&instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(day + ' - ' + hour)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}&location=${encodeURIComponent(location)}`;
        }else if(cause == 'exam'){
            price = 100;
            numEsame = req.body.numEsame;
            description: "Pagamento per l'esame di guida in AutoScuolaCentrale"; 
            name = "Esame di Guida";
            sku = 2;
            //da cambiare in produzione
            returnUrl = `http://13.39.106.190:5000/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&numEsame=${encodeURIComponent(numEsame)}&price=${encodeURIComponent(price)}`;

        }
        const create_payment_json = {
            intent: "sale",
            payer: {
                payment_method: "paypal"
            },
            redirect_urls: {
                return_url: returnUrl,
                //da cambiare in produzione
                cancel_url: "http://13.39.106.190:5000/cancel",
            },
            transactions: [
                {
                    item_list: {
                        items: [
                            {
                                name: name,
                                sku: sku,
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

app.get('/success',  async (req, res) =>{
    try {
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
                    const location = req.query.location;
                    const instructor = req.query.instructor;
                    const time = req.query.time;
                    const [day, timePart] = time.split(' - ');
                    const [startTime, endTime] = timePart.split('-').map(t => t.trim());
                    
                    const [startHour, startMin] = startTime.split(':').map(Number);
                    const [endHour, endMin] = endTime.split(':').map(Number);
                    
                    let duration;
                    if (endHour > startHour || (endHour === startHour && endMin >= startMin)) {
                        duration = (endHour - startHour) * 60 + (endMin - startMin);
                    } else {
                        duration = (24 - startHour + endHour) * 60 + (endMin - startMin);
                    }

                    //da cambiare in produzione
                    fetch('http://13.39.106.190:5000/book', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ instructor, time, day, duration, student, price, location})
                    })
                    .then(response => {
                        if (response.ok) {
                            console.log('Prenotazione effettuata con successo dopo il pagamento', req.query);

                            res.redirect(`/profile/:${req.cookies.userName}`);
                        } else {
                            console.error('Errore durante la prenotazione dopo il pagamento');

                            res.redirect(`/profile/:${req.cookies.userName}`);
                        }
                    })
                    .catch(error => {
                        console.error('Errore durante la prenotazione dopo il pagamento:', error);

                        res.redirect(`/profile/:${req.cookies.userName}`);
                    });
                }else if(cause == 'exam'){
                    const numEsame = req.query.numEsame;
                    //da cambiare in produzione
                    const response = await fetch('http://13.39.106.190:5000/bookExam', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ student, numEsame, price})
                    });
                    if (response.ok) {
                        console.log('Prenotazione dell\'esame effettuata con successo dopo il pagamento', req.query);
                        
                        res.redirect(`/profile/:${req.cookies.userName}`);
                    } else {
                        console.error('Errore durante la prenotazione dell\'esame dopo il pagamento');
                        
                        res.redirect(`/profile/:${req.cookies.userName}`);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Errore generale:', error);

        res.redirect(`/profile/:${req.cookies.userName}`);
    }
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});







// app.post('/payPP', async (req, res) => {
//     res.json({ message: 'Form data received successfully'})
// });










const port = 5000;
app.listen(port, '0.0.0.0', () =>{
    console.log('Server running on Port: ' + port);
})