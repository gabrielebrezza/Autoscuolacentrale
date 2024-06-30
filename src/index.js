require('dotenv').config();

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken'); 
const paypal = require('paypal-rest-sdk');
const fs = require('fs');

//DB schemas
const credentials = require('./Db/User');
const admin = require('./Db/Admin');
const guide = require('./Db/Guide');
const bacheca = require('./Db/Bacheca');
const formatoEmail = require('./Db/formatoEmail');
const prezzoGuida = require('./Db/CostoGuide');

//routes
const adminRoutes = require('./adminRoute/adminRoutes');
const { Admin } = require('mongodb');

//utils 
const sendEmail = require('./utils/emailsUtils');

paypal.configure({
    mode: "live",
    client_id: "AWjDhLyGssYR8jG_CSb6LTtajG-1GiqImcVnoVxHvrBg3wsYYszIqK99CWG7vHapMlNIh6nXe1dwG6kp",
    client_secret: "EJRa3xt9-nOV0QLVqi31cGzLu5ohxVtyx69zCt-ByMbawOlrgLKRzt_VDrT49lDqd72xgqF6IbXIQiJW"
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


const authenticateIscrizioneAPI = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === process.env.API_KEY_AGENDA) {
        next();
    } else {
        console.log(`Accesso non autorizzato tentato alle fatture da IP: ${req.ip}, URL: ${req.originalUrl}`);
        res.status(403).send('Forbidden');
    }
};


app.get('/invoice/:id', authenticateIscrizioneAPI, async (req, res) => {
    try {
        const nFattura = req.params.id.replace(':', '');
        const fileName = `IT06498290011_g00${nFattura}.xml`;
        const filePath = path.join('fatture', fileName);
        if (fs.existsSync(filePath)) {
            res.download(filePath, (err) => {
                if (err) {
                    console.error(`Errore nel download della fattura ${nFattura}: ${err}`);
                    res.status(500).send('Errore nel server');
                }
            });
        } else {
            res.status(404).send('Fattura non trovata');
        }
    } catch (error) {
        console.log(`si è verificato un errore ${error}`);
        res.status(500).send('Errore nel server');
    }
});

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

