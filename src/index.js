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
const prices = require('./Db/CostoGuide');
const LessonsDB = require('./Db/Lessons');
const CodesDB = require('./Db/Codes');

//routes
const adminRoutes = require('./adminRoute/adminRoutes');
const { Admin } = require('mongodb');

//utils 
const sendEmail = require('./utils/emailsUtils');
const { createPaypal, retrivePayPal, createSatispay, retriveSatispay, checkCode, setLessonPaid, setSpostaGuidaPaid, setExamPaid } = require('./utils/paymentUtils');
const { randomInt } = require('crypto');

const app = express();

app.use(cookieParser());

app.use(express.json());

app.use(express.urlencoded({extended: true}));

app.set('view engine', 'ejs');

app.set('views', 'views');

app.use(express.static('public'));

app.use(bodyParser.urlencoded({ extended: true}));

app.use(adminRoutes);

const authenticateIscrizioneAPI = (req, res, next) => {
    const token = req.headers['authorization'];
    if (token === process.env.API_KEY_AGENDA) {
        next();
    } else {
        console.log(`Tentativo di accesso non autorizzato  alle fatture da IP: ${req.ip}, URL: ${req.originalUrl}`);
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


const rateLimit = require('express-rate-limit');

const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: 'Hai superato il numero massimo di tentativi. Riprova più tardi.',
  standardHeaders: true,
  legacyHeaders: false,
});


