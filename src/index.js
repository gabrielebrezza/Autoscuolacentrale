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


paypal.configure({
    mode: "sandbox",
    client_id: "AUHPcNe43ZXbRREEakysa85Tjz6Bg4QSo67hqSJw4tnJj-24-AmmrUhEFHtUN3mvxncSkMcKf2yrF26o",
    client_secret: "EM9NHpEeQFMr31D7hLiDaMUhqPwEEu7edHacb-LkQThaTotira1IhHWMEjyaSEqfeRYYRbuHiam8gsIo"
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

const JWT_SECRET = 'q3o8M$cS#zL9*Fh@J2$rP5%vN&wG6^x';
// Funzione per la generazione di token JWT
function generateUserToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '36w' });
}

app.get('/', async (req, res) =>{
    const user = req.cookies.userName;
    const token = req.cookies.userName;
    if (token) {
        return res.redirect('/profile');
    }
        res.render('login');
});
app.get('/userLogout', (req, res) => {
    res.cookie('userName', '', {maxAge: 1});
    res.redirect('/');
}); 
async function generateOTP(length) {
    const digits = '0123456789';
    let OTP = '';
    for (let i = 0; i < length; i++) {
      OTP += digits[Math.floor(Math.random() * 10)];
    }
    return OTP;
}

app.get('/privacy-policy.pdf', (req, res) => {
  res.sendFile(path.join(__dirname, 'privacy-policy.pdf'));
});
app.get('/condizioni-uso.pdf', (req, res) => {
    res.sendFile(path.join(__dirname, 'condizioni-uso.pdf'));
});

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
        text = `Abbiamo inviato i tuoi dati all\'autoscuola. A breve riceverai un\'email di conferma che ti autorizzerà ad accedere all\'agenda. Intanto per confermare la tua identità inserisci il codice richiesto sul sito ${otpCode}. Cordiali saluti.`;
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
            user: 'autoscuolacentraletorino@gmail.com',
            pass: 'Tittike73_'
        },
        //DA TOGLIERE IN PRODUZIONE
        tls: {
            rejectUnauthorized: false
        }
    });

    const mailOptions = {
        from: 'autoscuolacentraletorino@gmail.com',
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
        const userEmail = req.body.email.replace(/\s/g, "");
        const userCell = req.body.phone.replace(/\s/g, "");
        const userName = (req.body.username).replace(/\s/g, "");
        const password = req.body.password;
        const intent = req.body.intent;

        console.log(`Codice OTP per ${userName}: ${otpCode}`);
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
                
                const transporter = nodemailer.createTransport({
                    service: 'gmail',
                    auth: {
                        //da cambiare in produzione
                        user: 'autoscuolacentraletorino@gmail.com',
                        pass: 'Tittike73_'
                    },
                    //DA TOGLIERE IN PRODUZIONE
                    tls: {
                        rejectUnauthorized: false
                    }
                });
            
                const mailOptions = {
                    from: 'autoscuolacentraletorino@gmail.com',
                    to: 'autoscuolacentraletorino@gmail.com',
                    subject: 'Nuovo Allievo',
                    text: 'Un nuovo allievo è in attesa di essere approvato.'
                };
            
                transporter.sendMail(mailOptions, async function(error, info) {
                    if (error) {
                        console.error('Errore nell\'invio dell\'email all\'autoscuola:', error);
                        res.sendStatus(500);
                    } else {
                        console.log('Email di richiesta approvazione inviata con successo all\'autoscuola');
                    }
                });
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


app.get('/resetPassword', async (req, res) =>{
    res.render('resetPassword');
});
app.post('/resetPassword', async (req, res) => {
    const { email } = req.body;
  
    try {
        const resetPasswordCode = Math.floor(100000 + Math.random() * 900000).toString();
        const foundCredentials = await credentials.findOneAndUpdate({ "email": email },{"resetPasswordCode": resetPasswordCode});
  
        if (!foundCredentials) {
            return res.status(404).send('Email non trovata');
        }
        const subject = 'Codice di reset password scuolaguida';
        const text = `Gentile ${foundCredentials.billingInfo[0].nome} ${foundCredentials.billingInfo[0].cognome}, ci è arrivata una richiesta per cambiare password. Ti inviamo il codice di verifica per il tuo account ${resetPasswordCode}, clicca sul link per cambiarla agenda-autoscuolacentrale.com/newPassword`;
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                //da cambiare in produzione
                user: 'autoscuolacentraletorino@gmail.com',
                pass: 'Tittike73_'
            },
            //DA TOGLIERE IN PRODUZIONE
            tls: {
                rejectUnauthorized: false
            }
        });

        const mailOptions = {
            from: 'autoscuolacentraletorino@gmail.com',
            to: email,
            subject: subject,
            text: text
        };

        transporter.sendMail(mailOptions, async function(error, info) {
            if (error) {
                console.error('Errore nell\'invio dell\'email:', error);
                res.sendStatus(500);
            } else {
                console.log('Email per il reset della password inviata con successo a:', email);
                    res.redirect('/');
            }
        });
    } catch (error) {
      console.error(error);
      return res.status(500).send('Si è verificato un errore durante il reset della password.');
    }
  });