app.post('/verification', async (req, res) => {
    try {
        const userEmail = req.body.email.replace(/\s/g, "");
        const userCell = req.body.phone.replace(/\s/g, "");
        const userName = (req.body.username).replace(/\s/g, "");
        const password = req.body.password;
        const intent = req.body.intent;

        let saltRounds, hashedOTP;
        if (intent == 'login') { 
            const check = await credentials.findOne({
                "userName": userName,
                "email": userEmail,
                "cell": userCell
            });
            if (check) {
                const isPasswordMatch = await bcrypt.compare(password, check.password);
                
                if (isPasswordMatch) {
                    const otpCode = await generateOTP(6);
                    console.log(`Codice OTP per ${userName}: ${otpCode}`);
                    saltRounds = await bcrypt.genSalt(10);
                    hashedOTP = await bcrypt.hash(String(otpCode), saltRounds);
                    await credentials.findOneAndUpdate({
                            "cell": userCell,
                            "email": userEmail,
                            "userName": userName
                        }, {
                            "OTP": hashedOTP
                        }
                    );

                let subject = 'Codice di accesso per il tuo account di scuola guida';
                let text = `È appena stato effettuato l'accesso al tuo account, questo è il codice di verifica: ${otpCode}`;
                try{
                    const result = await sendEmail(userEmail, subject, text);
                    console.log(result);
                }catch(error){
                    console.log('errore: ', error);
                }

                res.redirect(`/verificationCode/:${userName.trim()}`);
                } else {
                    return res.render('errorPage', {error: 'Password errata'});
                }
            } else {
                return res.render('errorPage', {error: 'Credenziali errate'});
            }
        } else if (intent == 'signup') {
            const { nome, cognome, codiceFiscale, via, nCivico, CAP, citta, provincia, stato} = req.body;
            const otpCodePromise = generateOTP(6);
            const otpCode = await otpCodePromise;
            console.log(`Codice OTP per ${userName}: ${otpCode}`);
            saltRounds = await bcrypt.genSalt(10);
            hashedOTP = await bcrypt.hash(String(otpCode), saltRounds);
            const data = {
                email: userEmail.replace(/\s/g, ""),
                cell: userCell.replace(/\s/g, ""),
                userName: userName.trim(),
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
                        nome: nome.trim(),
                        cognome: cognome.trim(),
                        codiceFiscale: codiceFiscale.replace(/\s/g, ""),
                        via: via.trim(),
                        nCivico: nCivico.replace(/\s/g, ""),
                        CAP: CAP.replace(/\s/g, ""),
                        citta: citta.trim(),
                        provincia: provincia.trim(),
                        stato: stato.trim()
                    }
                ]
            }
            const existingUser = await credentials.findOne({userName: data.userName});
            const existingEmail = await credentials.findOne({email: data.email});
            const existingPhoneNumber = await credentials.findOne({cell: data.cell});
            if (existingUser) {
                return res.render('errorPage', {error: 'Esiste già un account con questo username'});
            } else if (existingEmail) {
                return res.render('errorPage', {error: 'Esiste già un account con questa email'});
            } else if (existingPhoneNumber) {
                return res.render('errorPage', {error: 'Esiste già un account con questo numero di cellulare'});
            } else {
                const hashedPassword = await bcrypt.hash(data.password, saltRounds);
                data.password = hashedPassword;

                const newUser = new credentials(data);
                await newUser.save();
                console.log('nuovo utente registrato in attesa di approvazione: ', data.userName);
                
                let subject = 'Nuovo Allievo';
                let text = 'Un nuovo allievo è in attesa di essere approvato.';
                let email = 'autoscuolacentraletorino@gmail.com';
                try{
                    const result = await sendEmail(email, subject, text);
                    console.log(result);
                }catch(error){
                    console.log('errore: ', error);
                }
                subject = 'Iscrizione effettuata a scuola guida';
                text = `Abbiamo inviato i tuoi dati all'autoscuola. A breve riceverai un'email di conferma che ti autorizzerà ad accedere all'agenda. Intanto per confermare la tua identità inserisci il codice richiesto sul sito ${otpCode}. Cordiali saluti.`;
                try{
                    const result = await sendEmail(userEmail.replace(/\s/g, ""), subject, text);
                    console.log(result);
                }catch(error){
                    console.log('errore: ', error);
                }
                res.redirect(`/verificationCode/:${userName.trim()}`);
            }
        }
    } catch (error) {
        console.error('Si è verificato un errore:', error);
        return res.render('errorPage', {error: 'Errore interno del server'});
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
            return res.render('errorPage', {error: 'Email non trovata'});
        }

        const subject = 'Codice di reset password scuolaguida';
        const text = `Gentile ${foundCredentials.billingInfo[0].nome} ${foundCredentials.billingInfo[0].cognome}, ci è arrivata una richiesta per cambiare password. Ti inviamo il codice di verifica per il tuo account ${resetPasswordCode}, clicca sul link per cambiarla agenda-autoscuolacentrale.com/newPassword`;
        try{
            const result = await sendEmail(email, subject, text);
            console.log('reset password:');
            console.log(result);
            return res.redirect('/');
        }catch(error){
            console.log('errore: ', error);
            return res.render('errorPage', { error: `errore nell'invio dell'email di reset`});
        }
    } catch (error) {
      console.error(error);
      return res.render('errorPage', {error: 'Si è verificato un errore durante il reset della password.'});
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
            await credentials.findOneAndUpdate({ "email": email, "resetPasswordCode": code }, {"password": hashedPassword});
            await credentials.updateOne(
                { "email": email, "resetPasswordCode": code },
                { $unset: { "resetPasswordCode": 1 } }
              );
        }
        res.redirect('/');
    }else{
        return res.render('errorPage', {error: 'Email non trovata o codice errato'});
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
            const archiviato = await credentials.findOne({ "userName": username, "archiviato": true });
            if (!approvedAdmin) {
                return res.redirect(`/waitingApprovation/:${username}`);
            }
            if(archiviato){
                return res.render('errorPage', {error: 'Il tuo account è stato Archiviato, se ritieni ci sia stato un errore contatta l\'autoscuola'});
            }
        } catch (error) {
            console.error('Errore durante il recupero dello stato di approvazione dell\'utente:', error);
            return res.render('errorPage', {error: 'Errore del server'});
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
        const ottoMesi = 8 * 30;
        const durataInMillisecondi = ottoMesi * 24 * 60 * 60 * 1000;
        res.cookie('userName', token, { httpOnly: true, maxAge: durataInMillisecondi });
        res.redirect(`/profile`);
    }else{
        return res.render('errorPage', {error: 'Il codice OTP inserito è errato'});
    }
});
app.get('/waitingApprovation/:userName', async (req, res) =>{
    const user = req.params.userName.replace(':','');
    res.render('waitingApprovation', { user: user });
});
app.get('/profile', isAuthenticated, async (req, res) => {
    const lezioni = await guide.find();
    const nome = req.user.username;
    const {trascinamento} = await credentials.findOne({ "userName": nome }, { "trascinamento": 1 });
    const esami = await credentials.findOne({ "userName": nome }, { "exams": 1 });
    const personalData = await credentials.findOne({ "userName": nome }, { "billingInfo": 1});
    const bachecaContent = await bacheca.findOne();
    const exclude = await credentials.findOne({ "userName": nome }, { "exclude": 1 });
    const storicoGuide = await credentials.findOne({ "userName": nome }, {"lessonList": 1})
    const excludeInstructor = exclude.exclude;
    const email = await credentials.findOne({"userName": nome}, {"email": 1});
    const userEmail = email.email;
    res.render('guideBooking', { nome, lezioni, esami, bachecaContent, excludeInstructor, personalData, storicoGuide, userEmail, trascinamento});
});