app.post('/verification', otpLimiter, async (req, res) => {
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
        }else {
            return res.status(400).render('errorPage', { error: 'Intent non valido' });
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
// app.get('/profile', isAuthenticated, async (req, res) => {
//     const lezioni = await guide.find();
//     const nome = req.user.username;
//     const {trascinamento} = await credentials.findOne({ "userName": nome }, { "trascinamento": 1 });
//     const esami = await credentials.findOne({ "userName": nome }, { "exams": 1 });
//     const personalData = await credentials.findOne({ "userName": nome }, { "billingInfo": 1});
//     const bachecaContent = await bacheca.findOne();
//     const exclude = await credentials.findOne({ "userName": nome }, { "exclude": 1 });
//     const storicoGuide = await credentials.findOne({ "userName": nome }, {"lessonList": 1})
//     const excludeInstructor = exclude.exclude;
//     const email = await credentials.findOne({"userName": nome}, {"email": 1});
//     const prezzi = await prices.findOne();
//     const userEmail = email.email;
//     res.render('guideBooking', { nome, lezioni, esami, bachecaContent, excludeInstructor, personalData, storicoGuide, userEmail, trascinamento, prezzi});
// });

app.get('/profile', isAuthenticated, async (req, res) => {
    const nome = req.user.username;
    const userId = (await credentials.findOne({"userName": nome}))._id;
    const lezioni = await LessonsDB.find({
        day: { $gt: new Date().setHours(0, 0, 0, 0) },
        $or: [
          { student: null },
        //   { student: userId }
        ]
      })
      .populate('instructor', 'nome')
      .select('instructor student day startTime endTime duration reservedTo');

      const giorniPrenotati = new Set(
        lezioni
          .filter(l => l.student && l.student.equals(userId)) // solo lezioni già prenotate
          .map(l => l.day.toISOString().split('T')[0])       // formato 'YYYY-MM-DD'
      );
      const examId = (await admin.findOne({"nome": 'Esame', "cognome": "Guida"}))._id;

    const { exclude } = await credentials.findOne({ "userName": nome }, { "exclude": 1 });
    let excludeInstructorIds = [];
    if (exclude && exclude.length > 0) {
      excludeInstructorIds = await Promise.all(
        exclude.map(async (e) => {
          const instr = await admin.findOne({ nome: e.split(' ')[0], cognome: e.split(' ')[1] });
          return instr?._id ?? null;
        })
      );
    }

      // Step 2: filtra le lezioni rimuovendo quelle nei giorni già prenotati
const lezioniFiltrate = lezioni.filter(l => {
    if (l.instructor._id.equals(examId)) return false;
    if (excludeInstructorIds.includes(l.instructor._id)) return false;
  
    // const giorno = l.day.toISOString().split('T')[0];
    // if (giorniPrenotati.has(giorno)) return false;
  
    if (!l.reservedTo || l.reservedTo.length === 0) return true;
    return l.reservedTo.some(id => id == userId);
  });
  
  // Step 3: raggruppa per giorno e istruttore
  const giorniMap = new Map();
  
  lezioniFiltrate.forEach(l => {
    const giorno = l.day.toISOString().split('T')[0].split('-').reverse().join('/');
    const istruttoreId = l.instructor._id.toString();
  
    if (!giorniMap.has(giorno)) giorniMap.set(giorno, new Map());
    const istruttoriMap = giorniMap.get(giorno);
  
    if (!istruttoriMap.has(istruttoreId)) istruttoriMap.set(istruttoreId, []);
    istruttoriMap.get(istruttoreId).push(l);
  });
  
  // Step 4: costruisci l’array finale ordinando le lezioni per orario
  const lezioniRaggruppate = [];
  
  giorniMap.forEach((istruttoriMap, giorno) => {
    const istruttoriArray = [];
    istruttoriMap.forEach((lezioniArray, istruttoreId) => {
      lezioniArray.sort((a, b) => {
        const [aHour, aMinute] = a.startTime.split(':').map(Number);
        const [bHour, bMinute] = b.startTime.split(':').map(Number);
        return aHour !== bHour ? aHour - bHour : aMinute - bMinute;
      });
      istruttoriArray.push({
        instructor: lezioniArray[0].instructor,
        lezioni: lezioniArray
      });
    });
    lezioniRaggruppate.push({
      day: giorno,
      instructors: istruttoriArray
    });
  });
  
    const user = await credentials.findOne({ "userName": nome });
    const {trascinamento, exams, billingInfo: personalData, email, createdAt } = user;
    const bachecaContent = await bacheca.findOne();
    const lessonList = await LessonsDB.find({ "student": userId, "payment.status": 'completed' })
      .populate('instructor', 'nome')
      .select('instructor day startTime endTime duration');
    const prezzi = await prices.findOne({});
    const lessonPrice = prezzi.userPriceFromDate.fromDate.getTime() <= createdAt.getTime() ? prezzi.userPriceFromDate.price : prezzi.prezzo;
    const userEmail = email.email;
    res.render('guideBookingV2', { nome, lezioniRaggruppate, exams, bachecaContent, personalData, lessonList, userEmail, trascinamento, prezzi, lessonPrice});
});

// app.post('/book', isAuthenticated, async (req, res) => {
//     try {
//         const username = req.user.username;
//         const { paymentMethod } = req.body;
//         console.log(req.body)
//         const {_id} = await credentials.findOne({"userName": username});
//         const returnPath = `/success/lesson`;
//         const { instructor, time } = req.body;
//         const [day, hour] = time.split(' - ');
//         const guides = await guide.findOne({"instructor": instructor, "book": { $elemMatch: { "day": day, "schedule.hour": hour }}},
//              { "book.$": 1 });
        
//         if (!guides) return res.render('errorPage', { error: 'Schedule or lesson not found' });
        
//         const lesson = guides.book[0].schedule.find(item => item.hour === hour && item.completed != true);

//         if (!lesson) return res.render('errorPage', { error: 'Errore' });
//         if (lesson.student || lesson.completed) return res.render('errorPage', { error: 'Guida già prenotata' });
//         if (lesson.pending) {
//             const paymentCreatedAt = new Date(lesson.paymentCreatedAt);
//             const currentDate = new Date();
//             const expirationTime = 30 * 60 * 1000;
            
//             if (currentDate.getTime() - paymentCreatedAt.getTime() < expirationTime) return res.render('errorPage', { error: 'Qualcuno ha già iniziato a prenotare questa lezione' });
//         }
//         await guide.findOneAndUpdate(
//             { 
//                 "instructor": instructor, 
//                 "book": { $elemMatch: { "day": day, "schedule.hour": hour } } 
//             },
//             {
//                 $set: {
//                     "book.$[dayElem].schedule.$[scheduleElem].pending": true,
//                     "book.$[dayElem].schedule.$[scheduleElem].paymentCreatedAt": new Date()
//                 }
//             },
//             {
//                 arrayFilters: [
//                     { "dayElem.day": day },
//                     { "scheduleElem.hour": hour }
//                 ]
//             }
//         );
//         const {price, location} = lesson;
//         const custom = {scheduleId: lesson._id, bookId: guides.book[0]._id, instructor, day, hour, location}
//         if(paymentMethod == 'paypal'){
//             const url = await createPaypal(Number(price).toFixed(2), username, returnPath, custom);
//             return res.redirect(url);
//         }
//         if(paymentMethod == 'satispay'){
//             const url = await createSatispay(price, _id, returnPath, custom);
//             return res.redirect(url);
//         }
//         if(paymentMethod == 'code'){
//             if(await checkCode(req.body.codicePagamento, price, username, 'Lezione di guida')){
//                 await setLessonPaid(username, _id, custom);
//                 return res.redirect('/profile');
//             }else{
//                 return res.render('errorPage', {error: 'Codice non esistente'});
//             }
//         }
//     } catch (error) {
//         console.log('Si è verificato un\'errore durante la creazione del pagamento per la guida: ', error)
//         return res.render('errorPage', {error: 'Errore durante la prenotazione'});
//     }
// });


app.post('/book', isAuthenticated, async (req, res) => {
    try {
        const username = req.user.username;
        const { paymentMethod, instructor, time } = req.body;
        const user = await credentials.findOne({ userName: username }, { createdAt: 1 });
        if (!user) return res.render('errorPage', { error: 'Utente non trovato!' });

        let [day, hour] = time.split(' - ');
        const [startTime, endTime] = hour.split('-');
        day = new Date(day.split('/').reverse().join('-'));
        const lesson = await LessonsDB.findOne({"instructor": instructor, "day": day, "startTime": startTime, "endTime": endTime});
        
        if (!lesson) return res.render('errorPage', { error: 'Lezione non trovata!' });
        if(lesson.payment.status === 'completed') return res.render('errorPage', { error: 'Qualcuno ha già prenotato questa lezione!' });
        
        const prezzi = await prices.findOne();
        const price = Number((prezzi.userPriceFromDate.fromDate.getTime() <= user.createdAt.getTime() ? prezzi.userPriceFromDate.price * (lesson.duration/60) : prezzi.prezzo * (lesson.duration/60)).toFixed(2)); 
        
        const expirationTime = 30 * 60 * 1000;
        const now = new Date();
        
        const lessonUpdated = !!(await LessonsDB.findOneAndUpdate({"_id": lesson._id, $or: [ { "payment.status": null }, { "payment.status": "pending", "payment.paymentCreatedAt": { $lte: new Date(now.getTime() - expirationTime) } }]}, { "payment.amount": price, "payment.status": 'pending', "payment.paymentCreatedAt": new Date()}));
        if (!lessonUpdated) return res.render('errorPage', { error: 'Qualcuno sta già prenotando questa lezione!' });
        
        const custom = {lessonId: lesson._id};
        const returnPath = `/success/lesson`;
        let paymentId, url;
        if(paymentMethod == 'paypal'){
            ({ url, paymentId } = await createPaypal(price, returnPath, custom));
        }
        if(paymentMethod == 'satispay'){
            ({ url, paymentId } = await createSatispay(price, lesson._id, returnPath, custom));
        }
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, price, user._id, 'Lezione di guida')){
                await setLessonPaid(user._id, lesson._id);
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }
        await LessonsDB.findByIdAndUpdate(lesson._id, { "payment.paymentId": paymentId });
        return res.redirect(url)
    } catch (error) {
        console.log('Si è verificato un\'errore durante la creazione del pagamento per la guida: ', error)
        return res.render('errorPage', {error: 'Errore durante la prenotazione'});
    }
});




