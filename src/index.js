require('dotenv').config();

const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
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
const {createPaypal, retrivePayPal, createSatispay, retriveSatispay, checkCode, setLessonPaid, setSpostaGuidaPaid, setExamPaid } = require('./utils/paymentUtils');

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
            const approved = await credentials.findOne({ "userName": username, "approved": true });
            const archiviato = await credentials.findOne({ "userName": username, "archiviato": true });
            if (!approved) {
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

app.post('/book', isAuthenticated, async (req, res) => {
    try {
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const {_id} = await credentials.findOne({"userName": username});
        const returnPath = `/success/lesson`;
        const { instructor, time } = req.body;
        const [day, hour] = time.split(' - ');
        const guides = await guide.findOne({"instructor": instructor, "book": { $elemMatch: { "day": day, "schedule.hour": hour }}},
             { "book.$": 1 });
        
        if (!guides) return res.render('errorPage', { error: 'Schedule or lesson not found' });
        
        const lesson = guides.book[0].schedule.find(item => item.hour === hour && item.completed != true);

        if (!lesson) return res.render('errorPage', { error: 'Errore' });
        console.log(lesson,lesson.student)
        if (lesson.student) return res.render('errorPage', { error: 'Guida già prenotata' });
        if (lesson.pending) {
            const paymentCreatedAt = new Date(lesson.paymentCreatedAt);
            const currentDate = new Date();
            const expirationTime = 30 * 60 * 1000;
            
            if (currentDate - paymentCreatedAt < expirationTime) return res.render('errorPage', { error: 'Qualcuno ha già iniziato a prenotare questa lezione' });
        }
        await guide.findOneAndUpdate(
            { 
                "instructor": instructor, 
                "book": { $elemMatch: { "day": day, "schedule.hour": hour } } 
            },
            {
                $set: {
                    "book.$[dayElem].schedule.$[scheduleElem].pending": true,
                    "book.$[dayElem].schedule.$[scheduleElem].paymentCreatedAt": new Date()
                }
            },
            {
                arrayFilters: [
                    { "dayElem.day": day },
                    { "scheduleElem.hour": hour }
                ]
            }
        );
        const {price, location} = lesson;
        const custom = {scheduleId: lesson._id, bookId: guides.book[0]._id, instructor, day, hour, location}
        if(paymentMethod == 'paypal'){
            const url = await createPaypal(price, username, returnPath, custom);
            return res.redirect(url);
        }
        if(paymentMethod == 'satispay'){
            const url = await createSatispay(price, _id, returnPath, custom);
            return res.redirect(url);
        }
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, price, username, 'Lezione di guida')){
                await setLessonPaid(username, _id, custom);
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }
    } catch (error) {
        console.log('Si è verificato un\'errore durante la creazione del pagamento per la guida: ', error)
        return res.render('errorPage', {error: 'Errore durante la prenotazione'});
    }
});

app.get('/success/lesson', isAuthenticated, async (req, res) => {
    try {
        const {paymentMethod} = req.query;
        const { username } = req.user;
        const type = 'Lezione di guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let id, custom;
        if(paymentMethod == 'paypal'){
            const payerId = req.query.PayerID;
            const paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            const dati = await retrivePayPal(payerId, paymentId, type);
            id = dati.userId, custom = dati.custom
        }
        if(paymentMethod == 'satispay'){
            id = req.query.id;
            const { paymentId } = await credentials.findOne({"userName": username});
            const dati = await retriveSatispay(paymentId, username, type);
            custom = dati.custom;
            if(dati.status.toLowerCase() !='accepted' || !dati.status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        const status = await setLessonPaid(username, id, custom);
        if(status.expired) return res.render('errorPage', {error: 'Il pagamento è scaduto'});
        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento lezione: ', error);
        res.render('errorPage', {error: 'errore nel pagamento della lezione'});
    }
});

app.post('/bookExam', isAuthenticated, async (req, res) => {
    try {
        const price = 100;
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const returnPath = `/success/exam`;
        const {_id} = await credentials.findOne({"userName": username});
        if(paymentMethod == 'paypal'){
            const url = await createPaypal(price, username, returnPath);
            return res.redirect(url);
        }
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, price, username, 'Esame di guida')){
                await setExamPaid(_id);
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }
        if(paymentMethod == 'satispay'){
            const url = await createSatispay(price, _id, returnPath);
            return res.redirect(url);
        }
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
    }
});