app.post('/book', async (req, res) => {
    
        const { instructor, time, day, duration, student, price, location } = req.body;
        const giorno = time.split(' - ')[0];
        const hour = time.split(' - ')[1];
        try {
        await guide.findOneAndUpdate(
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

    } catch (error) {
        console.error('Errore durante la prenotazione:', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione'});
    }
    try{  
        const user = await credentials.findOne(
            {"userName": student}, 
            {
                "email": 1,
                "billingInfo": 1
            }
        ); 
        let subject = 'Prenotazione effettuata per lezione di guida';
        const {content} = await formatoEmail.findOne({})
        let text = content
        .replace(/\(NOME\)/g, user.billingInfo[0].nome)
        .replace(/\(COGNOME\)/g, user.billingInfo[0].cognome)
        .replace(/\(DATA\)/g, day)
        .replace(/\(DAORA\)/g, hour.split('-')[0])
        .replace(/\(AORA\)/g, hour.split('-')[1])
        .replace(/\(LINKPOSIZIONE\)/g, location);
        try{
            const result = await sendEmail(user.email, subject, text);
            console.log(result);
        }catch(error){
            console.log('errore: ', error);
        }
    } catch (error) {
        console.error(`Errore durante la creazione del testo per l'email di conferma prenotazione: ${error}`);
    }
        try {
            const durationInHour = duration/60;
            const [nome, cognome] = instructor.split(" ");
            const existingOrario = await admin.findOne({"nome": nome, "cognome": cognome, "ore.data": day});

            if (existingOrario) {
                await admin.findOneAndUpdate(
                    {"nome": nome, "cognome": cognome, "ore.data": day},
                    {$inc: {"ore.$.totOreGiorno": durationInHour}},
                    {new: true}
                );
            } else {
                await admin.findOneAndUpdate(
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
            await credentials.findOneAndUpdate(
                {"userName": student},
                {
                    $addToSet: {
                        "fatturaDaFare": {"tipo": 'lezione di guida', "data": dataFatturazione, "importo": price, "emessa": false},
                        "lessonList": {"istruttore": instructor, "giorno": giorno, "ora": hour, "duration": durationInHour}
                    }
                },
                {new: true}
            );
        } catch (error) {
            console.error(`errore durante il salvataggio della fattura: ${error}`);
        }
        res.sendStatus(200);
});

app.post('/bookExam', async (req, res) => {
    try {
        const price = req.body.price;
        const userName = req.body.student;
        let numEsame = parseInt(req.body.numEsame);
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
        await credentials.findOneAndUpdate(
            {"userName": userName},
            {$addToSet: {"fatturaDaFare": {"tipo": 'Esame di guida', "data": dataFatturazione, "importo": price, "emessa": false}}},
            {new: true}
        );
        res.sendStatus(200); 
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
    }
});

app.post('/create-code-payment', async (req, res) => {
    try {
        const student = req.body.student;
        const cause = req.body.cause;
        let instructor, location;
        let price, time, day, hour, numEsame, duration;
        if(req.body.time){
            time = req.body.time;
            const timeParts = time.split(' - '); 
            day = timeParts[0];
            hour = timeParts[1];
            const [startTime, endTime] = hour.split('-').map(t => t.trim());

            const [startHour, startMin] = startTime.split(':').map(Number);
            const [endHour, endMin] = endTime.split(':').map(Number);
            
            
            if (endHour > startHour || (endHour === startHour && endMin >= startMin)) {
                duration = (endHour - startHour) * 60 + (endMin - startMin);
            } else {
                duration = (24 - startHour + endHour) * 60 + (endMin - startMin);
            }
        }
        const pricePerHour = await prezzoGuida.findOne();
        price = cause == 'exam' ? 100 : cause == 'trascinamento' ? 150 : (pricePerHour.prezzo * (duration/60));
        const code = req.body.codicePagamento;
        const exists = !!(await credentials.findOne({
            "userName": student,
            "codicePagamento": {
              $elemMatch: {
                "codice": code,
                "importo": price
              }
            }
        }));
        if(exists){
            if(cause == 'lesson'){
                instructor = req.body.instructor;
                location = req.body.location;
                
                const guides = await guide.findOne({ instructor: instructor });
                if (!guides) {
                    return res.render('errorPage', {error: 'Instructor not found'});
                }
                const schedule = guides.book.find(item => item.day === day);
                if (!schedule) {
                    return res.render('errorPage', {error: 'Schedule not found'});
                }
                const lesson = schedule.schedule.find(item => item.hour === hour);
                if (!lesson) {
                    return res.render('errorPage', {error: 'Lesson not found'});
                }
                price = lesson.price;
                fetch('https://agenda-autoscuolacentrale.com/book', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ instructor, time, day, duration, student, price, location})
                })
                .then(async  response => {
                    if (response.ok) {
                        await credentials.updateOne(
                            {"userName": student},
                            { $pull: { "codicePagamento": { "codice": code, "importo": price } } }
                          );
                        console.log('Prenotazione effettuata con successo dopo il pagamento con codice');
                        return { success: true };
                    } else {
                        console.error('Errore durante la prenotazione dopo il pagamento');
                        return { success: false, error: 'Errore durante la prenotazione dopo il pagamento' };
                    }
                })
                .catch(error => {
                    console.error('Errore durante la prenotazione dopo il pagamento:', error);
                    return { success: false, error: 'Errore durante la prenotazione dopo il pagamento' };
                })
                .then(result => {
                    if (result.success) {
                        return res.redirect('/profile');
                    } else {
                        return res.render('errorPage', { error: result.error });
                    }
                });
            }else if(cause == 'exam'){
                price = 100;
                numEsame = req.body.numEsame;
                const response = await fetch('https://agenda-autoscuolacentrale.com/bookExam', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ student, numEsame, price})
                });
                if (response.ok) {
                    await credentials.updateOne(
                        {"userName": student},
                        { $pull: { "codicePagamento": { "codice": code, "importo": price } } }
                    );
                    console.log('Prenotazione dell\'esame effettuata con successo dopo il pagamento con codice');
                    return res.redirect(`/profile`);
                } else {
                    console.error('Errore durante la prenotazione dell\'esame dopo il pagamento');
                    return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'esame dopo il pagamento'});
                }
            }else if(cause == 'trascinamento'){
                await credentials.findOneAndUpdate(
                    {"userName": student},
                    {"trascinamento.pagato": true}
                );
                await credentials.updateOne(
                    {"userName": student},
                    { $pull: { "codicePagamento": { "codice": code, "importo": price } } }
                );
                return res.redirect(`/profile`);
            }
        }else{
            return res.render('errorPage', {error: 'codice non esistente o importo diverso da quello del codice'});
        }
    } catch (error) {
        console.error(error);
        return res.render('errorPage', {error: 'Internal server error'});
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
                return res.render('errorPage', {error: 'Instructor not found'});
            }

        const schedule = guides.book.find(item => item.day === day);
        if (!schedule) {
            return res.render('errorPage', {error: 'Schedule not found'});
        }
        const lesson = schedule.schedule.find(item => item.hour === hour);
        if (!lesson) {
            return res.render('errorPage', {error: 'Lesson not found'});
        }
        price = lesson.price;
        description: "Pagamento per la lezione di guida in AutoScuolaCentrale"; 
        name = "Lezione di Guida";
        sku = 1;
        returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&instructor=${encodeURIComponent(instructor)}&time=${encodeURIComponent(day + ' - ' + hour)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}&location=${encodeURIComponent(location)}`;
        }else if(cause == 'exam'){
            price = 100;
            numEsame = req.body.numEsame;
            description: "Pagamento per l'esame di guida in AutoScuolaCentrale"; 
            name = "Esame di Guida";
            sku = 2;
            returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&numEsame=${encodeURIComponent(numEsame)}&price=${encodeURIComponent(price)}`;

        }else if(cause == 'spostaGuida'){
            const istruttoreLezioneDaSpostare = req.body.istruttoreLezioneDaSpostare;
            const dataLezioneDaSpostare = req.body.dataLezioneDaSpostare;
            const oraLezioneDaSpostare = req.body.oraLezioneDaSpostare;
            const nuovoIstruttore = req.body.nuovoIstruttore;
            const nuovaData = req.body.nuovaData;
            const nuovaOra = req.body.nuovaOra;
            const durata = req.body.durataLezioneDaSpostare;
            price = 5;
            description: "Pagamento per lo spostamento della lezione di guida in AutoScuolaCentrale"; 
            name = "Spostamento lezione di Guida";
            sku = 3;
            returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}&oldInstructor=${encodeURIComponent(istruttoreLezioneDaSpostare)}&oldDate=${encodeURIComponent(dataLezioneDaSpostare)}&oldHour=${encodeURIComponent(oraLezioneDaSpostare)}&newInstructor=${encodeURIComponent(nuovoIstruttore)}&newDate=${encodeURIComponent(nuovaData)}&newHour=${encodeURIComponent(nuovaOra)}&durata=${encodeURIComponent(durata)}`;
        }else if(cause == 'trascinamento'){
            price = 150;
            description: "Pagamento per il trascinamento in AutoScuolaCentrale"; 
            name = "Trascinamento";
            sku = 4;
            returnUrl = `https://agenda-autoscuolacentrale.com/success?cause=${encodeURIComponent(cause)}&student=${encodeURIComponent(student)}&price=${encodeURIComponent(price)}`;
        }
        const create_payment_json = {
            intent: "sale",
            payer: {
                payment_method: "paypal"
            },
            redirect_urls: {
                return_url: returnUrl,
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
        return res.render('errorPage', {error: 'Internal server error'});
    }
});