// app.get('/success/lesson', isAuthenticated, async (req, res) => {
//     try {
//         const { paymentMethod } = req.query;
//         const { username } = req.user;
//         const type = 'Lezione di guida';
//         if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
//         let id, custom;
//         if(paymentMethod == 'paypal'){
//             const payerId = req.query.PayerID;
//             const paymentId = req.query.paymentId;
//             if(!paymentId || !payerId){
//                 return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
//             }
//             const dati = await retrivePayPal(username, payerId, paymentId, type);
//             id = dati.userId, custom = dati.custom
//         }
//         if(paymentMethod == 'satispay'){
//             id = req.query.id;
//             const { paymentId } = await credentials.findOne({"userName": username});
//             const dati = await retriveSatispay(paymentId, username, type);
//             custom = dati.custom;
//             if(dati.status.toLowerCase() !='accepted' || !dati.status){
//                 return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
//             }
//         }
//         const status = await setLessonPaid(username, id, custom);
//         if(status.expired) return res.render('errorPage', {error: 'Il pagamento è scaduto'});
//         res.redirect('/profile');
//     } catch (error) {
//         console.log('errore nella ricezione del pagamento lezione: ', error);
//         res.render('errorPage', {error: 'errore nel pagamento della lezione'});
//     }
// });

app.get('/success/lesson', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const userId = (await credentials.findOne({ "userName": username }))._id;
        const type = 'Lezione di guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let custom;
        if(paymentMethod == 'paypal'){
            const payerId = req.query.PayerID;
            const paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            const dati = await retrivePayPal(username, payerId, paymentId, type);
            ({ custom } = dati);
        }
        if(paymentMethod == 'satispay'){
            const { payment } = await LessonsDB.findById(req.query.lessonId);
            const dati = await retriveSatispay(username, payment.paymentId, type);
            ({ custom } = dati);
            if(dati.status.toLowerCase() !='accepted' || !dati.status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        const status = await setLessonPaid(userId, custom.lessonId);
        if(status.expired) return res.render('errorPage', {error: 'Il pagamento è scaduto'});
        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento lezione: ', error);
        res.render('errorPage', {error: 'errore nel pagamento della lezione'});
    }
});