app.get('/newPassword', async (req, res)=> {
    res.render('newPassword');
});
app.post('/newPasswordVerification', async (req, res)=> {
    const {email, code, newPassword, confirmNewPassword} = req.body;

    const foundCredentials = await credentials.findOne({ "email": email, "resetPasswordCode": code });
    if (foundCredentials) {
        if(newPassword == confirmNewPassword){
            const saltRounds = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
            const updatePsw = await credentials.findOneAndUpdate({ "email": email, "resetPasswordCode": code }, {"password": hashedPassword});
            const deleteCode = await credentials.updateOne(
                { "email": email, "resetPasswordCode": code },
                { $unset: { "resetPasswordCode": 1 } }
              );
        }
        res.redirect('/');
    }else{
        return res.status(404).send('Email non trovata o codice errato');
    }
});
// Middleware per controllare l'autenticazione

async function isAuthenticated(req, res, next) {
    const token = req.cookies.userName;
    if (!token) {
        return res.redirect('/');
    }

    jwt.verify(token, JWT_SECRET, async (err, user) => {
        if (err) {
            return res.redirect('/');
        }
        
        // Controlla se l'utente è approvato
        try {
            const username = user.username; 
            const approvedAdmin = await credentials.findOne({ "userName": username, "approved": true });
            
            if (!approvedAdmin) {
                return res.redirect(`/waitingApprovation/:${username}`);
            }
        } catch (error) {
            console.error('Errore durante il recupero dello stato di approvazione dell\'utente:', error);
            return res.status(500).json({ message: 'Errore del server' });
        }
        
        req.user = user;
        next();
    });
}




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
        const token = generateUserToken(userName);
        res.cookie('userName', token, { httpOnly: true });
        res.redirect(`/profile`);
    }else{
        res.json('Il codice OTP inserito è errato');
    }
});
app.get('/waitingApprovation/:userName', async (req, res) =>{
    const user = req.params.userName.replace(':',''); 
    const isApproved = await credentials.findOne({userName: user});
    res.render('waitingApprovation', { user: user });
});
app.get('/profile', isAuthenticated, async (req, res) => {
    const lezioni = await guide.find();
    const nome = req.user.username;
    const esami = await credentials.findOne({ "userName": nome }, { "exams": 1 });
    const personalData = await credentials.findOne({ "userName": nome }, { "billingInfo": 1});
    const bachecaContent = await bacheca.findOne();
    const exclude = await credentials.findOne({ "userName": nome }, { "exclude": 1 });
    const storicoGuide = await credentials.findOne({ "userName": nome }, {"lessonList": 1})
    const excludeInstructor = exclude.exclude;
    res.render('guideBooking', { nome, lezioni, esami, bachecaContent, excludeInstructor, personalData, storicoGuide});
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
        const [nome, cognome] = instructor.split(" ");
        const existingOrario = await admin.findOne({"nome": nome, "cognome": cognome, "ore.data": day});

        if (existingOrario) {
            const updatedOrari = await admin.findOneAndUpdate(
                {"nome": nome, "cognome": cognome, "ore.data": day},
                {$inc: {"ore.$.totOreGiorno": durationInHour}},
                {new: true}
            );
        } else {
            const updatedOrari = await admin.findOneAndUpdate(
                {"nome": nome, "cognome": cognome},
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
        returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(day + ' - ' + hour)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}&location=${encodeURIComponent(location)}`;
        }else if(cause == 'exam'){
            price = 100;
            numEsame = req.body.numEsame;
            description: "Pagamento per l'esame di guida in AutoScuolaCentrale"; 
            name = "Esame di Guida";
            sku = 2;
            //da cambiare in produzione
            returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&numEsame=${encodeURIComponent(numEsame)}&price=${encodeURIComponent(price)}`;

        }
        const create_payment_json = {
            intent: "sale",
            payer: {
                payment_method: "paypal"
            },
            redirect_urls: {
                return_url: returnUrl,
                //da cambiare in produzione
                cancel_url: "https://agenda-autoscuolacentrale.com/cancel",
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

                    fetch('https://agenda-autoscuolacentrale.com/book', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ instructor, time, day, duration, student, price, location})
                    })
                    .then(response => {
                        if (response.ok) {
                            console.log('Prenotazione effettuata con successo dopo il pagamento', req.query);

                            res.redirect(`/profile`);
                        } else {
                            console.error('Errore durante la prenotazione dopo il pagamento');

                            res.redirect(`/profile`);
                        }
                    })
                    .catch(error => {
                        console.error('Errore durante la prenotazione dopo il pagamento:', error);

                        res.redirect(`/profile`);
                    });
                }else if(cause == 'exam'){
                    const numEsame = req.query.numEsame;
                    //da cambiare in produzione
                    const response = await fetch('https://agenda-autoscuolacentrale.com/bookExam', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ student, numEsame, price})
                    });
                    if (response.ok) {
                        console.log('Prenotazione dell\'esame effettuata con successo dopo il pagamento', req.query);
                        
                        res.redirect(`/profile`);
                    } else {
                        console.error('Errore durante la prenotazione dell\'esame dopo il pagamento');
                        
                        res.redirect(`/profile`);
                    }
                }
            }
        });
    } catch (error) {
        console.error('Errore generale:', error);

        res.redirect(`/profile`);
    }
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});







// app.post('/payPP', async (req, res) => {
//     res.json({ message: 'Form data received successfully'})
// });










// const port = 5000;
// app.listen(port, '0.0.0.0', () =>{
//     console.log('Server running on Port: ' + port);
// })

// const http = require('http');

// const server = http.createServer((req, res) => {
//     res.send('Benvenuto alla pagina principale!');
// });

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});