app.get('/success',  async (req, res) =>{
    try {
        const payerId = req.query.PayerID;
        const paymentId = req.query.paymentId;
        const price = req.query.price;
        if(!paymentId || !payerId){
            return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
        }
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

                            return res.render('errorPage', {error: 'Errore durante la prenotazione dopo il pagamento'});
                        }
                    })
                    .catch(error => {
                        console.error('Errore durante la prenotazione dopo il pagamento:', error);

                        return res.render('errorPage', {error: 'Errore durante la prenotazione dopo il pagamento'});
                    });
                }else if(cause == 'exam'){
                    const numEsame = req.query.numEsame;
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
                        
                        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'esame dopo il pagamento'});
                    }
                }else if(cause == 'spostaGuida'){
                    const oldInstructor = req.query.oldInstructor;
                    const oldDate = req.query.oldDate;
                    const oldHour = req.query.oldHour;
                    const newInstructor = req.query.newInstructor;
                    const newDate = req.query.newDate;
                    const newHour = req.query.newHour;
                    const durata = Number(req.query.durata);
                        const [oldName, oldSurName] = oldInstructor.split(" ");
                        await admin.findOneAndUpdate(
                            {
                                "nome": oldName,
                                "cognome": oldSurName,
                                "ore.data": oldDate
                            },
                            {
                                $inc: {
                                    "ore.$.totOreGiorno": -durata
                                }
                            }
                        );
                        const [newName, newSurName] = newInstructor.split(" ");
                        const existingOrario = await admin.findOne({"nome": newName, "cognome": newSurName, "ore.data": newDate});
                        if (existingOrario) {
                            await admin.findOneAndUpdate(
                                {
                                    "nome": newName,
                                    "cognome": newSurName,
                                    "ore.data": newDate
                                },
                                {
                                    $inc: {
                                        "ore.$.totOreGiorno": durata
                                    }
                                },
                                {
                                    new: true
                                }
                            );
                        } else {
                            await admin.findOneAndUpdate(
                                {
                                    "nome": newName,
                                    "cognome": newSurName
                                },
                                {
                                    $addToSet: {
                                        "ore": {
                                            "data": newDate,
                                            "totOreGiorno": durata
                                        }
                                    }
                                },
                                {
                                    new: true
                                }
                            );
                        }
                    await guide.findOneAndUpdate(
                        {
                            "instructor": oldInstructor,
                            "book": {
                                $elemMatch: {
                                    "day": oldDate,
                                    "schedule": {
                                        $elemMatch: {
                                            "hour": oldHour,
                                            "student": student
                                        }
                                    }
                                }
                            }
                        },
                        {
                            $set: {
                                "book.$[outer].schedule.$[inner].student": null
                            }
                        },
                        {
                            arrayFilters: [
                                { "outer.day": oldDate },
                                { "inner.hour": oldHour, "inner.student": student }
                            ]
                        }
                    );
                    
                    await guide.findOneAndUpdate(
                        {
                            "instructor": newInstructor,
                            "book": {
                                $elemMatch: {
                                    "day": newDate,
                                    "schedule": {
                                        $elemMatch: {
                                            "hour": newHour,
                                            "student": null
                                        }
                                    }
                                }
                            }
                        },
                        {
                            $set: {
                                "book.$[outer].schedule.$[inner].student": student
                            }
                        },
                        {
                            arrayFilters: [
                                { "outer.day": newDate },
                                { "inner.hour": newHour, "inner.student": null }
                            ]
                        }
                    );
                     
                    const today = new Date();
                    const d = String(today.getDate()).padStart(2, '0'); 
                    const month = String(today.getMonth() + 1).padStart(2, '0'); 
                    const year = today.getFullYear(); 
                    const dataFatturazione = `${d}/${month}/${year}`;
                    await credentials.findOneAndUpdate(
                        {
                            "userName": student
                        },
                        {
                            $pull: {
                                "lessonList": {
                                        "istruttore": oldInstructor,
                                        "giorno": oldDate,
                                        "ora": oldHour,
                                        "duration": durata
                                }
                            }
                        }
                    );            
                    await credentials.findOneAndUpdate(
                        {"userName": student},
                        {
                            $addToSet: {
                                "fatturaDaFare": {"tipo": 'spostamento lezione di guida', "data": dataFatturazione, "importo": price, "emessa": false},
                                "lessonList": {"istruttore": newInstructor, "giorno": newDate, "ora": newHour, "duration": durata}
                            }
                        },
                        {new: true}
                    );   
                    res.redirect('/profile');                 
                }else if(cause == "trascinamento"){
                    await credentials.findOneAndUpdate(
                        {"userName": student},
                        {"trascinamento.pagato": true}
                    );
                    const today = new Date();
                    const d = String(today.getDate()).padStart(2, '0'); 
                    const month = String(today.getMonth() + 1).padStart(2, '0'); 
                    const year = today.getFullYear(); 
                    const dataFatturazione = `${d}/${month}/${year}`;
                    await credentials.findOneAndUpdate(
                        {"userName": student},
                        {
                            $addToSet: {
                                "fatturaDaFare": {"tipo": 'trascinamento', "data": dataFatturazione, "importo": price, "emessa": false},
                            }
                        },
                        {new: true}
                    ); 
                    res.redirect('/profile'); 
                }
            }
        });
    } catch (error) {
        console.error('Errore generale:', error);

        return res.render('errorPage', {error: 'Errore del server'});
    }
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});