// app.post('/bookExam', isAuthenticated, async (req, res) => {
//     try {
//         const { prezzoEsame } = await prices.findOne();
//         const username = req.user.username;
//         const { paymentMethod } = req.body;
//         const returnPath = `/success/exam`;
//         const {_id} = await credentials.findOne({"userName": username});
//         if(paymentMethod == 'paypal'){
//             const url = await createPaypal(prezzoEsame, username, returnPath);
//             return res.redirect(url);
//         }
//         if(paymentMethod == 'code'){
//             if(await checkCode(req.body.codicePagamento, prezzoEsame, username, 'Esame di guida')){
//                 await setExamPaid(_id);
//                 return res.redirect('/profile');
//             }else{
//                 return res.render('errorPage', {error: 'Codice non esistente'});
//             }
//         }
//         if(paymentMethod == 'satispay'){
//             const url = await createSatispay(prezzoEsame, _id, returnPath);
//             return res.redirect(url);
//         }
//     } catch (error) {
//         console.error('Errore durante la prenotazione dell\'Esame :', error);
//         return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
//     }
// });


app.post('/bookExam', isAuthenticated, async (req, res) => {
    try {
        const { prezzoEsame } = await prices.findOne();
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const returnPath = `/success/exam`;
        const user = await credentials.findOne({"userName": username});
        let url, paymentId;
        if(paymentMethod == 'paypal') ({url, paymentId} = await createPaypal(prezzoEsame, returnPath));
        if(paymentMethod == 'satispay') ({url, paymentId} = await createSatispay(prezzoEsame, '', returnPath));
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, prezzoEsame, user._id, 'Esame di guida')){
                await setExamPaid(user._id);
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }

        await credentials.findByIdAndUpdate(user._id, { "paymentId": paymentId });
        return res.redirect(url)
    } catch (error) {
        console.error('Errore durante la prenotazione dell\'Esame :', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
    }
});

// app.get('/success/exam', isAuthenticated, async (req, res) => {
//     try {
//         const { paymentMethod } = req.query;
//         const { username } = req.user;
//         const type = 'Esame di guida';
//         if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
//         let id;
//         if(paymentMethod == 'paypal'){
//             let payerId = req.query.PayerID;
//             let paymentId = req.query.paymentId;
//             if(!paymentId || !payerId){
//                 return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
//             }
//             const { userId } = await retrivePayPal(payerId, paymentId, type);
//             id = userId;
//         }
//         if(paymentMethod == 'satispay'){
//             id = req.query.id;
//             const { paymentId } = await credentials.findOne({"userName": username});
//             const {status} = await retriveSatispay(paymentId, username, type);
//             if(status.toLowerCase() !='accepted' || !status){
//                 return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
//             }
//         }
//         await setExamPaid(id);

//         res.redirect('/profile');
//     } catch (error) {
//         console.log('errore nella ricezione del pagamento esame: ', error)
//         res.render('errorPage', {error: 'errore nel pagamento dell\'esame'})
//     }
// });

app.get('/success/exam', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const type = 'Esame di guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        const user = await credentials.findOne({"userName": username});
        if(paymentMethod == 'paypal'){
            let payerId = req.query.PayerID;
            let paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            await retrivePayPal(username, payerId, paymentId, type);
        }
        if(paymentMethod == 'satispay'){
            
            const { status } = await retriveSatispay(username, user.paymentId, type);
            if(status.toLowerCase() !='accepted' || !status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        await setExamPaid(user._id);

        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento esame: ', error)
        res.render('errorPage', {error: 'errore nel pagamento dell\'esame'})
    }
});