app.get('/success/exam', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const type = 'Esame di guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let id;
        if(paymentMethod == 'paypal'){
            let payerId = req.query.PayerID;
            let paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            const { userId } = await retrivePayPal(payerId, paymentId, type);
            id = userId;
        }
        if(paymentMethod == 'satispay'){
            id = req.query.id;
            const { paymentId } = await credentials.findOne({"userName": username});
            const {status} = await retriveSatispay(paymentId, username, type);
            if(status.toLowerCase() !='accepted' || !status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        await setExamPaid(id);

        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento esame: ', error)
        res.render('errorPage', {error: 'errore nel pagamento dell\'esame'})
    }
});

app.post('/trascinamento', isAuthenticated, async (req, res) => {
    try {
        const price = 150;
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const returnPath = `/success/trascinamento`;
        const {_id} = await credentials.findOne({"userName": username});
        if(paymentMethod == 'paypal'){
            const url = await createPaypal(price, username, returnPath);
            return res.redirect(url);
        }
        if(paymentMethod == 'satispay'){
            const url = await createSatispay(price, _id, returnPath);
            return res.redirect(url);
        }
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, price, username, 'Trascinamento')){
                await credentials.findOneAndUpdate({"userName": username}, {"trascinamento.pagato": true});
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
    }
});

app.get('/success/trascinamento', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const type = 'Trascinamento';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let id;
        if(paymentMethod == 'paypal'){
            let payerId = req.query.PayerID;
            let paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            const { userId } = await retrivePayPal(payerId, paymentId, type);
            id = userId;
        }
        if(paymentMethod == 'satispay'){
            id = req.query.id;
            const { paymentId } = await credentials.findOne({"userName": username});
            const {status} = await retriveSatispay(paymentId, username, type);
            if(status.toLowerCase() !='accepted' || !status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        await credentials.findOneAndUpdate({"_id": id}, {"trascinamento.pagato": true});

        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento trascinamento: ', error)
        res.render('errorPage', {error: 'errore nel pagamento del trascinamento'})
    }
});

app.post('/spostaGuida', isAuthenticated, async (req, res) => {
    try {
        const price = 5;
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const custom = req.body;
        if (!req.body.newInstructor || !req.body.newDate  || !req.body.newHour) return res.render('errorPage', {error: 'Selezionare una fascia oraria e una data'})
        const returnPath = `/success/spostaGuida`;
        const {_id} = await credentials.findOne({"userName": username});
        if(paymentMethod == 'paypal'){
            const url = await createPaypal(price, username, returnPath, custom);
            res.redirect(url);
        }
        if(paymentMethod == 'satispay'){
            const url = await createSatispay(price, _id, returnPath, custom);
            return res.redirect(url);
        }
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
    }
});

app.get('/success/spostaGuida', isAuthenticated, async (req, res) => {
    try {
        const {paymentMethod} = req.query;
        const { username } = req.user;
        const type = 'Spostamento Lezione di Guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let id, custom;
        if(paymentMethod == 'paypal'){
            const payerId = req.query.PayerID;
            const paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            const dati = await retrivePayPal(payerId, paymentId, type);
            id = dati.userId, custom = dati.custom
        }
        if(paymentMethod == 'satispay'){
            id = req.query.id;
            const { paymentId } = await credentials.findOne({"userName": username});
            const dati = await retriveSatispay(paymentId, username, type);
            custom = dati.custom;
            if(dati.status.toLowerCase() !='accepted' || !dati.status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }

        await setSpostaGuidaPaid(id, custom);
        
        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento sposta guida: ', error)
        res.render('errorPage', {error: 'errore nel pagamento per lo spostamento della guida'})
    }
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