// app.post('/pacchetto', isAuthenticated, async (req, res) => {
//     try {
//         const { prezzoPacchetto } = await prices.findOne();
//         const username = req.user.username;
//         const { paymentMethod } = req.body;
//         const returnPath = `/success/pacchetto`;
//         const {_id} = await credentials.findOne({"userName": username});
//         if(paymentMethod == 'satispay'){
//             const url = await createSatispay(prezzoPacchetto, _id, returnPath);
//             return res.redirect(url);
//         }
//     } catch (error) {
//         console.error('Errore durante la prenotazione del pacchetto:', error);
//         return res.render('errorPage', {error: 'Errore durante la prenotazione del pacchetto'});
//     }
// });

app.post('/pacchetto', isAuthenticated, async (req, res) => {
    try {
        const username = req.user.username;
        const { paymentMethod } = req.body;
        const returnPath = `/success/pacchetto`;
        const { prezzoPacchetto } = await prices.findOne();
        let url, paymentId;
        if(paymentMethod == 'paypal') ({url, paymentId} = await createPaypal(prezzoPacchetto, returnPath));
        if(paymentMethod == 'satispay') ({url, paymentId} = await createSatispay(prezzoPacchetto, '', returnPath));

        await credentials.findOneAndUpdate({"userName": username}, { "paymentId": paymentId });
        return res.redirect(url)
    } catch (error) {
        console.error('Errore durante la prenotazione del pacchetto:', error);
        return res.render('errorPage', {error: 'Errore durante la prenotazione del pacchetto'});
    }
});

// app.get('/success/pacchetto', isAuthenticated, async (req, res) => {
//     try {
//         const { paymentMethod } = req.query;
//         const { username } = req.user;
//         const type = 'pacchetto';
//         const numberOfCode = 10;
//         if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
//         let id;
//         if(paymentMethod == 'satispay'){
//             id = req.query.id;
//             const { paymentId } = await credentials.findOne({"userName": username});
//             const {status} = await retriveSatispay(paymentId, username, type);
//             if(status.toLowerCase() !='accepted' || !status){
//                 return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
//             }
//         }
//         await credentials.findOneAndUpdate(
//             {"userName": username},
//             {$inc: {"totalCodes": numberOfCode}}
//         );
//         var today = new Date();
//         var day = today.getDate().toString().padStart(2, '0');
//         var month = (today.getMonth() + 1).toString().padStart(2, '0');
//         var year = today.getFullYear();
        
//         var date = day + '/' + month + '/' + year;
//         const pricePerHour = await prices.findOne();
//         const codes = [];
//         for (let i = 0; i < numberOfCode; i++) {
//             var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
//             var codeLength = randomInt(10, 16);
//             var code = '';
//             for (var j = 0; j < codeLength; j++) {
//                 code += chars.charAt(Math.floor(Math.random() * chars.length));
//             }
//             codes.push(code);
//             await credentials.findOneAndUpdate(
//                 {"userName": username},
//                 {$push: {"codicePagamento": { "codice": code, "data": date, "importo": pricePerHour.prezzo}}},
//                 { new: true }
//             );
//         }
//         const user = await credentials.findOne({"userName": username});
//         const subject = 'Acquisto Pacchetto Guide';
//         let text = `Gentile ${user.billingInfo[0].nome} questi sono i codici con cui pagare le guide, Ricorda funzionano solamente con le guide dalla durata di 1 ora. Codici: `;
//         for (const code of codes) {
//             text+= `${code}, `
//         }
//         text+= `i codici sono già utilizzabili da ora.`
//         try{
//             const result = await sendEmail(user.email, subject, text);
//             console.log(result);
//         }catch(error){
//             console.log('errore: ', error);
//             return res.render('errorPage', {error: `Errore nell\'invio dell\'email per i codici.`});
//         }
//         res.redirect('/profile');
//     } catch (error) {
//         console.log('errore nella ricezione del pagamento pacchetti: ', error)
//         res.render('errorPage', {error: 'errore nel pagamento del pacchetto guide'})
//     }
// });

app.get('/success/pacchetto', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const type = 'pacchetto';
        
        const numberOfCode = 10;
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento del pacchetto guide, metodo di pagamento non riconosciuto'})
        const user = await credentials.findOne({"userName": username});
        if(paymentMethod == 'paypal'){
            let payerId = req.query.PayerID;
            let paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            await retrivePayPal(username, payerId, paymentId, type);
        }
        if(paymentMethod == 'satispay'){
            const { status } = await retriveSatispay(username, user.paymentId, type);
            if(!status || status.toLowerCase() != 'accepted'){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        // await credentials.findOneAndUpdate(
        //     {"userName": username},
        //     {$inc: {"totalCodes": numberOfCode}}
        // );
        const prezzi = await prices.findOne();
        const price = prezzi.userPriceFromDate.fromDate.getTime() <= user.createdAt.getTime() ? prezzi.userPriceFromDate.price : prezzi.prezzo; 
        
        const codes = [];
        for (let i = 0; i < numberOfCode; i++) {
            let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let codeLength = randomInt(10, 16);
            let code = '';
            for (let j = 0; j < codeLength; j++) {
                code += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            codes.push({
                user: user._id,
                code,
                amount: price,
                active: true
            });
        }
        await CodesDB.insertMany(codes);
        const subject = 'Acquisto Pacchetto Guide';
        let text = `Gentile ${user.billingInfo[0].nome} questi sono i codici con cui pagare le guide, Ricorda funzionano solamente con le guide dalla durata di 1 ora. Codici: `;
        for (const codeObj of codes) {
            text+= `${codeObj.code}, `
        }
        text+= `i codici sono già utilizzabili da ora.`
        try{
            const result = await sendEmail(user.email, subject, text);
        }catch(error){
            console.log('errore: ', error);
            return res.render('errorPage', {error: `Errore nell\'invio dell\'email per i codici.`});
        }
        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento pacchetti: ', error)
        res.render('errorPage', {error: 'errore nel pagamento del pacchetto guide'})
    }
});

// app.post('/trascinamento', isAuthenticated, async (req, res) => {
//     try {
//         const price = 150;
//         console.log('trascino')
//         const username = req.user.username;
//         const { paymentMethod } = req.body;
//         const returnPath = `/success/trascinamento`;
//         const {_id} = await credentials.findOne({"userName": username});
//         if(paymentMethod == 'paypal'){
//             const url = await createPaypal(price, username, returnPath);
//             return res.redirect(url);
//         }
//         if(paymentMethod == 'satispay'){
//             const url = await createSatispay(price, _id, returnPath);
//             return res.redirect(url);
//         }
//         if(paymentMethod == 'code'){
//             if(await checkCode(req.body.codicePagamento, price, username, 'Trascinamento')){
//                 await credentials.findOneAndUpdate({"userName": username}, {"trascinamento.pagato": true});
//                 return res.redirect('/profile');
//             }else{
//                 return res.render('errorPage', {error: 'Codice non esistente'});
//             }
//         }
//     } catch (error) {
//         console.error('Errore durante la prenotazione dell\'Esame :', error);
//         return res.render('errorPage', {error: 'Errore durante la prenotazione dell\'Esame'});
//     }
// });

app.post('/trascinamento', isAuthenticated, async (req, res) => {
    try {
        const username = req.user.username;
        const { paymentMethod } = req.body;
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'});
        const returnPath = `/success/trascinamento`;
        const prezzi = await prices.findOne();
        const user = await credentials.findOne({"userName": username});
        let url, paymentId;
        if(paymentMethod == 'paypal') ({ url, paymentId } = await createPaypal(prezzi.trascinamento, returnPath));
        if(paymentMethod == 'satispay') ({ url, paymentId } = await createSatispay(prezzi.trascinamento, '', returnPath));
        if(paymentMethod == 'code'){
            if(await checkCode(req.body.codicePagamento, prezzi.trascinamento, user._id, 'Trascinamento')){
                await credentials.findByIdAndUpdate(user._id, {"trascinamento.pagato": true});
                return res.redirect('/profile');
            }else{
                return res.render('errorPage', {error: 'Codice non esistente'});
            }
        }
        await credentials.findById(user._id, { "paymentId": paymentId });
        return res.redirect(url);
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
            const {status} = await retriveSatispay(username, paymentId, type);
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

app.get('/success/trascinamento', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const type = 'Trascinamento';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        const user = await credentials.findOne({ "userName": username });
        let id;
        if(paymentMethod == 'paypal'){
            let payerId = req.query.PayerID;
            let paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            await retrivePayPal(username, payerId, paymentId, type);
        }
        if(paymentMethod == 'satispay'){
            const { status } = await retriveSatispay(username, user.paymentId, type);
            if(!status || status.toLowerCase() != 'accepted'){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }
        await credentials.findByIdAndUpdate(user._id, {"trascinamento.pagato": true});

        res.redirect('/profile');
    } catch (error) {
        console.log('errore nella ricezione del pagamento trascinamento: ', error)
        res.render('errorPage', {error: 'errore nel pagamento del trascinamento'})
    }
});

app.post('/spostaGuida', isAuthenticated, async (req, res) => {
    try {
        const username = req.user.username;
        const user = await credentials.findOne({"userName": username});

        const { paymentMethod, oldLessonId, newLessonId } = req.body;
        console.log(req.body)
        const oldlesson = await LessonsDB.findById(oldLessonId);
        const newLesson = await LessonsDB.findById(newLessonId);

        if(!oldlesson) return res.render('errorPage', { error: 'Lezione da spostare non trovata!' });
        if(!newLesson) return res.render('errorPage', { error: 'Nuova lezione non trovata!' });
        if(newLesson.payment.status === 'completed') return res.render('errorPage', { error: 'Qualcuno ha già prenotato questa lezione!' });
        
        const expirationTime = 30 * 60 * 1000;
        const now = new Date();
        
        const lessonUpdated = !!(await LessonsDB.findOneAndUpdate({"_id": newLesson._id, $or: [ { "payment.status": null }, { "payment.status": "pending", "payment.paymentCreatedAt": { $lte: new Date(now.getTime() - expirationTime) } }]}, { "payment.amount": oldlesson.payment.amount, "payment.status": 'pending', "payment.paymentCreatedAt": new Date()}));
        if (!lessonUpdated) return res.render('errorPage', { error: 'Qualcuno sta già prenotando questa lezione!' });
        
        const { reschedulingFee } = await prices.findOne({}, { "reschedulingFee": 1, "_id": 0 });

        const custom = {oldLessonId, newLessonId};
        
        const returnPath = `/success/spostaGuida`;
        let url, paymentId;
        if(paymentMethod == 'paypal'){
            ({ url, paymentId } = await createPaypal(reschedulingFee, returnPath, custom));
        }
        if(paymentMethod == 'satispay'){
            ({ url, paymentId } = await createSatispay(reschedulingFee, newLessonId, returnPath, custom));
        }
        await LessonsDB.findByIdAndUpdate(newLessonId, { "payment.paymentId": paymentId });
        return res.redirect(url);
    } catch (error) {
        console.error('Errore durante lo spostamento della guida:', error);
        return res.render('errorPage', {error: 'Errore durante lo spostamento della guida'});
    }
});

app.get('/success/spostaGuida', isAuthenticated, async (req, res) => {
    try {
        const { paymentMethod } = req.query;
        const { username } = req.user;
        const userId = (await credentials.findOne({ "userName": username }))._id;
        const type = 'Spostamento Lezione di Guida';
        if(!paymentMethod) return res.render('errorPage', {error: 'errore nel pagamento dell\'esame, metodo di pagamento non riconosciuto'})
        
        let custom;
        if(paymentMethod == 'paypal'){
            const payerId = req.query.PayerID;
            const paymentId = req.query.paymentId;
            if(!paymentId || !payerId){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
            ({ custom } = await retrivePayPal(username, payerId, paymentId, type));
        }
        if(paymentMethod == 'satispay'){
            const { lessonId } = req.query;
            const paymentId = (await LessonsDB.findById(lessonId, {"payment": 1}))?.payment?.paymentId;
            const dati = await retriveSatispay(username, paymentId, type);
            custom = dati.custom;
            const { status } = dati;
            if(status.toLowerCase() !='accepted' || !status){
                return res.render('errorPage', {error: 'Il pagamento non è avvenuto con successo'});
            }
        }

        const { status, message } = await setSpostaGuidaPaid(userId, custom);
        if(status === 200) return res.redirect('/profile');
        return res.render('errorPage', {error: message});

    } catch (error) {
        console.log('errore nella ricezione del pagamento sposta guida: ', error)
        res.render('errorPage', {error: 'errore nel pagamento per lo spostamento della guida'})
    }
});

app.get('/cancel', async (req, res) =>{
    res.render('payments/cancel');
});

async function archiveExpiredUsers() {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const result = await credentials.updateMany(
            {expirationFoglioRosa: { $lte: today, $ne: null }, archiviato: { $ne:true } },
            { $set: { archiviato: true } }
        );

        console.log(`${result.modifiedCount} updated users.`);
    } catch (error) {
        console.error("Errore nell'archiviazione dei fogli rosa scaduti:", error);
    }
}

(async () => {
    // CodesDB
    const users = await credentials.find();
    // user: { type: Schema.Types.ObjectId, ref: 'users' },
    // code: { type: String },
    // amount: { type: Number },
    // active: { type: Boolean },
    // usedAt: { type: Date },
    // createdAt: { type: Date }
    const usersLength = users.length;
    let userCount = 0;
    for (const u of users) {
        const codesLength = u.codicePagamento.length;
        let codesCount = 0;
        for (const c of u.codicePagamento) {
            
            const code = {
                user: u._id,
                code: c.codice,
                amount: c.importo,
                active: c.active,
                createdAt: c._id.getTimestamp()
            }
            console.log(`${userCount}/${usersLength}, ${++codesCount}/${codesLength}`)
            // await new CodesDB(code).save();
        }
        userCount++
    }
});

(async () => {
    const lessons = await guide.find();
    // const newLessonSchema = {
    //     _id: 'ObjectId',
    //     instructor: 'ObjectId',
    //     student: 'ObjectId | null',
    //     day: 'Date',
    //     startTime: "hh:mm",
    //     endTime: "hh:mm",
    //     duration: 'number', // in minuti
    //     locationLink: 'string',
    //     reservedTo: 'string[]',
    //     payment: {
    //         id: 'string',
    //         method: 'string',
    //         paymentCreatedAt: 'Date',
    //         status: 'pending | cancelled | completed'
    //     },
    //     createdAt: 'Date',
    //     updatedAt: 'Date'
    // }
    // return;
// cache locali
// return;
const cache = {
    credentials: new Map(), // key => email|username , value => _id
    admin: new Map(),       // key => nome+cognome , value => _id
  };
  const lezioni = [];
  for (const l of lessons) {
    for (const b of l.book) {
      for (const s of b.schedule) {
        // Calcolo orari
        const [startHour, startMinute] = s.hour.split('-')[0].split(':');
        const [endHour, endMinute] = s.hour.split('-')[1].split(':');
        const startTime = new Date();
        const endTime = new Date();
        startTime.setHours(startHour, startMinute, 0, 0);
        endTime.setHours(endHour, endMinute, 0, 0);
        const duration = (endTime - startTime) / 1000 / 60;
  
        // reservedTo con cache
        const reservedTo = s.reservedTo.length > 0
          ? await Promise.all(
              s.reservedTo.map(async (r) => {
                if (cache.credentials.has(r)) {
                  return cache.credentials.get(r);
                }
                const cred = await credentials.findOne({ email: r });
                const id = cred?._id ?? null;
                cache.credentials.set(r, id);
                return id;
              })
            )
          : null;
  
        // instructor con cache
        const instructorKey = `${l.instructor.split(' ')[0]} ${l.instructor.split(' ')[1]}`;
        let instructorId;
        if (cache.admin.has(instructorKey)) {
          instructorId = cache.admin.get(instructorKey);
        } else {
          const adm = await admin.findOne({
            nome: l.instructor.split(' ')[0],
            cognome: l.instructor.split(' ')[1],
          });
          instructorId = adm?._id ?? null;
          cache.admin.set(instructorKey, instructorId);
        }
  
        // student con cache
        let studentId = null;
        if (s.student) {
          if (cache.credentials.has(s.student)) {
            studentId = cache.credentials.get(s.student);
          } else {
            const stud = await credentials.findOne({ userName: s.student });
            studentId = stud?._id ?? null;
            cache.credentials.set(s.student, studentId);
          }
        }
  
        // nuovo documento
        const newLesson = {
          instructor: instructorId,
          student: studentId,
          day: new Date(b.day.split('/').reverse().join('-')),
          startTime: s.hour.split('-')[0],
          endTime: s.hour.split('-')[1],
          duration,
          locationLink: s.locationLink,
          reservedTo,
          payment: {
            amount: s.price,
            paymentCreatedAt: s.paymentCreatedAt,
            status: s.completed ? 'completed' : s.pending ? 'pending' : null,
          },
          createdAt: b._id.getTimestamp(),
        };
  
        console.log(newLesson);
        lezioni.push(newLesson)
      }
    }
  }
  
  console.log(lezioni.length)
//   await LessonsDB.insertMany(lezioni)
    // const istruttore = await admin.findOne()
    // istruttore.forEach(i => {
    //     console.log(i.nome, ' ', i.cognome)
    // });
});

const cron = require("node-cron");

cron.schedule("0 1 * * *", async () => {
    console.log("🔄 Controllo foglio rosa scaduti");
    await archiveExpiredUsers();
});

const PORT = process.env.PORT || 80;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
